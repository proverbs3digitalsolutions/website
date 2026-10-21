'use strict';
require('./helpers');

// Round 35 GUARD (D-117): the focus guard's last resort is the page's own focus heading (data-page-heading), else the h1, the way the
// router does it, so an open Inbox conversation has one focus heading. A dialog's own h2 is unchanged. Frontend only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');

const JS = path.join(__dirname, '../public/js');
const uiSrc = fs.readFileSync(path.join(JS, 'ui.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r35guard-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

// The stand-in DOM only knows tag selectors; teach main the one attribute selector this test needs.
function page({ marked }) {
  const w = world();
  const qs = w.main.querySelector.bind(w.main);
  w.main.querySelector = (sel) => (sel === '[data-page-heading]' ? w.main.children.find((x) => x.attrs['data-page-heading'] !== undefined) || null : qs(sel));
  const h2 = w.main.add(w.make('h2', marked ? { 'data-page-heading': '' } : {}, 'Guest name'));
  return { w, h2 };
}
const lose = (w, g) => {
  const b = btn(w, w.main, 'Cancel', { 'data-focus-key': 'msg-cancel' }); b.focus(); g.note(b);
  w.remove(b);
  g.check(100);
};

test('fallback is the marked page heading, not the h1', () => {
  const { w, h2 } = page({ marked: true });
  lose(w, ui.installFocusGuard(w, { observe: false }));
  assert.equal(w.activeElement, h2);
});

test('with no marked heading the fallback is the h1', () => {
  const { w } = page({ marked: false });
  lose(w, ui.installFocusGuard(w, { observe: false }));
  assert.equal(w.activeElement, w.h1);
});

test('an open dialog still falls back to its own h2', () => {
  const { w } = page({ marked: true });
  const d = w.dialog();
  const dh = d.add(w.make('h2', {}, 'Dialog'));
  const g = ui.installFocusGuard(w, { observe: false });
  const b = btn(w, d, 'Save', { 'data-focus-key': 'dlg-save' }); b.focus(); g.note(b);
  w.remove(b);
  g.check(100);
  assert.equal(w.activeElement, dh);
});

test('source: focusHeadingIfFree prefers the marked heading, then h1', () => {
  assert.match(uiSrc, /document\.querySelector\('#main \[data-page-heading\]'\) \|\| document\.querySelector\('#main h1'\) \|\| document\.querySelector\('#app h1'\)/);
});
