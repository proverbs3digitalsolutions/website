'use strict';
require('./helpers');

// Round 36 INBOX (D-118): the Edit buttons on automatic messages and templates carry a fixed focus key, because a rename or a new
// send time changes their accessible name. Frontend only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');

const JS = path.join(__dirname, '../public/js');
const src = fs.readFileSync(path.join(JS, 'views/inbox.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r36inbox-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

const line = (needle) => src.split('\n').find((l) => l.includes(needle));

test('source: Edit automatic message and Edit template carry fixed keys; toggle key unchanged', () => {
  assert.match(line('`Edit automatic message: '), /'data-focus-key': `auto-edit-\$\{a\.automation_id\}`/);
  assert.match(line('`Edit template: '), /'data-focus-key': `tpl-edit-\$\{t\.template_id\}`/);
  assert.match(src, /`auto-toggle-\$\{a\.automation_id\}`/);
});

function renamed(newKey) {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const old = btn(w, w.main, 'Edit', { 'aria-label': 'Edit template: Old name', 'data-focus-key': 'tpl-edit-7' });
  old.focus(); g.note(old);
  w.remove(old);
  const attrs = { 'aria-label': 'Edit template: New name' };
  if (newKey) attrs['data-focus-key'] = 'tpl-edit-7';
  const fresh = btn(w, w.main, 'Edit', attrs);
  g.check(100);
  return { w, fresh };
}

test('a rename with the same key returns focus to the new Edit button', () => {
  const { w, fresh } = renamed(true);
  assert.equal(w.activeElement, fresh);
});

test('without the key a rename lands on the heading', () => {
  const { w } = renamed(false);
  assert.equal(w.activeElement, w.h1);
});
