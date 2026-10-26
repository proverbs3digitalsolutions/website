'use strict';
require('./helpers');

// Round 44 GUESTPRESS (D-126, contract C3): the guest Pay and Continue buttons use the answered-press guard from ui.js (guardPress,
// PRESSGUARD). A refusal draws its message above these buttons and moves them down, so a quick second press at the old spot landed on the
// message, or on the quote page on the consent box, which unticked it. These buttons are not built with h()'s onclick, so pressGuard does not
// reach them; each view calls guardPress from its own click listener, placed directly after the button is made.
// Source checks on the four buttons (book.js Continue to payment, pay.js Pay now and Add selected to my bill, quote.js Pay), beside runs of
// guardPress on the stand-in DOM of qa-r43-repeatrace. R44_GUEST_JS_DIR (optional) points the source checks and the copy of ui.js at another
// public/js folder (used to prove the source checks red on the base).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = process.env.R44_GUEST_JS_DIR || path.join(__dirname, '../public/js');
const read = (rel) => fs.readFileSync(path.join(JS, rel), 'utf8');
let ui;
let tmp;
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r44guestpress-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(JS, 'api.js'), path.join(tmp, 'api.js'));
  fs.copyFileSync(path.join(JS, 'ui.js'), path.join(tmp, 'ui.js'));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(tmp, 'ui.js')));
});
test.after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A stand-in button with one listener per event name (as in qa-r43-repeatrace).
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

// The line each view adds directly after its button is made (C3), run on the stand-in button.
function guestButton(win) {
  const btn = new El('button');
  btn.addEventListener('click', (e) => ui.guardPress(e));
  return btn;
}

test('(source) book.js imports guardPress and guards Continue to payment directly after the button is made', () => {
  const src = read('views/book.js');
  assert.match(src, /import \{[^}]*\bguardPress\b[^}]*\} from '\.\.\/ui\.js';/);
  assert.match(src, /const submit = h\('button', \{[^\n]*\}, t\('Continue to payment'\)\);\n\s*submit\.addEventListener\('click', \(e\) => guardPress\(e\)\);/);
});

test('(source) pay.js imports guardPress and guards Pay now and Add selected to my bill directly after each button is made', () => {
  const src = read('views/pay.js');
  assert.match(src, /import \{[^}]*\bguardPress\b[^}]*\} from '\.\.\/ui\.js';/);
  assert.match(src, /const btn = h\('button', \{ class: 'btn btn--primary btn--block', type: 'button' \}, t\('Pay \{amount\} now', \{ amount: peso\(d\.balance\) \}\)\);\n\s*btn\.addEventListener\('click', \(e\) => guardPress\(e\)\);/);
  assert.match(src, /const btn = h\('button', \{ class: 'btn btn--primary btn--block', type: 'button' \}, t\('Add selected to my bill'\)\);\n\s*btn\.addEventListener\('click', \(e\) => guardPress\(e\)\);/);
  assert.equal((src.match(/guardPress\(e\)/g) || []).length, 2, 'exactly the two pay.js buttons are guarded');
});

test('(source) quote.js imports guardPress and guards Pay directly after the button is made, so a second press cannot untick the consent box', () => {
  const src = read('views/quote.js');
  assert.match(src, /import \{[^}]*\bguardPress\b[^}]*\} from '\.\.\/ui\.js';/);
  assert.match(src, /const submit = h\('button', \{ class: 'btn btn--primary btn--block', type: 'submit' \}, t\('Pay \{amount\}', \{ amount: peso\(due\) \}\)\);\n\s*submit\.addEventListener\('click', \(e\) => guardPress\(e\)\);/);
});

test('(runs) a press on a guest button guards its spot: a second press there is stopped and the page never sees it', () => {
  const { win } = page();
  const btn = guestButton(win);
  btn.listeners.click(press(btn, 811, 509)); // the first press (its refusal would move the button)
  const seen = [];
  win.addEventListener('click', (e) => seen.push(e));
  const down = winEvent('pointerdown', 815, 512);
  win.dispatchEvent(down);
  const up = winEvent('click', 815, 512);
  win.dispatchEvent(up);
  assert.equal(down.defaultPrevented, true, 'the second pointer press is stopped');
  assert.equal(up.defaultPrevented, true, 'the second click is stopped');
  assert.equal(seen.length, 0, 'the page never sees the second click');
});

test('(runs) a press 34 px from the first is not stopped', () => {
  const { win } = page();
  const btn = guestButton(win);
  btn.listeners.click(press(btn, 811, 509));
  const far = winEvent('pointerdown', 845, 509);
  win.dispatchEvent(far);
  assert.equal(far.defaultPrevented, false);
});

test('(runs) a keyboard activation (detail 0) installs no window listener', () => {
  const { win } = page();
  const added = recordWindowListeners(win);
  const btn = guestButton(win);
  btn.listeners.click(press(btn, 811, 509, 0));
  assert.deepEqual(added, []);
});

test('(runs) the guard ends 600 ms after the press, so a later press at the same spot goes through', async () => {
  const { win } = page();
  const btn = guestButton(win);
  btn.listeners.click(press(btn, 811, 509));
  await sleep(650);
  const late = winEvent('pointerdown', 811, 509);
  win.dispatchEvent(late);
  assert.equal(late.defaultPrevented, false);
});
