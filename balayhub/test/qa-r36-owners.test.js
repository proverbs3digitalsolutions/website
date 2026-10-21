'use strict';
require('./helpers');

// Round 36 OWNERS (D-118): Edit owner carries a fixed focus key (a rename changes its name), and "Turn off portal access"
// hands its key to "Invite again", which takes its place after the redraw. Frontend only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');

const JS = path.join(__dirname, '../public/js');
const src = fs.readFileSync(path.join(JS, 'views/owners.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r36owners-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

const line = (needle) => src.split('\n').find((l) => l.includes(needle));

test('source: Edit owner carries a fixed key', () => {
  assert.match(src.split('\n').find((l) => l.includes("'aria-label': `Edit ${o.full_name}`")), /'data-focus-key': `owner-edit-\$\{o\.owner_id\}`/);
});

test('source: disablePortal hands over owner-invite key and refocuses before rerender; catch unchanged', () => {
  const fn = src.slice(src.indexOf('const disablePortal = async'), src.indexOf('const listBox'));
  assert.match(fn, /\(o, btn\)/);
  const ok = fn.indexOf("btn?.setAttribute('data-focus-key', `owner-invite-${o.owner_id}`)");
  const focus = fn.indexOf('btn?.focus(');
  const re = fn.indexOf('rerender()');
  assert.ok(ok > 0 && focus > ok && re > focus, 'key, then focus, then rerender');
  assert.match(fn, /catch \(err\) \{ toast\(err\.message, 'error'\); \}/);
  assert.match(src, /onclick: \(e\) => disablePortal\(o, e\.currentTarget\)/);
});

test('a rename with the same key returns focus to the new Edit button', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const old = btn(w, w.main, 'Edit', { 'aria-label': 'Edit Old', 'data-focus-key': 'owner-edit-1' });
  old.focus(); g.note(old);
  w.remove(old);
  const fresh = btn(w, w.main, 'Edit', { 'aria-label': 'Edit New', 'data-focus-key': 'owner-edit-1' });
  g.check(100);
  assert.equal(w.activeElement, fresh);
});

test('Turn off portal access re-keyed to owner-invite-1: focus lands on Invite again', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const off = btn(w, w.main, 'Turn off portal access', { 'aria-label': 'Turn off portal access, A' });
  off.focus(); g.note(off);
  off.setAttribute('data-focus-key', 'owner-invite-1'); off.focus(); g.note(off);
  w.remove(off);
  const inv = btn(w, w.main, 'Invite again', { 'aria-label': 'Invite again, A', 'data-focus-key': 'owner-invite-1' });
  g.check(100);
  assert.equal(w.activeElement, inv);
});
