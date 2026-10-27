'use strict';
require('./helpers');

// Round 47 CHECKINPRESS (D-126, D-129, contract C2): the guest check-in page's Submit registration waits for the server. A refusal draws its
// alert at the top of the form and moves the consent box, so a quick second press at the button's old spot unticked the box (GST47-1, the
// fast case). The button is made by checkin.js itself (no h() onclick, so pressGuard does not reach it): the view calls guardPress from its
// own click listener, directly after the button is made and before the form is built.
// Source checks on checkin.js beside runs of guardPress on the stand-in DOM of qa-r44-guestpress. R47_CHECKIN_JS_DIR (optional) points the
// source checks and the copy of ui.js at another public/js folder (used to prove the source checks red on the base).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = process.env.R47_CHECKIN_JS_DIR || path.join(__dirname, '../public/js');
const read = (rel) => fs.readFileSync(path.join(JS, rel), 'utf8');
let ui;
let tmp;
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r47checkinpress-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(JS, 'api.js'), path.join(tmp, 'api.js'));
  fs.copyFileSync(path.join(JS, 'ui.js'), path.join(tmp, 'ui.js'));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(tmp, 'ui.js')));
});
test.after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

// A stand-in button with one listener per event name (as in qa-r44-guestpress).
class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.listeners = {}; }
  addEventListener(k, f) { this.listeners[k] = f; }
}

// A fresh page: an empty window with no listeners (ui.js reads globalThis.window for the guard).
function page() {
  const win = new EventTarget();
  globalThis.window = win;
  globalThis.document = { activeElement: null, body: new El('body') };
  return { win };
}

// Counts the listeners the code under test adds to the window (wrap before the press that installs them).
function recordWindowListeners(win) {
  const added = [];
  const add = win.addEventListener.bind(win);
  win.addEventListener = (type, fn, opts) => { added.push(type); add(type, fn, opts); };
  return added;
}

// A press on an element as the page sees it: the position and the click count (detail 0 is a keyboard click).
function press(target, x = 811, y = 509, detail = 1) {
  return { detail, clientX: x, clientY: y, target, currentTarget: target };
}

// A real event on the window, with a position (what a second press at the same spot looks like to the page).
function winEvent(type, x, y, detail = 1) {
  const ev = new Event(type, { cancelable: true, bubbles: true });
  Object.defineProperties(ev, { clientX: { value: x }, clientY: { value: y }, detail: { value: detail } });
  return ev;
}

// The line checkin.js adds directly after its Submit registration button is made (C2), run on the stand-in button.
function submitButton() {
  const btn = new El('button');
  btn.addEventListener('click', (e) => ui.guardPress(e));
  return btn;
}

test('(source) checkin.js imports guardPress from ../ui.js', () => {
  const src = read('views/checkin.js');
  assert.match(src, /import \{[^}]*\bguardPress\b[^}]*\} from '\.\.\/ui\.js';/);
});

test('(source) Submit registration guards its press directly after the button is made, before the form is built', () => {
  const src = read('views/checkin.js');
  assert.match(src, /const submit = h\('button', [^\n]*\);\n\s*submit\.addEventListener\('click', \(e\) => guardPress\(e\)\);/);
  assert.equal((src.match(/guardPress\(e\)/g) || []).length, 1, 'exactly one guarded press on the check-in page');
  assert.ok(
    src.indexOf("submit.addEventListener('click', (e) => guardPress(e));") < src.indexOf("const form = h('form'"),
    'the guard is installed before the form is built',
  );
});

test('(runs) a press on Submit registration guards its spot: a second press there is stopped and the page never sees it', () => {
  const { win } = page();
  const btn = submitButton();
  btn.listeners.click(press(btn, 811, 509)); // the first press (its refusal moves the consent box up under the old spot)
  const seen = [];
  win.addEventListener('click', (e) => seen.push(e));
  const down = winEvent('pointerdown', 815, 512);
  win.dispatchEvent(down);
  const up = winEvent('click', 815, 512);
  win.dispatchEvent(up);
  assert.equal(down.defaultPrevented, true, 'the second pointer press is stopped');
  assert.equal(up.defaultPrevented, true, 'the second click is stopped');
  assert.equal(seen.length, 0, 'the page never sees the second click, so the consent box is not ticked');
});

test('(runs) a press 34 px from the first is not stopped', () => {
  const { win } = page();
  const btn = submitButton();
  btn.listeners.click(press(btn, 811, 509));
  const far = winEvent('pointerdown', 845, 509);
  win.dispatchEvent(far);
  assert.equal(far.defaultPrevented, false);
});

test('(runs) a keyboard activation (detail 0) installs no window listener', () => {
  const { win } = page();
  const added = recordWindowListeners(win);
  const btn = submitButton();
  btn.listeners.click(press(btn, 811, 509, 0));
  assert.deepEqual(added, []);
});
