'use strict';
require('./helpers');

// Round 43 REPEATRACE (D-125, contract C1): the second-press guard starts at the press that closed the dialog. Round 42 installed the
// guard in the dialog's `close` listener, which the browser runs as a task of its own after the press. A second press sent right after
// the first (a script's back-to-back click, or a busy phone) arrived before that task ran, so it reached the page under the dialog, and
// focus fell to the page body (INB43-1, INB43-2). openModal (public/js/ui.js) now starts the guard in the click that closed the dialog,
// still at most once per dialog, and only when that press closed it. Frontend only: stand-in DOM, ui.js copied to a temp folder.
// R43_RACE_UI_DIR (optional) points the run at another copy of ui.js (used to prove the test red on the round 42 base).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
const UI_DIR = process.env.R43_RACE_UI_DIR || JS;
const REPEAT_TYPES = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']; // ui.js REPEAT_EVENTS, in its order
let ui;
let api;
let tmp;
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r43repeat-'));
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

// A stand-in element with one listener per event name (as in qa-r33-confirm: a second `click` listener on the dialog would replace the
// first, so a test also catches a second one). close() fires the `close` listener a task later, as a browser does, so the click that
// closed the dialog reaches the dialog's own click listener before the close listener runs.
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

// A fresh page: an empty body, an opener button with focus (a dialog opened by a button closes back onto it), and a window with no listeners.
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

test('(race) a second press sent before the browser runs the close event is stopped, and the page never sees it', async () => {
  const w = openConfirm();
  firstPress(w);
  // The close event is still queued, as a browser queues it: the second press (pointer, then click, at the same spot) arrives first.
  const seen = [];
  w.win.addEventListener('click', (e) => seen.push(e));
  const down = winEvent('pointerdown', 815, 512);
  w.win.dispatchEvent(down);
  const again = winEvent('click', 815, 512);
  w.win.dispatchEvent(again);
  await tick(); // the close event runs now; it is awaited before any assert so a failure never leaves it queued for the next test
  assert.equal(w.result(), true);
  assert.equal(down.defaultPrevented, true);
  assert.equal(again.defaultPrevented, true);
  assert.deepEqual(seen, []);
});

test('(once) the guard is installed once per dialog, by the closing press, and the close event does not install it again', async () => {
  const w = openConfirm();
  const added = recordWindowListeners(w.win);
  firstPress(w);
  await tick();
  assert.equal(w.result(), true);
  assert.deepEqual(added, REPEAT_TYPES);
});

test('(window end) 650 ms after the first press the guard is gone', async () => {
  const w = openConfirm();
  firstPress(w);
  await tick();
  const seen = [];
  w.win.addEventListener('click', (e) => seen.push(e));
  await sleep(650);
  const late = winEvent('click', 811, 509);
  w.win.dispatchEvent(late);
  assert.equal(late.defaultPrevented, false);
  assert.equal(seen.length, 1);
});

test('(keyboard) a keyboard press (detail 0) that closed the dialog installs nothing, before or after the close event', async () => {
  const w = openConfirm();
  const seen = [];
  w.win.addEventListener('click', (e) => seen.push(e));
  const added = recordWindowListeners(w.win); // after the test's own listener, so only the code under test is counted
  firstPress(w, 0);
  const before = winEvent('click', 815, 512);
  w.win.dispatchEvent(before);
  await tick();
  assert.equal(w.result(), true);
  assert.deepEqual(added, []);
  assert.equal(before.defaultPrevented, false);
  const after = winEvent('click', 815, 512);
  w.win.dispatchEvent(after);
  assert.equal(after.defaultPrevented, false);
  assert.equal(seen.length, 2);
});

test('(no close) a press with the dialog still open (its text, detail 1) installs nothing', async () => {
  const p = page();
  ui.openModal({ title: 'Details', body: ui.h('p', null, 'Reference 0917.') });
  const dlg = p.body.children.find((x) => x.tagName === 'DIALOG');
  const text = dlg.all().find((x) => x.tagName === 'P');
  const added = recordWindowListeners(p.win);
  dlg.listeners.click(press(text, 811, 509));
  await tick();
  assert.equal(dlg.open, true);
  assert.deepEqual(added, []);
  const again = winEvent('click', 815, 512);
  p.win.dispatchEvent(again);
  assert.equal(again.defaultPrevented, false);
});

test('(no close, form) a form whose save is refused with field errors stays open and installs nothing', async () => {
  const p = page();
  ui.formModal({
    title: 'Edit',
    fields: ui.h('div', null, 'Amount'),
    submitText: 'Save',
    onSubmit: async () => { throw new api.ApiError('Check the amount.', { status: 422, fields: { amount: 'Too small.' } }); },
  });
  const dlg = p.body.children.find((x) => x.tagName === 'DIALOG');
  const form = dlg.all().find((x) => x.tagName === 'FORM');
  form.elements = []; // the stand-in form has no controls: nothing to read or check
  form.contains = () => false; // the focus put-back after a save (the form's own button is not inside it in this stand-in)
  const added = recordWindowListeners(p.win);
  await form.listeners.submit({ preventDefault() { } });
  await tick();
  assert.equal(dlg.open, true);
  assert.deepEqual(added, []);
  const again = winEvent('click', 815, 512);
  p.win.dispatchEvent(again);
  assert.equal(again.defaultPrevented, false);
});
