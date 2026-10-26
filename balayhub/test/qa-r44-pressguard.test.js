'use strict';
require('./helpers');

// Round 44 PRESSGUARD (D-126, contract C1): a press that waits for the server swallows its own second press. A fast answer (10 to 20 ms)
// lands before a double click's or a double tap's second press, and the page then draws the button that takes the pressed one's place at
// the same spot (Start work becomes Back to open, Check in becomes Check out). pressGuard (public/js/ui.js) now starts the repeat-press
// guard at the press itself, for a mouse, pen or touch press on a button whose press waits for the server. guardPress is exported so the
// guest pages' own Pay and Continue buttons can use it. Frontend only: stand-in DOM, ui.js copied to a temp folder.
// R44_PRESS_UI_DIR (optional) points the run at another copy of ui.js (used to prove the test red on the round 43 base and to re-break the fix).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
const UI_DIR = process.env.R44_PRESS_UI_DIR || JS;
const REPEAT_TYPES = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']; // ui.js REPEAT_EVENTS, in its order
let ui;
let api;
let tmp;
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r44press-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(JS, 'api.js'), path.join(tmp, 'api.js'));
  fs.copyFileSync(path.join(UI_DIR, 'ui.js'), path.join(tmp, 'ui.js'));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(tmp, 'ui.js')));
  api = await import(pathToFileURL(path.join(tmp, 'api.js')));
});
test.after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

const tick = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A stand-in element with one listener per event name (as in qa-r43-repeatrace: a second `click` listener would replace the first, so a
// test also catches a second one). close() fires the `close` listener a task later, as a browser does.
class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.style = {}; this.dataset = {}; this.isConnected = true; this.listeners = {}; this.classList = { add() { }, contains: () => false }; this.value = ''; this.open = false; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(k, f) { this.listeners[k] = f; }
  append(...c) { for (const x of c.flat(Infinity)) { if (x && typeof x === 'object') { x.parentElement = this; this.children.push(x); } } }
  replaceChildren(...c) { this.children = []; this.text = undefined; this.append(...c); }
  get textContent() { return this.text ?? this.children.map((x) => x.textContent).join(''); }
  set textContent(v) { this.text = v; this.children = []; }
  all(out = []) { this.children.forEach((x) => { out.push(x); x.all(out); }); return out; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() { document.activeElement = this; }
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; setImmediate(() => this.listeners.close?.()); }
  remove() { }
}

// A fresh page: an empty body, an opener button with focus, and a window with no listeners.
function page() {
  const body = new El('body');
  const toasts = new El('div'); toasts.id = 'toasts';
  const opener = new El('button');
  body.append(opener);
  const win = new EventTarget();
  globalThis.Node = El;
  globalThis.window = win;
  globalThis.document = {
    activeElement: opener, body,
    createElement: (t) => new El(t),
    createTextNode: (s) => { const x = new El('#text'); x.text = String(s); return x; },
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => toasts,
  };
  return { body, opener, win };
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

// confirmDialog with no reason box: its dialog, its confirm button and the promise's value.
function openConfirm() {
  const p = page();
  let result = 'pending';
  ui.confirmDialog({ title: 'Mark as done?', text: '2 left.', confirmText: 'Mark done anyway' }).then((v) => { result = v; });
  const dlg = p.body.children.find((x) => x.tagName === 'DIALOG');
  const confirm = dlg.all().find((x) => x.tagName === 'BUTTON' && x.textContent === 'Mark done anyway');
  return { ...p, dlg, confirm, result: () => result };
}

// The first press: the confirm button's own click (its handler closes the dialog), then the same click bubbling up to the dialog.
function firstPress(w, detail = 1) {
  w.confirm.listeners.click(press(w.confirm, 811, 509, detail));
  w.dlg.listeners.click(press(w.confirm, 811, 509, detail));
}

test('(answered) a second press at the spot, sent after the answer came, is stopped (the button is redrawn as a different action there)', async () => {
  const p = page();
  let calls = 0;
  const btn = ui.h('button', { onclick: async () => { calls += 1; } }, 'Start work');
  btn.listeners.click(press(btn, 811, 509));
  await tick(); // the answer came back: the page has drawn its replacement
  const seen = [];
  p.win.addEventListener('click', (e) => seen.push(e));
  const down = winEvent('pointerdown', 815, 512);
  p.win.dispatchEvent(down);
  const again = winEvent('click', 815, 512);
  p.win.dispatchEvent(again);
  assert.equal(calls, 1);
  assert.equal(down.defaultPrevented, true);
  assert.equal(again.defaultPrevented, true);
  assert.deepEqual(seen, []);
});

test('(redraw before the answer) a second press at the spot while the press still waits is stopped', async () => {
  const p = page();
  let release;
  const btn = ui.h('button', { onclick: () => new Promise((r) => { release = r; }) }, 'Start work');
  btn.listeners.click(press(btn, 811, 509));
  const again = winEvent('click', 815, 512);
  p.win.dispatchEvent(again);
  assert.equal(again.defaultPrevented, true);
  release();
  await tick();
});

test('(sync) a handler that returns nothing installs no guard', () => {
  const p = page();
  let calls = 0;
  const btn = ui.h('button', { onclick: () => { calls += 1; } }, 'Next week');
  const added = recordWindowListeners(p.win);
  btn.listeners.click(press(btn, 811, 509));
  assert.equal(calls, 1);
  assert.deepEqual(added, []);
});

test('(keyboard) a keyboard press (detail 0) installs no guard', async () => {
  const p = page();
  const btn = ui.h('button', { onclick: async () => { } }, 'Start work');
  const added = recordWindowListeners(p.win);
  btn.listeners.click(press(btn, 811, 509, 0));
  await tick();
  assert.deepEqual(added, []);
  const again = winEvent('click', 815, 512);
  p.win.dispatchEvent(again);
  assert.equal(again.defaultPrevented, false);
});

test('(far) a second press 34 px away is not stopped', async () => {
  const p = page();
  const btn = ui.h('button', { onclick: async () => { } }, 'Start work');
  btn.listeners.click(press(btn, 811, 509));
  await tick();
  const far = winEvent('click', 845, 509);
  p.win.dispatchEvent(far);
  assert.equal(far.defaultPrevented, false);
});

test('(window end) 650 ms after the press, a press at the same spot is not stopped', async () => {
  const p = page();
  const btn = ui.h('button', { onclick: async () => { } }, 'Start work');
  btn.listeners.click(press(btn, 811, 509));
  await tick();
  await sleep(650);
  const late = winEvent('click', 811, 509);
  p.win.dispatchEvent(late);
  assert.equal(late.defaultPrevented, false);
});

test('(dimmed before) a button dimmed before the press (aria-disabled "true") installs no guard', async () => {
  const p = page();
  const btn = ui.h('button', { 'aria-disabled': 'true', onclick: async () => { } }, 'Check out');
  const added = recordWindowListeners(p.win);
  btn.listeners.click(press(btn, 811, 509));
  await tick();
  assert.deepEqual(added, []);
});

test('(dialog) a dialog button whose press closes the dialog installs the five listeners exactly once', async () => {
  const w = openConfirm();
  const added = recordWindowListeners(w.win);
  firstPress(w);
  await tick();
  assert.equal(w.result(), true);
  assert.deepEqual(added, REPEAT_TYPES);
});

test('(export) guardPress installs the guard for a mouse, pen or touch press with a position, and nothing for a keyboard press', () => {
  const p = page();
  assert.equal(typeof ui.guardPress, 'function');
  const added = recordWindowListeners(p.win);
  ui.guardPress({ detail: 1, clientX: 811, clientY: 509 });
  assert.deepEqual(added, REPEAT_TYPES);
  const keyboard = recordWindowListeners(p.win);
  ui.guardPress({ detail: 0, clientX: 1, clientY: 1 });
  assert.deepEqual(keyboard, []);
});
