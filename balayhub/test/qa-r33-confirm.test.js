'use strict';
require('./helpers');

// QA r33 lane CONFIRM (D-115, contract C1): confirmDialog({ onConfirm }) runs the request with the dialog still open; a refusal is said
// inside the dialog, the typed reason stays, focus stays on the confirm button. Frontend-only: stand-in DOM, ui.js copied to temp.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r33confirm-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

const tick = () => new Promise((r) => setImmediate(r));
const REFUSAL = 'Void the refund first, then this payment.';

function ask(opts) {
  class El {
    constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.style = {}; this.dataset = {}; this.isConnected = true; this.listeners = {}; this.classList = { add() { } }; this.value = ''; this.open = false; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    removeAttribute(k) { delete this.attrs[k]; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    hasAttribute(k) { return k in this.attrs; }
    addEventListener(k, f) { this.listeners[k] = f; }
    append(...c) { for (const x of c.flat(Infinity)) { if (x && typeof x === 'object') { x.parentElement = this; this.children.push(x); } } }
    replaceChildren(...c) { this.children = []; this.text = undefined; this.append(...c); }
    get textContent() { return this.text ?? this.children.map((x) => x.textContent).join(''); }
    set textContent(v) { this.text = v; this.children = []; }
    all(out = []) { this.children.forEach((x) => { out.push(x); x.all(out); }); return out; }
    querySelector(sel) { return sel.startsWith('input') ? this.all().find((x) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(x.tagName)) || null : null; }
    querySelectorAll() { return []; }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { if (!this.open) return; this.open = false; this.listeners.close?.(); }
    remove() { }
  }
  globalThis.Node = El;
  const body = new El('body');
  const toasts = new El('div'); toasts.id = 'toasts';
  const sent = [];
  globalThis.document = {
    activeElement: body, body,
    createElement: (t) => new El(t), createTextNode: (s) => { const x = new El('#text'); x.text = String(s); return x; },
    querySelectorAll: () => [], getElementById: () => toasts,
  };
  let result = 'pending';
  ui.confirmDialog({ title: 'Void?', text: 'Sure?', reason: true, confirmText: 'Void', ...opts }).then((v) => { result = v; });
  const dlg = body.children[0];
  const all = dlg.all();
  const box = all.find((x) => x.tagName === 'TEXTAREA');
  const confirm = all.find((x) => x.tagName === 'BUTTON' && x.textContent === 'Void');
  const alerts = all.filter((x) => x.attrs.role === 'alert');
  const refusal = alerts[alerts.length - 1];
  return { dlg, box, confirm, refusal, toasts, sent, result: () => result, press: () => confirm.listeners.click() };
}

test('(a) no onConfirm: the press resolves the trimmed reason and closes', async () => {
  const w = ask({});
  w.box.value = '  because  ';
  w.press();
  await tick();
  assert.equal(w.result(), 'because');
  assert.equal(w.dlg.open, false);
});

test('(b) onConfirm resolving: called once with the trimmed reason, then closes and resolves it', async () => {
  const calls = [];
  const w = ask({ onConfirm: async (v) => { calls.push(v); } });
  w.box.value = ' wrong guest ';
  w.press();
  assert.equal(w.dlg.open, true, 'still open while it runs');
  assert.equal(w.confirm.getAttribute('aria-busy'), 'true');
  await tick();
  assert.deepEqual(calls, ['wrong guest']);
  assert.equal(w.dlg.open, false);
  assert.equal(w.result(), 'wrong guest');
});

test('(c) onConfirm throwing: dialog open, reason kept, sentence in the alert, focus on confirm, promise pending', async () => {
  let n = 0;
  const w = ask({ onConfirm: async () => { n++; throw new Error(REFUSAL); } });
  w.box.value = 'typed reason';
  w.press();
  await tick();
  assert.equal(w.dlg.open, true);
  assert.equal(w.box.value, 'typed reason');
  assert.equal(w.refusal.textContent, REFUSAL);
  assert.match(w.refusal.all()[0].className, /alert alert--error/);
  assert.equal(document.activeElement, w.confirm);
  assert.equal(w.confirm.hasAttribute('aria-busy'), false);
  assert.equal(w.result(), 'pending');
  w.box.listeners.input();
  assert.equal(w.refusal.textContent, '', 'typing clears the line');
  w.press();
  await tick();
  assert.equal(n, 2, 'a second press asks again');
  assert.equal(w.refusal.textContent, REFUSAL);
});

test('(d) a second press while the first is pending calls onConfirm once', async () => {
  let n = 0; let release;
  const w = ask({ onConfirm: () => { n++; return new Promise((r) => { release = r; }); } });
  w.box.value = 'why';
  w.press(); w.press();
  assert.equal(n, 1);
  release(); await tick();
  assert.equal(n, 1);
  assert.equal(w.result(), 'why');
});

test('(e) closed while pending, then it throws: toast gets the message, promise resolves null', async () => {
  let fail;
  const w = ask({ onConfirm: () => new Promise((_, rej) => { fail = rej; }) });
  w.box.value = 'why';
  w.press();
  w.dlg.close();
  assert.equal(w.result(), 'pending', 'closing while it runs does not answer yet');
  fail(new Error(REFUSAL));
  await tick();
  assert.equal(w.toasts.all().some((x) => x.textContent === REFUSAL), true);
  assert.equal(w.result(), null);
});

test('(f) closed while pending, then it succeeds: the promise still resolves the reason', async () => {
  let ok;
  const w = ask({ onConfirm: () => new Promise((r) => { ok = r; }) });
  w.box.value = 'why';
  w.press();
  w.dlg.close();
  ok(); await tick();
  assert.equal(w.result(), 'why');
});
