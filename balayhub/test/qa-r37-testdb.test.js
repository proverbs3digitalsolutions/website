'use strict';
require('./helpers');

// QA round 37, lane TESTDB (TDB-L, D-119): a test file must never reach the dev database "balayhub".
// test/helpers.js sets DATABASE_URL from TEST_DATABASE_URL, falling back to balayhub_test, and now refuses the dev database.
// But a test file that requires a ../src or ../scripts module BEFORE ./helpers can load src/config and src/db with
// whatever DATABASE_URL the shell had (the dev database, when it is the default). So every such file requires ./helpers first.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_37_testdb node --test --test-concurrency=1 test/qa-r37-testdb.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const TESTDIR = __dirname;

// Lines of code only: drops // comment lines and /* ... */ blocks (the files keep their requires on lines of their own).
function codeLines(src) {
  const out = [];
  let inBlock = false;
  src.split('\n').forEach((line, i) => {
    let t = line;
    if (inBlock) {
      const end = t.indexOf('*/');
      if (end === -1) return;
      inBlock = false;
      t = t.slice(end + 2);
    }
    if (/^\s*\/\//.test(t)) return;
    const start = t.indexOf('/*');
    if (start !== -1 && t.indexOf('*/', start) === -1) { inBlock = true; t = t.slice(0, start); }
    out.push({ n: i + 1, text: t });
  });
  return out;
}

const SRC_REQUIRE = /require\(\s*['"]\.\.\/(src|scripts)[\/'"]/;
const HELPERS_TOP = /^(?:(?:const|let|var)\s[^=]*=\s*)?require\(\s*['"]\.\/helpers['"]\s*\)/;

function order(file) {
  const lines = codeLines(fs.readFileSync(path.join(TESTDIR, file), 'utf8'));
  const src = lines.find((l) => SRC_REQUIRE.test(l.text));
  const helpers = lines.find((l) => HELPERS_TOP.test(l.text)); // column 0: a top-level require, not a lazy one inside a function
  return { src: src && src.n, helpers: helpers && helpers.n };
}

test('every test file that requires a ../src or ../scripts module requires ./helpers first, at top level', () => {
  const bad = [];
  let checked = 0;
  for (const f of fs.readdirSync(TESTDIR).filter((x) => x.endsWith('.test.js')).sort()) {
    const { src, helpers } = order(f);
    if (!src) continue;
    checked += 1;
    if (!helpers || helpers > src) bad.push(`${f}: first ../src or ../scripts require at line ${src}, ./helpers at ${helpers || 'no top-level require'}`);
  }
  assert.ok(checked > 100, `scanned ${checked} files`);
  assert.deepEqual(bad, []);
});

test('the scan itself: a src require before helpers, a lazy helpers require and a commented one are all caught', () => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tdb-'));
  try {
    const put = (name, body) => fs.writeFileSync(path.join(tmp, name), body);
    const probe = (body) => {
      put('x.test.js', body);
      const lines = codeLines(body);
      const src = lines.find((l) => SRC_REQUIRE.test(l.text));
      const helpers = lines.find((l) => HELPERS_TOP.test(l.text));
      return { src: src && src.n, helpers: helpers && helpers.n };
    };
    assert.deepEqual(probe("'use strict';\nconst a = require('../src/db');\nconst h = require('./helpers');\n"), { src: 2, helpers: 3 });
    assert.deepEqual(probe("'use strict';\nrequire('./helpers');\nconst a = require('../src/db');\n"), { src: 3, helpers: 2 });
    assert.deepEqual(probe("'use strict';\n// require('./helpers');\nconst a = require('../scripts/migrate');\n"), { src: 3, helpers: undefined });
    assert.deepEqual(probe("'use strict';\n/*\nrequire('./helpers');\n*/\nconst a = require('../src/db');\nasync function f() {\n  h = require('./helpers');\n}\n"), { src: 5, helpers: undefined });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

function run(code, env) {
  const clean = { ...process.env };
  delete clean.TEST_DATABASE_URL; delete clean.DATABASE_URL;
  return spawnSync(process.execPath, ['-e', code], { cwd: ROOT, env: { ...clean, ...env }, encoding: 'utf8', timeout: 60000 });
}

test('helpers refuse the dev database "balayhub" (child process; the URL is never connected to)', () => {
  const r = run("require('./test/helpers')", { TEST_DATABASE_URL: 'postgres://balayhub:balayhub@localhost:5432/balayhub' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Refusing to run tests on the balayhub database\./);
  // the refusal is at the top of helpers: it fires before ../src/db could build a pool
  const withQuery = run("require('./test/helpers')", { TEST_DATABASE_URL: 'postgres://balayhub:balayhub@localhost:5432/balayhub?sslmode=disable' });
  assert.notEqual(withQuery.status, 0);
  assert.match(withQuery.stderr, /Refusing to run tests on the balayhub database\./);
});

test('helpers accept a test database name (balayhub_test, r2_37_testdb): they make no query on load', () => {
  for (const name of ['r2_37_testdb', 'balayhub_test']) {
    const r = run("require('./test/helpers'); process.exit(0)", { TEST_DATABASE_URL: `postgres://balayhub:balayhub@localhost:5432/${name}` });
    assert.equal(r.status, 0, r.stderr);
  }
});

test('with TEST_DATABASE_URL and DATABASE_URL both unset, helpers then config point at balayhub_test, never balayhub', () => {
  const r = run("require('./test/helpers'); const c = require('./src/config'); console.log(c.databaseUrl); process.exit(0)", {});
  assert.equal(r.status, 0, r.stderr);
  const url = r.stdout.trim();
  assert.match(url, /\/balayhub_test$/);
  assert.doesNotMatch(url, /\/balayhub(\?|$)/);
});

test('a shell DATABASE_URL naming balayhub is overridden by helpers, never used', () => {
  const r = run("require('./test/helpers'); console.log(process.env.DATABASE_URL); process.exit(0)", { DATABASE_URL: 'postgres://balayhub:balayhub@localhost:5432/balayhub' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.trim(), /\/balayhub_test$/);
});

// Late fix (LATE-TESTDB): the guard resolves the database pg will really open, not the URL text.
const DEV = 'postgres://balayhub:balayhub@localhost:5432';
const REFUSAL = /Refusing to run tests on the balayhub database\./;
// Each child must be refused before any connection: exit code non-zero, refusal on stderr.
function refused(name, env) {
  test(`helpers refuse the dev database in disguise: ${name}`, () => {
    const r = run("require('./test/helpers'); process.exit(0)", env);
    assert.notEqual(r.status, 0, `child was not refused (exit ${r.status})`);
    assert.match(r.stderr, REFUSAL);
  });
}
refused('no database name', { TEST_DATABASE_URL: DEV });
refused('trailing slash', { TEST_DATABASE_URL: `${DEV}/` });
refused('percent-encoded name %62alayhub', { TEST_DATABASE_URL: `${DEV}/%62alayhub` });
refused('fragment #x', { TEST_DATABASE_URL: `${DEV}/balayhub#x` });
refused('PGDATABASE=balayhub with a bare URL', { TEST_DATABASE_URL: DEV, PGDATABASE: 'balayhub' });
refused('mixed case BalayHub', { TEST_DATABASE_URL: `${DEV}/BalayHub` });

test('a normal test URL (r2_37_late) still passes the guard', () => {
  const r = run("require('./test/helpers'); process.exit(0)", { TEST_DATABASE_URL: `${DEV}/r2_37_late` });
  assert.equal(r.status, 0, r.stderr);
});
