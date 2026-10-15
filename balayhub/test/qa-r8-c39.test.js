'use strict';

// QA round 8, lane C39: opening a tab (click, Enter, arrow key) makes most views redraw their tablist, which removes the
// focused button and drops focus to BODY. QA r13 F01: the single focus guard in ui.js (D-89) puts focus back on the tab at the same place
// of the same labelled tab list (the old restoreTabFocus in app.js is gone); the arrow-key handler stays. Frontend-only: no database.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { world } = require('./focus-world');

const JS = path.join(__dirname, '../public/js');
const src = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r8c39-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

// A tablist whose buttons are replaced when one is clicked.
function drawTabs(w, list) {
  list.children.slice().forEach((t) => w.remove(t));
  return [0, 1, 2].map((n) => list.add(w.make('button', { role: 'tab' }, `Tab ${n}`)));
}

test('the old tab watcher is gone from app.js; arrow keys stay', () => {
  assert.doesNotMatch(src, /restoreTabFocus/);
  assert.match(src, /function tabKeyTarget/);
});

test('focus returns to the new button at the same index after a redraw', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const list = w.main.add(w.make('div', { role: 'tablist', 'aria-label': 'Report type' }));
  const old = drawTabs(w, list)[1];
  old.focus(); g.note(old);
  g.check(0);
  assert.equal(w.activeElement, old, 'not redrawn yet: nothing moves');
  const fresh = drawTabs(w, list);
  assert.equal(w.activeElement, w.body);
  g.check(100);
  assert.equal(w.activeElement, fresh[1]);
  assert.notEqual(w.activeElement, old);
});

test('never steals focus the user moved elsewhere, and leaves focus alone while the tablist is gone', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const list = w.main.add(w.make('div', { role: 'tablist', 'aria-label': 'Report type' }));
  const old = drawTabs(w, list)[0];
  old.focus(); g.note(old);
  w.remove(list);
  g.check(0);
  assert.equal(w.activeElement, w.body, 'no new tablist yet: nothing to focus, the heading waits');
  const other = w.main.add(w.make('input', { type: 'text' }));
  other.focus();
  drawTabs(w, w.main.add(w.make('div', { role: 'tablist', 'aria-label': 'Report type' })));
  g.check(50);
  assert.equal(w.activeElement, other);
});
