'use strict';
require('./helpers');
// QA round 37, AWAITSCAN (AWT-L class guard). Round 36 found `e.currentTarget` read after an `await` in Help's
// "Mark as solved": the browser clears currentTarget when dispatch ends, so the read is null by then.
// Rule: in any async function under public/js, no `<first param>.currentTarget` after the first `await`
// (nested callbacks included). `<param>.target` stays set after the event ends and is allowed.
// Allowlist: none. A new entry needs a reason line and the orchestrator's approval.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ALLOWLIST = []; // entries: { file: 'x.js', line: 12, reason: '...' }

const ID = /[\w$]/;
const REGEX_PREV = /[(,=:[!&|?{};+\-*%<>~^]/;
const REGEX_KW = /(?:^|[^\w$.])(?:return|typeof|case|do|else|in|of|void|delete|throw|new|yield|await)$/;

// Blank out comments, strings, template text and regex literals (keeping newlines, so offsets and lines match).
// Code inside `${ ... }` of a template literal is kept: an await or currentTarget there is real code.
function mask(src) {
  const out = src.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  const stack = []; // 'brace' | 'tpl' (a `${` waiting for its `}`)
  let i = 0, prev = ''; // prev = last significant (non-space) code char
  const prevWordEnd = (at) => src.slice(Math.max(0, at - 12), at).trimEnd();
  function template() { // i is just after the opening backtick; returns when the closing backtick is reached or a `${` begins
    const start = i;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { blank(start, i); i++; prev = '`'; return false; }
      if (c === '$' && src[i + 1] === '{') { blank(start, i + 2); i += 2; stack.push('tpl'); prev = '{'; return true; }
      i++;
    }
    blank(start, i); return false;
  }
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === "'" || c === '"') {
      const s = i; i++;
      while (i < src.length && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
      i++; blank(s, i); prev = c; continue;
    }
    if (c === '`') { i++; template(); continue; }
    if (c === '/') {
      const before = prevWordEnd(i);
      const isRegex = prev === '' || REGEX_PREV.test(prev) || REGEX_KW.test(before);
      if (isRegex) {
        const s = i; i++; let cls = false;
        while (i < src.length && src[i] !== '\n') {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false;
          else if (src[i] === '/' && !cls) break;
          i++;
        }
        i++; while (i < src.length && ID.test(src[i])) i++; // flags
        blank(s, i); prev = '/'; continue;
      }
    }
    if (c === '{') { stack.push('brace'); prev = c; i++; continue; }
    if (c === '}') {
      const top = stack.pop();
      if (top === 'tpl') { blank(i, i + 1); i++; template(); continue; }
      prev = c; i++; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

function matchClose(m, i, open, close) { // m = masked text; i at `open`
  let d = 0;
  for (let k = i; k < m.length; k++) {
    if (m[k] === open) d++;
    else if (m[k] === close) { d--; if (d === 0) return k; }
  }
  return m.length;
}

function lineOf(src, at) { return src.slice(0, at).split('\n').length; }

// Every async function, method or arrow: { first param name or null, body range, handler line }.
function asyncFunctions(m) {
  const found = [];
  const re = /\basync\b/g;
  let hit;
  while ((hit = re.exec(m))) {
    if (m[hit.index - 1] === '.' || ID.test(m[hit.index - 1] || ' ')) continue;
    let i = hit.index + 5;
    const ws = () => { while (/\s/.test(m[i] || '')) i++; };
    ws();
    let param = null, paramsOpen = -1, paramsClose = -1;
    const fn = /^function\b/.exec(m.slice(i, i + 9));
    if (fn) { i += 8; ws(); if (m[i] === '*') { i++; ws(); } while (ID.test(m[i] || ' ')) i++; ws(); }
    else if (m[i] === '*') { i++; ws(); while (ID.test(m[i] || ' ')) i++; ws(); } // async *gen(e)
    if (m[i] === '(') { paramsOpen = i; paramsClose = matchClose(m, i, '(', ')'); }
    else if (ID.test(m[i] || ' ')) {
      const s = i; while (ID.test(m[i] || ' ')) i++;
      const word = m.slice(s, i); ws();
      if (m.slice(i, i + 2) === '=>') { param = word; paramsOpen = s - 1; paramsClose = s + word.length; } // async e => ...
      else if (m[i] === '(' ) { paramsOpen = i; paramsClose = matchClose(m, i, '(', ')'); } // async name(e) { ... } method
      else continue;
    } else continue;
    if (param === null) {
      const inner = m.slice(paramsOpen + 1, paramsClose);
      const first = /^\s*([A-Za-z_$][\w$]*)\s*(?:[,=)]|$)/.exec(inner + ')');
      param = first ? first[1] : null;
    }
    let j = paramsClose + 1;
    while (/\s/.test(m[j] || '')) j++;
    if (m.slice(j, j + 2) === '=>') { j += 2; while (/\s/.test(m[j] || '')) j++; }
    let bodyStart, bodyEnd;
    if (m[j] === '{') { bodyStart = j; bodyEnd = matchClose(m, j, '{', '}'); }
    else { // expression-bodied arrow: runs to the first depth-0 , ) ] } ;
      bodyStart = j; let d = 0, k = j;
      for (; k < m.length; k++) {
        const c = m[k];
        if ('([{'.includes(c)) d++;
        else if (')]}'.includes(c)) { if (d === 0) break; d--; }
        else if ((c === ',' || c === ';') && d === 0) break;
      }
      bodyEnd = k;
    }
    found.push({ param, bodyStart, bodyEnd, at: hit.index });
  }
  return found;
}

// Returns [{ line, handlerLine, text }] for each `<param>.currentTarget` read after the function's first await.
function scanSource(src) {
  const m = mask(src);
  const hits = [];
  const seen = new Set();
  for (const f of asyncFunctions(m)) {
    if (!f.param) continue;
    const body = m.slice(f.bodyStart, f.bodyEnd);
    const aw = body.search(/(?<![\w$.])await\b/);
    if (aw < 0) continue;
    const after = body.slice(aw);
    const P = f.param.replace(/\$/g, '\\$');
    // `e.currentTarget`, `e?.currentTarget`, and `e['currentTarget']` (the string is blanked in the masked text, so check the original there)
    const re = new RegExp(`(?<![\\w$.])${P}\\s*(?:\\?\\.|\\.)\\s*currentTarget\\b|(?<![\\w$.])${P}\\s*(?:\\?\\.)?\\s*\\[\\s*[\\s]*\\]`, 'g');
    let r;
    while ((r = re.exec(after))) {
      if (r[0].endsWith(']') && !/currentTarget/.test(src.slice(f.bodyStart + aw + r.index, f.bodyStart + aw + r.index + r[0].length))) continue;
      const line = lineOf(src, f.bodyStart + aw + r.index);
      const key = `${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ line, handlerLine: lineOf(src, f.at), text: r[0] });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

function walk(dir) {
  const files = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...walk(p));
    else if (e.name.endsWith('.js')) files.push(p);
  }
  return files.sort();
}

function scanTree(dir) {
  const bad = [];
  for (const f of walk(dir)) {
    for (const h of scanSource(fs.readFileSync(f, 'utf8'))) {
      const rel = path.relative(dir, f);
      if (ALLOWLIST.some((a) => a.file === rel && a.line === h.line)) continue;
      bad.push(`${rel}:${h.line} reads ${h.text} after an await (handler at line ${h.handlerLine})`);
    }
  }
  return bad;
}

const PUBLIC_JS = path.join(__dirname, '..', 'public', 'js');

test('scanner flags a currentTarget read after a confirm await', () => {
  const hits = scanSource("x({ onclick: async (e) => { if (!await confirmDialog({})) return; e.currentTarget.setAttribute('x', '1'); } });");
  assert.strictEqual(hits.length, 1);
});

test('scanner accepts a currentTarget read into a variable before the first await', () => {
  const hits = scanSource("x({ onclick: async (e) => { const btn = e.currentTarget; await post('/x'); btn.focus(); } });");
  assert.deepStrictEqual(hits, []);
});

test('scanner flags a named async function whose second statement reads ev.currentTarget', () => {
  const hits = scanSource('async function save(ev) { await a(); ev.currentTarget.blur(); }');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].handlerLine, 1);
});

test('scanner ignores currentTarget inside a template literal text or a comment after the await', () => {
  const src = [
    'async (e) => {',
    '  await go();',
    '  // e.currentTarget would be null here',
    '  /* e.currentTarget */',
    '  const s = `e.currentTarget is null after an await`;',
    "  const q = 'e.currentTarget';",
    '  const r = /e\\.currentTarget/;',
    '  return s + q + r;',
    '}',
  ].join('\n');
  assert.deepStrictEqual(scanSource(src), []);
});

test('scanner still sees code inside a template expression and in nested callbacks', () => {
  assert.strictEqual(scanSource('async (e) => { await a(); return `${e.currentTarget.id}`; }').length, 1);
  assert.strictEqual(scanSource('async (e) => { await a(); list.forEach(() => { e.currentTarget.focus(); }); }').length, 1);
});

test('scanner allows e.target after an await and other parameter names', () => {
  assert.deepStrictEqual(scanSource('async (e) => { await a(); e.target.focus(); }'), []);
  assert.deepStrictEqual(scanSource('async (e) => { await a(); other.currentTarget.focus(); }'), []);
  assert.deepStrictEqual(scanSource('async (e) => { e.currentTarget.focus(); await a(); }'), []);
  assert.deepStrictEqual(scanSource('async (e) => { await a(); e.preventDefault(); }'), []);
});

test('scanner handles expression-bodied arrows, async methods and bracket reads', () => {
  assert.strictEqual(scanSource('f(async (e) => (await a(), e.currentTarget.value));').length, 1);
  assert.strictEqual(scanSource('const o = { async click(e) { await a(); e.currentTarget.blur(); } };').length, 1);
  assert.strictEqual(scanSource("async e => { await a(); e['currentTarget'].blur(); }").length, 1);
  assert.strictEqual(scanSource('async (e) => { await a(); e?.currentTarget.blur(); }').length, 1);
});

test('why the rule exists: an async listener sees currentTarget as null after an await, target stays set', async () => {
  const el = new EventTarget();
  const seen = {};
  const done = new Promise((resolve) => {
    el.addEventListener('go', async (e) => {
      seen.before = e.currentTarget;
      await Promise.resolve();
      seen.afterCurrent = e.currentTarget;
      seen.afterTarget = e.target;
      resolve();
    });
  });
  el.dispatchEvent(new Event('go'));
  await done;
  assert.strictEqual(seen.before, el);
  assert.strictEqual(seen.afterCurrent, null);
  assert.strictEqual(seen.afterTarget, el);
});

test('planted copy of help.js with the round 36 Mark as solved shape put back is flagged', () => {
  const real = fs.readFileSync(path.join(PUBLIC_JS, 'views', 'help.js'), 'utf8');
  const a = 'const btn = e.currentTarget; // read before any await: currentTarget is null afterwards';
  const b = "solving = true; btn.setAttribute('aria-busy', 'true');";
  assert.ok(real.includes(a) && real.includes(b), 'help.js Mark as solved no longer has the expected lines; update this plant');
  const planted = real.replace(a, 'const btn = null;').replace(b, "solving = true; e.currentTarget.setAttribute('aria-busy', 'true');");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'balayhub-awaitscan-'));
  try {
    fs.mkdirSync(path.join(dir, 'views'));
    fs.writeFileSync(path.join(dir, 'views', 'help.js'), planted);
    const bad = scanTree(dir);
    assert.strictEqual(bad.length, 1, bad.join('\n'));
    assert.match(bad[0], /^views[\\/]help\.js:\d+ reads e\.currentTarget after an await/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('no async function under public/js reads currentTarget after its first await', () => {
  assert.ok(walk(PUBLIC_JS).length > 20, 'expected the whole public/js tree');
  const bad = scanTree(PUBLIC_JS);
  assert.deepStrictEqual(bad, [], `currentTarget is null after an await; read it into a const first:\n${bad.join('\n')}`);
});

test('the scan sees the async handlers in the tree (not vacuous)', () => {
  let withAwait = 0;
  for (const f of walk(PUBLIC_JS)) {
    const src = fs.readFileSync(f, 'utf8');
    for (const fn of asyncFunctions(mask(src))) {
      if (fn.param && /\bawait\b/.test(mask(src).slice(fn.bodyStart, fn.bodyEnd))) withAwait++;
    }
  }
  assert.ok(withAwait >= 50, `only ${withAwait} async functions with a parameter and an await found`);
});
