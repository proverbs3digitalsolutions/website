'use strict';

// QA round 8, lane C39: opening a tab (click, Enter, arrow key) makes most views redraw their tablist, which removes the
// focused button and drops focus to BODY. app.js restores focus to the tab at the same index. Frontend-only: no database.

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const src = fs.readFileSync(require('node:path').join(__dirname, '../public/js/app.js'), 'utf8');
const m = src.match(/function restoreTabFocus[\s\S]*?\n}\n/);

// Stand-in DOM: a tablist whose buttons are replaced when one is clicked.
function makeDoc() {
  const doc = { body: { isConnected: true }, activeElement: null };
  doc.activeElement = doc.body;
  const list = { isConnected: true, tabs: [] };
  list.querySelectorAll = () => list.tabs;
  const draw = () => {
    list.tabs.forEach((t) => { t.isConnected = false; if (doc.activeElement === t) doc.activeElement = doc.body; });
    list.tabs = [0, 1, 2].map((n) => ({ n, isConnected: true, focus() { doc.activeElement = this; } }));
  };
  draw();
  return { doc, list, draw };
}

test('restoreTabFocus is defined in app.js', () => { assert.ok(m); });

test('focus returns to the new button at the same index after a redraw', () => {
  const restore = new Function(`${m[0]}; return restoreTabFocus;`)();
  const { doc, list, draw } = makeDoc();
  const old = list.tabs[1];
  old.focus();
  assert.equal(restore(list, 1, old, doc), false, 'not redrawn yet: keep waiting');
  draw();
  assert.equal(doc.activeElement, doc.body);
  assert.equal(restore(list, 1, old, doc), true);
  assert.equal(doc.activeElement, list.tabs[1]);
  assert.notEqual(doc.activeElement, old);
});

test('never steals focus the user moved elsewhere, and ignores a removed tablist', () => {
  const restore = new Function(`${m[0]}; return restoreTabFocus;`)();
  const { doc, list, draw } = makeDoc();
  const old = list.tabs[0];
  draw();
  const other = { isConnected: true };
  doc.activeElement = other;
  assert.equal(restore(list, 0, old, doc), true);
  assert.equal(doc.activeElement, other);
  doc.activeElement = doc.body;
  list.isConnected = false;
  assert.equal(restore(list, 0, old, doc), true);
  assert.equal(doc.activeElement, doc.body);
});
