'use strict';
require('./helpers'); // before anything else, so a later edit cannot load app code first (round 29 gate)

// QA r30 FORMCHECK (OPS-2, LT-1): makeForm waits for a view's check when it returns a promise (the first-bytes file check, D-112),
// so a file problem shows in the same save as every other problem. A check that returns a plain value behaves exactly as before.
// Frontend-only: a tiny fake DOM, the real ui.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
const SRC = fs.readFileSync(path.join(JS, 'ui.js'), 'utf8');

class FakeEl {
  constructor(tag) {
    this.tag = tag; this.attrs = {}; this.dataset = {}; this.children = []; this.listeners = {}; this.classSet = new Set();
    this.style = { setProperty() {} }; this.isConnected = true; this.textContent = '';
    this.classList = { add: (k) => this.classSet.add(k), remove: (k) => this.classSet.delete(k), contains: (k) => this.classSet.has(k) };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  append(...c) { this.children.push(...c); }
  replaceChildren(...c) { this.children = c; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  contains() { return false; }
  closest() { return null; }
  focus() {}
}

let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r30fc-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Node = FakeEl;
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  globalThis.document = { createElement: (t) => new FakeEl(t), createTextNode: (t) => String(t), querySelectorAll: () => [], activeElement: null };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

// A form with an empty required "amount" (or a filled one) and a "photo" field the check can mark.
function mount({ amount = '', check, onSubmit }) {
  const form = ui.makeForm({ fields: [], check, onSubmit });
  const wraps = {};
  for (const n of ['amount', 'photo']) {
    const w = new FakeEl('div'); w.err = new FakeEl('div'); w.control = new FakeEl('input');
    w.querySelector = (s) => (s === '.error' ? w.err : w.control);
    wraps[n] = w;
  }
  form.querySelector = (s) => wraps[/data-field="(\w+)"/.exec(s)?.[1]] || null;
  form.elements = [{ name: 'amount', required: true, value: amount, type: 'text', dataset: {} }, { name: 'photo', value: '', type: 'file', dataset: {} }];
  return { wraps, submit: () => form.listeners.submit[0]({ preventDefault() {} }) };
}

test('(1) a required field left empty and an async check that resolves a file problem: one save shows both, onSubmit is not called', async () => {
  let calls = 0;
  const m = mount({ check: async () => ({ photo: 'P' }), onSubmit: async () => { calls++; } });
  await m.submit();
  assert.equal(m.wraps.amount.err.textContent, 'This field is required.');
  assert.equal(m.wraps.photo.err.textContent, 'P');
  assert.equal(calls, 0);
});

test('(2) an async check that resolves null with every field fine: onSubmit runs once', async () => {
  let calls = 0;
  const m = mount({ amount: '10', check: async () => null, onSubmit: async () => { calls++; } });
  await m.submit();
  assert.equal(calls, 1);
});

test('(3) an async check that rejects counts as no problem: onSubmit runs and the form is free for another save', async () => {
  let calls = 0;
  const m = mount({ amount: '10', check: async () => { throw new Error('read failed'); }, onSubmit: async () => { calls++; } });
  await m.submit();
  assert.equal(calls, 1);
  await m.submit();
  assert.equal(calls, 2, 'busy was cleared');
});

test('(4) a sync check still marks its field before the submit handler\'s first await', () => {
  const m = mount({ amount: '10', check: () => ({ photo: 'X' }), onSubmit: async () => assert.fail('must not save') });
  const p = m.submit();
  assert.equal(m.wraps.photo.err.textContent, 'X');
  assert.ok(m.wraps.photo.classSet.has('field--invalid'));
  return p;
});

test('(5) two submits while the async check is pending: onSubmit runs once', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const m = mount({ amount: '10', check: () => gate.then(() => null), onSubmit: async () => { calls++; } });
  const a = m.submit();
  const b = m.submit();
  release();
  await Promise.all([a, b]);
  assert.equal(calls, 1);
});

test('source: the text check?.(readForm(form), form) is still present once', () => {
  assert.equal(SRC.split('check?.(readForm(form), form)').length - 1, 1);
});
