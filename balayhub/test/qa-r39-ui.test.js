'use strict';
require('./helpers');

// QA r39 lane UI (D-121, contract C2.1 and C2.3): a button whose click handler returns a promise is marked aria-disabled while that
// promise waits (dimmed, still focused), and a press during the wait does nothing. confirmDialog's confirm button uses the same mark.
// Frontend only: ui.js is copied to a temp folder and run against a stand-in DOM, as qa-r33-confirm does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
const REFUSAL = 'Void the refund first, then this payment.';
const tick = () => new Promise((r) => setImmediate(r));

let ui;
let tmp;
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r39ui-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(tmp, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(tmp, 'ui.js')));
});
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

// Stand-in element: attributes, one click listener per event name (as the view's h() adds it), and a focus model in which
// disabled = true on the focused element moves focus to the body, as a browser does.
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = {}; this.children = []; this.style = {}; this.dataset = {}; this.listeners = {};
    this.parentElement = null; this.isConnected = true; this.open = false; this.value = ''; this.checked = false;
    this.classList = { add() { }, remove() { }, contains() { return false; } };
    this.text = undefined; this._disabled = false;
  }
  get disabled() { return this._disabled; }
  set disabled(v) {
    this._disabled = Boolean(v);
    if (this._disabled && globalThis.document.activeElement === this) globalThis.document.activeElement = globalThis.document.body;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(k, f) { this.listeners[k] = f; }
  append(...nodes) {
    for (const x of nodes.flat(Infinity)) if (x && typeof x === 'object') { x.parentElement = this; this.children.push(x); }
  }
  replaceChildren(...nodes) { this.children = []; this.text = undefined; this.append(...nodes); }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((x) => x !== this);
    this.isConnected = false;
  }
  focus() { if (!this._disabled) globalThis.document.activeElement = this; }
  get textContent() { return this.text ?? this.children.map((x) => x.textContent).join(''); }
  set textContent(v) { this.text = String(v); this.children = []; }
  all(out = []) { for (const x of this.children) { out.push(x); x.all(out); } return out; }
  querySelector(sel) {
    return sel.startsWith('input') ? this.all().find((x) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(x.tagName)) || null : null;
  }
  querySelectorAll() { return []; }
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.listeners.close?.(); }
}

// A fresh document for each test: a body, no toasts, no page heading.
function fresh() {
  const body = new El('body');
  const toasts = new El('div');
  globalThis.Node = El;
  globalThis.document = {
    body, activeElement: body,
    createElement: (t) => new El(t),
    createTextNode: (s) => { const x = new El('#text'); x.text = String(s); return x; },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: (id) => (id === 'toasts' ? toasts : null),
  };
  return globalThis.document;
}

// A click as the browser delivers it: the listener runs with the event, and preventDefault is recorded.
function press(el) {
  const ev = { prevented: false, preventDefault() { this.prevented = true; } };
  const returned = el.listeners.click(ev);
  return { ev, returned };
}

test('C2.1 a press on a button whose handler returns a promise dims it until the promise settles, keeps focus, and blocks a second press', async () => {
  const doc = fresh();
  let calls = 0;
  let release;
  const pending = new Promise((r) => { release = r; });
  const b = ui.h('button', { onclick: async () => { calls++; await pending; } }, 'Email booking confirmation');
  doc.body.append(b);
  b.focus();
  press(b);
  assert.equal(calls, 1);
  assert.equal(b.getAttribute('aria-disabled'), 'true', 'dimmed while the request waits');
  assert.notEqual(b.disabled, true, 'not disabled: a disabled button drops focus to the page');
  assert.equal(doc.activeElement, b, 'still focused');
  const second = press(b);
  await tick();
  assert.equal(calls, 1, 'a second press while it waits calls the handler no more');
  assert.equal(second.ev.prevented, true, 'and the second press is stopped');
  release();
  await tick();
  assert.equal(b.getAttribute('aria-disabled'), null, 'the mark goes when the wait ends');
  assert.equal(calls, 1);
});

test('C2.1 a request that fails clears the mark and raises no unhandled rejection', async () => {
  const doc = fresh();
  const unhandled = [];
  const onUnhandled = (err) => unhandled.push(err);
  process.on('unhandledRejection', onUnhandled);
  try {
    let fail;
    const b = ui.h('button', { onclick: async () => { await new Promise((_, rej) => { fail = rej; }); } }, 'Send now');
    doc.body.append(b);
    press(b);
    assert.equal(b.getAttribute('aria-disabled'), 'true', 'dimmed while the request waits');
    fail(new Error(REFUSAL));
    await tick();
    await tick();
    assert.equal(b.getAttribute('aria-disabled'), null, 'the mark goes on a refusal too');
    assert.deepEqual(unhandled, [], 'the refused promise is handled by the guard');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('C2.1 a button dimmed before the press (D-117) keeps its own mark, and its handler still decides what a press does', async () => {
  const doc = fresh();
  let calls = 0;
  const b = ui.h('button', { 'aria-disabled': 'true', onclick: async () => { calls++; } }, 'Turn on');
  doc.body.append(b);
  press(b);
  await tick();
  assert.equal(calls, 1, 'the handler runs and decides');
  assert.equal(b.getAttribute('aria-disabled'), 'true', 'the guard leaves a mark it did not set');
});

test('C2.1 a handler that marks its own button (D-120) is left alone: marked while it waits, cleared after, and a second press reaches it', async () => {
  const doc = fresh();
  let reached = 0;
  let calls = 0;
  let release;
  const b = ui.h('button', {
    onclick: async () => {
      reached++;
      if (b.getAttribute('aria-disabled') === 'true') return; // busy with its own request: a second press does nothing
      calls++;
      b.setAttribute('aria-disabled', 'true');
      try { await new Promise((r) => { release = r; }); } finally { b.removeAttribute('aria-disabled'); }
    },
  }, 'Save');
  doc.body.append(b);
  press(b);
  assert.equal(b.getAttribute('aria-disabled'), 'true');
  press(b);
  await tick();
  assert.equal(reached, 2, 'the second press reaches the handler');
  assert.equal(calls, 1, 'and the handler own guard returns it');
  release();
  await tick();
  assert.equal(b.getAttribute('aria-disabled'), null, 'the handler own mark goes when it ends');
});

test('C2.1 a plain handler, and an async handler on a div or a link, are never marked', async () => {
  const doc = fresh();
  const plain = ui.h('button', { onclick: () => {} }, 'Plain');
  const div = ui.h('div', { onclick: async () => { await new Promise(() => {}); } }, 'Row');
  const link = ui.h('a', { href: '#/x', onclick: async () => { await new Promise(() => {}); } }, 'Open');
  doc.body.append(plain, div, link);
  press(plain);
  press(div);
  press(link);
  await tick();
  assert.equal(plain.getAttribute('aria-disabled'), null);
  assert.equal(div.getAttribute('aria-disabled'), null);
  assert.equal(link.getAttribute('aria-disabled'), null);
});

test('C2.1 a handler that throws before it waits leaves no mark behind', () => {
  const doc = fresh();
  const b = ui.h('button', { onclick: () => { throw new Error('QA r39 boom'); } }, 'Go');
  doc.body.append(b);
  assert.throws(() => press(b), /QA r39 boom/);
  assert.equal(b.getAttribute('aria-disabled'), null);
});

// confirmDialog({ reason: true }) with its confirm button focused, as a click on it would leave it.
function ask(opts) {
  const doc = fresh();
  let result = 'pending';
  ui.confirmDialog({ title: 'Void payment?', text: 'Sure?', reason: true, confirmText: 'Void', ...opts }).then((v) => { result = v; });
  const dlg = doc.body.children[0];
  const all = dlg.all();
  const box = all.find((x) => x.tagName === 'TEXTAREA');
  const confirm = all.find((x) => x.tagName === 'BUTTON' && x.textContent === 'Void');
  const alerts = all.filter((x) => x.attrs.role === 'alert');
  return {
    doc, dlg, box, confirm, refusal: alerts[alerts.length - 1], result: () => result,
    press: () => press(confirm),
  };
}

test('C2.3 confirmDialog: while onConfirm waits the confirm button is aria-disabled (not aria-busy), keeps focus, and a second Confirm does not run it again', async () => {
  let calls = 0;
  let release;
  const w = ask({ onConfirm: () => { calls++; return new Promise((r) => { release = r; }); } });
  w.box.value = 'wrong guest';
  w.confirm.focus();
  w.press();
  assert.equal(w.confirm.getAttribute('aria-disabled'), 'true', 'dimmed while onConfirm waits');
  assert.equal(w.confirm.hasAttribute('aria-busy'), false, 'no aria-busy on the confirm button');
  assert.notEqual(w.confirm.disabled, true, 'not disabled');
  assert.equal(w.doc.activeElement, w.confirm, 'focus stays on Confirm');
  w.press();
  await tick();
  assert.equal(calls, 1, 'a second Confirm does not run onConfirm again');
  assert.equal(w.dlg.open, true, 'the dialog stays open while it waits');
  release();
  await tick();
  assert.equal(w.result(), 'wrong guest');
  assert.equal(w.dlg.open, false, 'a success closes the dialog');
});

test('C2.3 confirmDialog: a refusal clears aria-disabled, says the refusal in the dialog and keeps focus on Confirm', async () => {
  let refuse;
  const w = ask({ onConfirm: () => new Promise((_, rej) => { refuse = rej; }) });
  w.box.value = 'typed reason';
  w.confirm.focus();
  w.press();
  assert.equal(w.confirm.getAttribute('aria-disabled'), 'true', 'dimmed while onConfirm waits');
  refuse(new Error(REFUSAL));
  await tick();
  assert.equal(w.confirm.getAttribute('aria-disabled'), null, 'the mark goes on a refusal');
  assert.equal(w.confirm.hasAttribute('aria-busy'), false);
  assert.equal(w.dlg.open, true, 'the dialog stays open');
  assert.equal(w.refusal.textContent, REFUSAL, 'the server sentence is said in the dialog');
  assert.equal(w.doc.activeElement, w.confirm, 'focus stays on Confirm');
  assert.equal(w.result(), 'pending');
});
