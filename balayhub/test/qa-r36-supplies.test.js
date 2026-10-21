'use strict';
require('./helpers');

// Round 36 SUPPLIES (KEY-R, D-118): Edit supply renames its record, so its name ("Edit <name>") changes; a fixed key brings focus back. Frontend only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');

const JS = path.join(__dirname, '../public/js');
const src = fs.readFileSync(path.join(JS, 'views/supplies.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r36sup-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

test('source: the Edit button carries supply-edit-${s.supply_id}', () => {
  const line = src.split('\n').find((l) => l.includes("'aria-label': `Edit ${s.name}`"));
  assert.ok(line, 'Edit button found');
  assert.ok(line.includes("'data-focus-key': `supply-edit-${s.supply_id}`"));
  assert.match(line, /onclick: fromMore\(s, \(\) => addOrEdit\(s\)\)/); // D-118 late: opens the row's More again
});

function rename(key) {
  const w = world();
  const old = btn(w, w.main, 'Edit', { 'aria-label': 'Edit Towels', ...(key ? { 'data-focus-key': key } : {}) });
  const g = ui.installFocusGuard(w, { observe: false });
  old.focus(); g.note(old);
  w.remove(old);
  const fresh = btn(w, w.main, 'Edit', { 'aria-label': 'Edit Bath towels', ...(key ? { 'data-focus-key': key } : {}) });
  g.check(100);
  return { w, fresh };
}

test('after a rename, focus returns to the same-keyed Edit', () => {
  const { w, fresh } = rename('supply-edit-7');
  assert.equal(w.activeElement, fresh);
});

test('without the key, focus falls to the heading', () => {
  const { w } = rename(null);
  assert.equal(w.activeElement, w.h1);
});
