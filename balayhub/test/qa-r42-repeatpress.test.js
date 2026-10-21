'use strict';
require('./helpers');

// Round 42 REPEATPRESS (D-124, contract C1): a press that closes a dialog swallows its own second press. A double click or a double tap
// on a dialog's button closes the dialog with the first press (D-122), and the second press then landed on whatever was under that spot
// (a file label opened the camera; on a phone the bottom bar's More sheet opened). openModal (public/js/ui.js) now stops a second real
// press within 600 ms and 30 px of the first, and only for those 600 ms. Frontend only: stand-in DOM, ui.js copied to a temp folder.
// R42_REPEAT_UI_DIR (optional) points the run at another copy of ui.js (used to prove the test red on the round 42 base).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
const UI_DIR = process.env.R42_REPEAT_UI_DIR || JS;
let ui;
let tmp;
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r42repeat-'));
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

// A stand-in element with one listener per event name (as in qa-r33-confirm: a second `click` listener on the dialog would replace the
// first, so the test also catches a second one). close() fires the `close` listener a task later, as a browser does, so the click that
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

test('isRepeatPress: within 600 ms and 30 px of the first press, and nothing else', () => {
  assert.equal(ui.REPEAT_PRESS_MS, 600);
  assert.equal(ui.REPEAT_PRESS_PX, 30);
  const first = { x: 100, y: 200, t: 1000 };
  assert.equal(ui.isRepeatPress(first, { clientX: 105, clientY: 195 }, 1250), true);
  assert.equal(ui.isRepeatPress(first, { clientX: 105, clientY: 195 }, 1601), false);
  assert.equal(ui.isRepeatPress(first, { clientX: 131, clientY: 200 }, 1250), false);
  assert.equal(ui.isRepeatPress(first, { clientX: 100, clientY: 231 }, 1250), false);
  assert.equal(ui.isRepeatPress(null, { clientX: 100, clientY: 200 }, 1250), false);
});

test('(a) a double click that closed the dialog: the second press is stopped and the page never sees it', async () => {
  const w = openConfirm();
  firstPress(w);
  await tick(); // the dialog's close event runs now: the rest of the 600 ms window is guarded
  assert.equal(w.result(), true);
  const seen = [];
  w.win.addEventListener('click', (e) => seen.push(e));
  const down = winEvent('pointerdown', 815, 512);
  w.win.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  const again = winEvent('click', 815, 512);
  w.win.dispatchEvent(again);
  assert.equal(again.defaultPrevented, true);
  assert.deepEqual(seen, []);
  const key = winEvent('keydown', 815, 512);
  let keys = 0;
  w.win.addEventListener('keydown', () => { keys += 1; });
  w.win.dispatchEvent(key);
  assert.equal(keys, 1); // keys are never stopped
  const away = winEvent('click', 900, 509); // 89 px from the first press: a different spot, not stopped
  w.win.dispatchEvent(away);
  assert.equal(away.defaultPrevented, false);
  assert.equal(seen.length, 1);
});

test('(b) 600 ms after the first press the guard is gone', async () => {
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

test('(c) a keyboard press (detail 0) that closed the dialog installs nothing', async () => {
  const w = openConfirm();
  firstPress(w, 0);
  await tick();
  assert.equal(w.result(), true);
  const seen = [];
  w.win.addEventListener('click', (e) => seen.push(e));
  const again = winEvent('click', 815, 512);
  w.win.dispatchEvent(again);
  assert.equal(again.defaultPrevented, false);
  assert.equal(seen.length, 1);
});

test('(d) a press that does not close the dialog installs nothing', async () => {
  const p = page();
  let saves = 0;
  const save = ui.h('button', { type: 'button', onclick: () => { saves += 1; } }, 'Save');
  ui.openModal({ title: 'Edit', body: ui.h('div', null, save) });
  const dlg = p.body.children.find((x) => x.tagName === 'DIALOG');
  save.listeners.click(press(save, 811, 509));
  dlg.listeners.click(press(save, 811, 509));
  await tick();
  assert.equal(saves, 1);
  assert.equal(dlg.open, true);
  const seen = [];
  p.win.addEventListener('click', (e) => seen.push(e));
  const again = winEvent('click', 815, 512);
  p.win.dispatchEvent(again);
  assert.equal(again.defaultPrevented, false);
  assert.equal(seen.length, 1);
});

test('(e) a click with detail 0 (keyboard activation, assistive tech, or script el.click()) at the same spot is not stopped', async () => {
  const w = openConfirm();
  firstPress(w);
  await tick();
  assert.equal(w.result(), true);
  const seen = [];
  w.win.addEventListener('click', (e) => seen.push(e));
  const keyboardClick = winEvent('click', 815, 512, 0);
  w.win.dispatchEvent(keyboardClick);
  assert.equal(keyboardClick.defaultPrevented, false);
  assert.equal(seen.length, 1);
});

test('(f) a click with detail 1 at the same spot after the dialog closed is still stopped', async () => {
  const w = openConfirm();
  firstPress(w);
  await tick();
  assert.equal(w.result(), true);
  const seen = [];
  w.win.addEventListener('click', (e) => seen.push(e));
  const pointerClick = winEvent('click', 815, 512, 1);
  w.win.dispatchEvent(pointerClick);
  assert.equal(pointerClick.defaultPrevented, true);
  assert.deepEqual(seen, []);
});
