'use strict';

// QA round 18, lane TS: page keywords match whole words or word starts only ('Ana' must not find 'manager').
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
let ts;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r18ts-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'topsearch.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ts = await import(pathToFileURL(path.join(dir, 'topsearch.js')));
});

const owner = { role: 'owner', business_type: 'short_term' };
const run = (q) => ts.pageResults(q, owner, [['/dashboard', 'Dashboard']], () => true).map((r) => r.title);

test("'Ana' does not pull in Team and permissions through the keyword 'manager'", () => {
  assert.ok(!run('Ana').includes('Team and permissions'));
});

test('a keyword word start still finds its page', () => {
  assert.ok(run('manag').includes('Team and permissions'));
  assert.ok(run('invite').includes('Team and permissions'));
});
