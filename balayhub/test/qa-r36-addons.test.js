'use strict';
require('./helpers');

// Round 36 ADDONS (D-118): Edit add-on's name carries the add-on's name, which its own dialog can rename, so the button
// carries a fixed focus key and the guard finds it again after the redraw. Frontend only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');

const JS = path.join(__dirname, '../public/js');
const src = fs.readFileSync(path.join(JS, 'views/addons.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r36addons-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

test('source: the Edit button carries addon-edit-${a.addon_id}', () => {
  const line = src.split('\n').find((l) => l.includes("'aria-label': `Edit ${a.name}`"));
  assert.ok(line, 'Edit button found');
  assert.ok(line.includes("'data-focus-key': `addon-edit-${a.addon_id}`"));
});

function redraw(key) {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const old = btn(w, w.main, 'Edit', { 'aria-label': 'Edit Breakfast', 'data-focus-key': 'addon-edit-7' });
  old.focus(); g.note(old);
  w.remove(old);
  const attrs = { 'aria-label': 'Edit Breakfast deluxe' };
  if (key) attrs['data-focus-key'] = 'addon-edit-7';
  const fresh = btn(w, w.main, 'Edit', attrs);
  g.check(100);
  return { w, fresh };
}

test('stand-in DOM: a renamed add-on keeps focus on its Edit button', () => {
  const { w, fresh } = redraw(true);
  assert.equal(w.activeElement, fresh);
});

test('stand-in DOM: without the key focus falls to the heading', () => {
  const { w, fresh } = redraw(false);
  assert.notEqual(w.activeElement, fresh);
});
