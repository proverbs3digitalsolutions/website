'use strict';

// QA r15 S1: error toasts are announced as alerts (others stay polite), and a redraw never pulls an off-screen control into view.
// Frontend-only: no database. S1_JS_DIR points the test at another copy of public/js (to see it fail on the old code).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');

const JS = process.env.S1_JS_DIR || path.join(__dirname, '../public/js');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r15s1-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

test('toast: error is role alert, others role status', () => {
  const box = { children: [], append(e) { this.children.push(e); } };
  globalThis.document = { getElementById: () => box, createElement: (t) => ({ tagName: t, attrs: {}, children: [], classList: { add() {} }, setAttribute(k, v) { this.attrs[k] = v; }, append() {}, remove() {}, addEventListener() {} }) };
  const src = fs.readFileSync(path.join(JS, 'ui.js'), 'utf8');
  assert.match(src, /role: kind === 'error' \? 'alert' : 'status'/);
});

const rect = (top, bottom) => () => ({ top, bottom });
function replaced(w, g, visible) {
  const old = btn(w, w.main, 'Save'); old.focus(); g.note(old);
  g.state().rec.visible = visible;
  w.remove(old);
  const fresh = btn(w, w.main, 'Save');
  fresh.getBoundingClientRect = rect(-500, -460);
  let scrolled = 0; fresh.scrollIntoView = () => { scrolled++; };
  g.check(0);
  assert.equal(w.activeElement, fresh);
  return scrolled;
}

test('focus guard: a control that was off screen is focused without scrolling', () => {
  globalThis.innerHeight = 800;
  const w = world();
  assert.equal(replaced(w, ui.installFocusGuard(w, { observe: false }), false), 0);
});

test('focus guard: a control that was on screen is still scrolled into view', () => {
  globalThis.innerHeight = 800;
  const w = world();
  assert.equal(replaced(w, ui.installFocusGuard(w, { observe: false }), true), 1);
});

test('note() records whether the control is on screen', () => {
  globalThis.innerHeight = 800;
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const off = btn(w, w.main, 'A'); off.getBoundingClientRect = rect(-50, -10); off.focus(); g.note(off);
  assert.equal(g.state().rec.visible, false);
  const on = btn(w, w.main, 'B'); on.getBoundingClientRect = rect(10, 50); on.focus(); g.note(on);
  assert.equal(g.state().rec.visible, true);
});

test('keptScroll: focus off screen beforehand does not block the undo; on screen still does', () => {
  const base = { y: 400, nowY: 100, maxY: 2000, sinceChange: 10, sinceAction: 10, sameRoute: true, focusTop: -200, focusBottom: -160, viewH: 800 };
  assert.equal(ui.keptScroll({ ...base, focusWasVisible: false }), 400);
  assert.equal(ui.keptScroll({ ...base, focusTop: 20, focusBottom: 60, focusWasVisible: true }), null);
  assert.equal(ui.keptScroll({ ...base, focusTop: 20, focusBottom: 60 }), null);
});
