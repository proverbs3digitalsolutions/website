'use strict';
require('./helpers');

// Round 45 PRESSCHANGE (D-127, contract C1): a change the person makes after a press ends the press guard. D-126's guard swallows a second
// press within 600 ms and 30 px of a press on a button that waits for the server. A press can be refused on the device and send nothing
// ("Please enter a reason."); the person then types a reason and presses again inside 600 ms, and that press was swallowed. Now a trusted
// input event (typing, a paste, a tick, a choice) anywhere on the page ends the guard, so the next press is a new one. An untrusted input
// (a view that fills a box and sends its own input event) keeps the guard. Frontend only: stand-in DOM, ui.js copied to a temp folder.
// R45_CHANGE_UI_DIR (optional) points the run at another copy of ui.js (used to prove the test red on the round 44 base and to re-break the fix).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
const UI_DIR = process.env.R45_CHANGE_UI_DIR || JS;
const REPEAT_TYPES = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']; // ui.js REPEAT_EVENTS, in its order
let ui;
let tmp;
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r45press-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(JS, 'api.js'), path.join(tmp, 'api.js'));
  fs.copyFileSync(path.join(UI_DIR, 'ui.js'), path.join(tmp, 'ui.js'));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(tmp, 'ui.js')));
});
test.after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

const tick = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A stand-in element with one listener per event name (as in qa-r44-pressguard). close() fires the `close` listener a task later, as a browser does.
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

// The window stand-in. Node's EventTarget does not match a boolean capture flag on removeEventListener the way a browser does (a listener
// added with true is not removed by true), so both sides are passed in the options form here. The code under test keeps the boolean form.
class StandWindow extends EventTarget {
  addEventListener(type, fn, opts) { super.addEventListener(type, fn, typeof opts === 'boolean' ? { capture: opts } : opts); }
  removeEventListener(type, fn, opts) { super.removeEventListener(type, fn, typeof opts === 'boolean' ? { capture: opts } : opts); }
}

// A fresh page: an empty body, an opener button with focus, and a window with no listeners.
function page() {
  const body = new El('body');
  const toasts = new El('div'); toasts.id = 'toasts';
  const opener = new El('button');
  body.append(opener);
  const win = new StandWindow();
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

// Records the listeners the code under test removes from the window (wrap before the press that installs them).
function recordWindowRemovals(win) {
  const removed = [];
  const remove = win.removeEventListener.bind(win);
  win.removeEventListener = (type, fn, opts) => { removed.push(type); remove(type, fn, opts); };
  return removed;
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

// A trusted input event on the window: what the browser sends when the person types, pastes, ticks a box or picks an option.
function trustedInput(win) {
  const ev = new Event('input', { bubbles: true });
  Object.defineProperty(ev, 'isTrusted', { value: true });
  win.dispatchEvent(ev);
  return ev;
}

// An input event a view sends itself (an AI draft or a template filling a box), which is not the person's change.
function scriptInput(win) {
  const ev = new Event('input', { bubbles: true });
  win.dispatchEvent(ev);
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

test('(refused, then changed) a press the page refused on the device, a trusted change, then a second press at the spot is a new press (not stopped)', async () => {
  const p = page();
  let refused = 0;
  const btn = ui.h('button', { onclick: async () => { refused += 1; } }, 'Void payment');
  btn.listeners.click(press(btn, 811, 509));
  await tick(); // the refusal came back at once and sent nothing
  trustedInput(p.win); // the person types a reason
  const seen = [];
  p.win.addEventListener('click', (e) => seen.push(e));
  const again = winEvent('click', 815, 512);
  p.win.dispatchEvent(again);
  assert.equal(refused, 1);
  assert.equal(again.defaultPrevented, false);
  assert.equal(seen.length, 1);
});

test('(untrusted input keeps the guard) a view\'s own input event after a refused press does not end the guard', async () => {
  const p = page();
  const btn = ui.h('button', { onclick: async () => { } }, 'Void payment');
  btn.listeners.click(press(btn, 811, 509));
  await tick();
  scriptInput(p.win);
  const again = winEvent('click', 815, 512);
  p.win.dispatchEvent(again);
  assert.equal(again.defaultPrevented, true);
});

test('(no change: D-126 unchanged) a refused press, nothing changed, then a second press at the spot is stopped', async () => {
  const p = page();
  const btn = ui.h('button', { onclick: async () => { } }, 'Void payment');
  btn.listeners.click(press(btn, 811, 509));
  await tick();
  const down = winEvent('pointerdown', 815, 512);
  p.win.dispatchEvent(down);
  const again = winEvent('click', 815, 512);
  p.win.dispatchEvent(again);
  assert.equal(down.defaultPrevented, true);
  assert.equal(again.defaultPrevented, true);
});

test('(the dialog\'s guard too) a dialog button closes on its press; a trusted change, then a click at the spot is not stopped', async () => {
  const w = openConfirm();
  firstPress(w);
  await tick();
  assert.equal(w.result(), true);
  trustedInput(w.win);
  const again = winEvent('click', 815, 512);
  w.win.dispatchEvent(again);
  assert.equal(again.defaultPrevented, false);
});

test('(listeners leave) a trusted change removes the five press listeners and the change listener once, and a second change removes nothing more', async () => {
  const p = page();
  const removed = recordWindowRemovals(p.win);
  const btn = ui.h('button', { onclick: async () => { } }, 'Void payment');
  btn.listeners.click(press(btn, 811, 509));
  await tick();
  trustedInput(p.win);
  assert.deepEqual(removed, [...REPEAT_TYPES, 'input']);
  trustedInput(p.win);
  assert.deepEqual(removed, [...REPEAT_TYPES, 'input']);
});

test('(listeners leave) with no change, the same six listeners leave 600 ms after the press', async () => {
  const p = page();
  const removed = recordWindowRemovals(p.win);
  const btn = ui.h('button', { onclick: async () => { } }, 'Void payment');
  btn.listeners.click(press(btn, 811, 509));
  await tick();
  await sleep(650);
  assert.deepEqual(removed, [...REPEAT_TYPES, 'input']);
});

test('(installed) guardPress installs the five press listeners and the change listener for a mouse, pen or touch press, and nothing for a keyboard press', () => {
  const p = page();
  const added = recordWindowListeners(p.win);
  ui.guardPress({ detail: 1, clientX: 811, clientY: 509 });
  assert.deepEqual(added, [...REPEAT_TYPES, 'input']);
  const keyboard = recordWindowListeners(p.win);
  ui.guardPress({ detail: 0, clientX: 1, clientY: 1 });
  assert.deepEqual(keyboard, []);
});
