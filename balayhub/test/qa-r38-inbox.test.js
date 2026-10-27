'use strict';
require('./helpers');

// QA round 38, INBOX (PHN-2, D-120 class (b)). The composer's Send / Save note and "Draft reply with AI" are busy while their own
// request runs. They are marked aria-disabled, never disabled, so they keep focus; a second press sends nothing. Frontend only, no database.
//
// The real composer() from public/js/views/inbox.js runs in a temp folder with stand-in ui.js, api.js, app.js, filters.js and
// reservations.js modules, on a stand-in page where setting disabled on the focused control moves focus to the body, as a browser does.
// R38_INBOX_SRC (optional) points the test at another copy of inbox.js; the round 37 copy is used to prove this test red.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = process.env.R38_INBOX_SRC || path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js');
const LIB = '__r38_inbox_lib';

// The stand-in page: the element with focus, and the body.
const page = { activeElement: null, body: null };

class FakeNode {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.value = '';
    this.hidden = false;
    this.placeholder = '';
    this._disabled = false;
    this._classes = new Set();
    this._text = '';
  }
  get disabled() { return this._disabled; }
  set disabled(v) { this._disabled = Boolean(v); if (this._disabled && page.activeElement === this) page.activeElement = page.body; }
  focus() { if (!this._disabled) page.activeElement = this; }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const set = this._classes;
    return {
      contains: (c) => set.has(c),
      toggle: (c, force) => { const on = force ?? !set.has(c); if (on) set.add(c); else set.delete(c); return on; },
    };
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  // As in a browser: currentTarget is this element while its listeners run, and null once the dispatch ends.
  dispatchEvent(ev) {
    const e = { type: ev.type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} };
    const out = (this.listeners[ev.type] || []).map((fn) => fn(e));
    e.currentTarget = null;
    return out;
  }
  append(...nodes) {
    for (const c of nodes.flat(Infinity)) {
      if (c === null || c === undefined || c === false || c === true) continue;
      if (c instanceof FakeNode) { c.parent = this; this.children.push(c); } else this._text += String(c);
    }
  }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  closest(sel) { for (let x = this; x; x = x.parent) if (x._classes.has(sel.replace(/^\./, ''))) return x; return null; }
  replaceChildren(...nodes) { for (const c of this.children) c.parent = null; this.children = []; this.append(...nodes); }
  setSelectionRange() {}
}

// Same mapping as public/js/ui.js h().
function h(tag, props, ...children) {
  const el = new FakeNode(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' && ['input', 'textarea', 'select'].includes(tag)) el.value = v;
    else if (k === 'disabled' || k === 'hidden' || k === 'checked' || k === 'selected') el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  el.append(...children);
  return el;
}

const toasts = [];
const calls = [];
const pending = [];
let rerenders = 0;

const lib = {
  h,
  icon: () => new FakeNode('span'),
  toast: (msg, kind = 'info') => { toasts.push({ msg, kind }); },
  fmtDateTime: (v) => String(v),
  confirmDialog: async () => true,
  get: async () => ({}),
  // Every post waits until the test settles it, so the test can look at the page while the request is still pending.
  post: (url, body) => { calls.push({ url, body }); return new Promise((resolve, reject) => { pending.push({ resolve, reject }); }); },
  patch: async () => ({}),
  qs: () => '',
};

const STUBS = {
  'ui.js': [
    `const L = globalThis.${LIB};`,
    'export const h = (...a) => L.h(...a);',
    'export const icon = (...a) => L.icon(...a);',
    'export const toast = (...a) => L.toast(...a);',
    'export const guardPress = () => {};',
    'export const fmtDateTime = (...a) => L.fmtDateTime(...a);',
    'export const confirmDialog = (...a) => L.confirmDialog(...a);',
    "export const peso = () => ''; export const fmtDate = () => ''; export const badge = () => null; export const field = () => null;",
    'export const formModal = () => null; export const emptyState = () => null; export const openModal = () => null;',
    "export const todayManila = () => '2026-10-21';",
  ].join('\n'),
  'api.js': [
    `const L = globalThis.${LIB};`,
    'export const get = (...a) => L.get(...a);',
    'export const post = (...a) => L.post(...a);',
    'export const patch = (...a) => L.patch(...a);',
    'export const qs = (...a) => L.qs(...a);',
  ].join('\n'),
  'app.js': 'export const state = { user: null };\nexport const navigate = () => {};\n',
  'filters.js': [
    'export const initFilters = () => {};',
    'export const filterBar = () => null;',
    'export const rememberFilters = () => {};',
    'export const changed = () => false;',
    'export const apiFilters = () => ({});',
  ].join('\n'),
  'views/reservations.js': 'export const CHANNEL_LABEL = {};\n',
};

let dir;
let composer;
test.before(async () => {
  globalThis[LIB] = lib;
  page.body = new FakeNode('body');
  page.activeElement = page.body;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r38-inbox-'));
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const [file, text] of Object.entries(STUBS)) fs.writeFileSync(path.join(dir, file), `${text}\n`);
  // composer() is not exported. The copy adds one export line; the product file is read as it is.
  fs.writeFileSync(path.join(dir, 'views', 'inbox.js'), `${fs.readFileSync(SRC, 'utf8')}\nexport { composer };\n`);
  ({ composer } = await import(pathToFileURL(path.join(dir, 'views', 'inbox.js')).href));
});
test.after(() => {
  delete globalThis[LIB];
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

function reset() {
  calls.length = 0;
  pending.length = 0;
  toasts.length = 0;
  rerenders = 0;
  page.activeElement = page.body;
}

let seq = 0;
function mount(status = {}) {
  seq += 1;
  const c = { conversation_id: `c-r38-${seq}`, booking_id: `b-r38-${seq}`, guest_name: 'Bea Reyes', guest_email: 'bea.reyes@example.test' };
  const form = composer(c, [], status, () => { rerenders += 1; });
  return { c, form };
}

const all = (n) => n.children.flatMap((c) => [c, ...all(c)]);
const one = (root, pred, what) => {
  const hit = all(root).find(pred);
  assert.ok(hit, `${what} is on the page`);
  return hit;
};
const textarea = (form) => one(form, (n) => n.tagName === 'TEXTAREA', 'the message box');
const saveButton = (form) => one(form, (n) => n.tagName === 'BUTTON' && n.getAttribute('type') === 'submit', 'the Send button');
const button = (root, label) => one(root, (n) => n.tagName === 'BUTTON' && n.textContent === label, `the "${label}" button`);

test('Save note keeps focus while the note saves, a second press sends nothing, and the busy mark is released after success', async () => {
  reset();
  const { c, form } = mount();
  button(form, 'Internal note').dispatchEvent({ type: 'click' });
  textarea(form).value = 'QA r38 note';
  const send = saveButton(form);
  send.focus(); // a press on the submit button focuses it
  const first = form.dispatchEvent({ type: 'submit' });
  assert.equal(calls.length, 1, 'one request is sent');
  assert.equal(calls[0].url, `/inbox/${c.conversation_id}/messages`);
  assert.equal(send.getAttribute('aria-disabled'), 'true', 'Save note is marked busy while the note saves');
  assert.notEqual(send.disabled, true, 'Save note is not natively disabled');
  assert.equal(page.activeElement, send, 'focus stays on Save note while the note saves');
  form.dispatchEvent({ type: 'submit' });
  assert.equal(calls.length, 1, 'a second press sends no second request');
  pending[0].resolve({ message: { status: 'note' }, mentions: [] });
  await Promise.all(first);
  assert.equal(send.getAttribute('aria-disabled'), null, 'the busy mark is released once the note is saved');
  assert.equal(rerenders, 1, 'the thread redraws once');
  assert.ok(toasts.some((t) => t.msg === 'Note saved.'), 'the saved note is confirmed');
});

test('a refused note releases Save note, keeps focus on it and shows the reason', async () => {
  reset();
  const { form } = mount();
  button(form, 'Internal note').dispatchEvent({ type: 'click' });
  textarea(form).value = 'QA r38 note';
  const send = saveButton(form);
  send.focus();
  const first = form.dispatchEvent({ type: 'submit' });
  assert.equal(send.getAttribute('aria-disabled'), 'true', 'Save note is marked busy while the note saves');
  assert.notEqual(send.disabled, true, 'Save note is not natively disabled');
  assert.equal(page.activeElement, send, 'focus stays on Save note while the note saves');
  pending[0].reject(Object.assign(new Error('Message is too long.'), { fields: { body: 'Message is too long.' } }));
  await Promise.all(first);
  assert.equal(send.getAttribute('aria-disabled'), null, 'the busy mark is released after a refusal');
  assert.equal(page.activeElement, send, 'focus is still on Save note after a refusal');
  assert.equal(one(form, (n) => n.getAttribute('role') === 'alert', 'the error line').textContent, 'Message is too long.');
  assert.equal(rerenders, 0, 'nothing is redrawn after a refusal');
});

test('Draft reply with AI keeps focus while the draft is written, a second press asks nothing, and the busy mark is released after the draft', async () => {
  reset();
  const { c, form } = mount({ ai_drafts: true });
  const body = textarea(form);
  body.value = 'Can I check in early?';
  const ai = button(form, '✨ Draft reply with AI');
  ai.focus();
  const first = ai.dispatchEvent({ type: 'click' });
  assert.equal(calls.length, 1, 'one draft is asked for');
  assert.equal(calls[0].url, `/inbox/${c.conversation_id}/ai-draft`);
  assert.deepEqual(calls[0].body, { instructions: 'Can I check in early?' });
  assert.equal(ai.getAttribute('aria-disabled'), 'true', 'the AI button is marked busy while the draft is written');
  assert.notEqual(ai.disabled, true, 'the AI button is not natively disabled');
  assert.equal(page.activeElement, ai, 'focus stays on the AI button while the draft is written');
  ai.dispatchEvent({ type: 'click' });
  assert.equal(calls.length, 1, 'a second press asks for no second draft');
  pending[0].resolve({ draft: 'Yes, you can check in from 1 PM.' });
  await Promise.all(first);
  assert.equal(body.value, 'Yes, you can check in from 1 PM.', 'the draft goes into the message box');
  assert.equal(ai.getAttribute('aria-disabled'), null, 'the busy mark is released after the draft');
  assert.equal(ai.textContent, '✨ Draft reply with AI', 'the button shows its own words again');
});

test('a refused draft releases the AI button, keeps focus on it and says why', async () => {
  reset();
  const { form } = mount({ ai_drafts: true });
  textarea(form).value = 'Can I check in early?';
  const ai = button(form, '✨ Draft reply with AI');
  ai.focus();
  const first = ai.dispatchEvent({ type: 'click' });
  assert.equal(ai.getAttribute('aria-disabled'), 'true', 'the AI button is marked busy while the draft is written');
  assert.notEqual(ai.disabled, true, 'the AI button is not natively disabled');
  assert.equal(page.activeElement, ai, 'focus stays on the AI button while the draft is written');
  pending[0].reject(new Error('QA r38 refused.'));
  await Promise.all(first);
  assert.equal(ai.getAttribute('aria-disabled'), null, 'the busy mark is released after a refusal');
  assert.equal(ai.textContent, '✨ Draft reply with AI', 'the button shows its own words again');
  assert.ok(toasts.some((t) => t.msg === 'QA r38 refused.' && t.kind === 'error'), 'the refusal is shown');
});
