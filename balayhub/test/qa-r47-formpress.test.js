'use strict';
require('./helpers');

// Round 47 FORMPRESS (D-129, contract C1): a form's Save counts its own second press once, as a button with its own press handler does
// (D-126). makeForm's Save is a submit button with no onclick, so pressGuard never wrapped it: a second press about 100 ms after Save payout
// closed the "Pay more than the statement?" question that the first press had just opened, and a second press after Send to support
// opened the new ticket moved focus to the page body. makeForm now calls guardPress from the Save button's own click listener.
// Frontend only: stand-in DOM, ui.js and api.js copied to a temp folder. R47_FORM_UI_DIR (optional) points the run at another copy of
// ui.js (used to prove the test red on the round 46 base and to re-break the fix).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
const UI_DIR = process.env.R47_FORM_UI_DIR || JS;
const REPEAT_TYPES = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']; // ui.js REPEAT_EVENTS, in its order
let ui;
let tmp;
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r47form-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(JS, 'api.js'), path.join(tmp, 'api.js'));
  fs.copyFileSync(path.join(UI_DIR, 'ui.js'), path.join(tmp, 'ui.js'));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(tmp, 'ui.js')));
});
test.after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A stand-in element that keeps every listener per event (makeForm adds submit, input and change to the form; a real element keeps them all).
// fire(type, event) calls the listeners in the order they were added, as a click on the element does.
class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.style = {}; this.dataset = {}; this.isConnected = true; this.listeners = {}; this.classList = { add() { }, remove() { }, contains: () => false }; this.value = ''; this.open = false; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(k, f) { (this.listeners[k] ??= []).push(f); }
  fire(k, ev) { for (const f of this.listeners[k] ?? []) f(ev); }
  append(...c) { for (const x of c.flat(Infinity)) { if (x && typeof x === 'object') { x.parentElement = this; this.children.push(x); } } }
  replaceChildren(...c) { this.children = []; this.text = undefined; this.append(...c); }
  get textContent() { return this.text ?? this.children.map((x) => x.textContent).join(''); }
  set textContent(v) { this.text = v; this.children = []; }
  all(out = []) { this.children.forEach((x) => { out.push(x); x.all(out); }); return out; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  focus() { document.activeElement = this; }
  remove() { }
}

// The window stand-in. Node's EventTarget does not match a boolean capture flag on removeEventListener the way a browser does (a listener
// added with `true` stays and still runs), so a boolean is passed on as { capture } for both add and remove (as qa-r45-presschange does).
class StandWindow extends EventTarget {
  addEventListener(type, fn, opts) { super.addEventListener(type, fn, typeof opts === 'boolean' ? { capture: opts } : opts); }
  removeEventListener(type, fn, opts) { super.removeEventListener(type, fn, typeof opts === 'boolean' ? { capture: opts } : opts); }
}

// A fresh page: an empty body, an opener button with focus, and a window with no listeners.
function page() {
  const body = new El('body');
  const opener = new El('button');
  body.append(opener);
  const win = new StandWindow();
  globalThis.Node = El;
  globalThis.window = win;
  globalThis.document = {
    activeElement: opener, body,
    createElement: (t) => new El(t),
    createTextNode: (s) => { const x = new El('#text'); x.text = String(s); return x; },
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
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

// A form the way a view builds one (no fields, no cancel), with its Save button: the submit button among the form's children.
function formWithSave() {
  const p = page();
  const form = ui.makeForm({ fields: [], onSubmit: async () => {} });
  const save = form.all().find((x) => x.tagName === 'BUTTON' && x.attrs.type === 'submit');
  assert.ok(save, 'makeForm builds a submit button');
  return { ...p, form, save };
}

test('(installed) a mouse press on Save adds the five press listeners and the change listener to the window; a keyboard press adds none', () => {
  const w = formWithSave();
  const added = recordWindowListeners(w.win);
  w.save.fire('click', press(w.save, 811, 509));
  assert.deepEqual(added, [...REPEAT_TYPES, 'input']);
  const keyboard = recordWindowListeners(w.win);
  w.save.fire('click', press(w.save, 811, 509, 0));
  assert.deepEqual(keyboard, []);
});

test('(stopped) after a press on Save, a second press at the spot is stopped: its pointerdown and click never reach the page', () => {
  const w = formWithSave();
  w.save.fire('click', press(w.save, 811, 509));
  const seen = [];
  w.win.addEventListener('click', (e) => seen.push(e));
  const down = winEvent('pointerdown', 815, 512);
  w.win.dispatchEvent(down);
  const again = winEvent('click', 815, 512);
  w.win.dispatchEvent(again);
  assert.equal(down.defaultPrevented, true);
  assert.equal(again.defaultPrevented, true);
  assert.deepEqual(seen, []);
});

test('(far) a press 34 px away from the spot is not stopped', () => {
  const w = formWithSave();
  w.save.fire('click', press(w.save, 811, 509));
  const near = winEvent('click', 815, 512);
  w.win.dispatchEvent(near);
  assert.equal(near.defaultPrevented, true); // the guard is in place
  const far = winEvent('click', 845, 509);
  w.win.dispatchEvent(far);
  assert.equal(far.defaultPrevented, false);
});

test('(window end) 650 ms after the press, a press at the same spot is not stopped', async () => {
  const w = formWithSave();
  w.save.fire('click', press(w.save, 811, 509));
  const near = winEvent('click', 815, 512);
  w.win.dispatchEvent(near);
  assert.equal(near.defaultPrevented, true); // the guard is in place
  await sleep(650);
  const late = winEvent('click', 811, 509);
  w.win.dispatchEvent(late);
  assert.equal(late.defaultPrevented, false);
});

test('(change) a change the person makes ends the guard: the next press at the spot is not stopped (D-127)', () => {
  const w = formWithSave();
  w.save.fire('click', press(w.save, 811, 509));
  const near = winEvent('click', 815, 512);
  w.win.dispatchEvent(near);
  assert.equal(near.defaultPrevented, true); // the guard is in place
  const typed = new Event('input');
  Object.defineProperty(typed, 'isTrusted', { value: true }); // the person's own input, not a script's
  w.win.dispatchEvent(typed);
  const next = winEvent('click', 815, 512);
  w.win.dispatchEvent(next);
  assert.equal(next.defaultPrevented, false);
});

test('(source) makeForm\'s Save installs the guard from its own click listener, after its button is made and before the submit listener', () => {
  const src = fs.readFileSync(path.join(UI_DIR, 'ui.js'), 'utf8');
  const start = src.indexOf('export function makeForm(');
  const end = src.indexOf("form.addEventListener('submit'", start);
  assert.ok(start > 0 && end > start, 'makeForm and its submit listener are in ui.js');
  const body = src.slice(start, end);
  const line = 'submitBtn.addEventListener(\'click\', (e) => guardPress(e, submitBtn));';
  assert.equal(body.split(line).length - 1, 1);
  assert.ok(body.indexOf("const submitBtn = h('button'") < body.indexOf(line));
});
