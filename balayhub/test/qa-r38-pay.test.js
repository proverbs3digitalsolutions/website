'use strict';
require('./helpers');

// QA round 38, PAY (D-120, contract C1). A control busy with its own request keeps focus. The guest's pay button,
// the add-on button, the screenshot add and take-back buttons and the proof Send button are marked aria-disabled,
// not disabled, while their request runs: focus stays on the control that was pressed, a second press sends
// nothing, and the mark goes when the request settles. The proof form's detail fields still lock with disabled.
// Frontend only.
//
// The page is copied to a temp folder beside stand-in api.js, ui.js and i18n.js, then mounted and driven, so each
// handler runs for real. The stand-in DOM (dom.js) drops focus from a control that is set disabled while it has
// focus, as a browser does, and sends no click to a disabled control.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '../public/js/views/pay.js');

// The stand-in modules. String.raw keeps the regular expressions' backslashes. None of them uses a template literal.
const DOM_JS = String.raw`
export const doc = { activeElement: null, body: null };
class Text_ {
  constructor(data) { this.data = String(data); this.parentElement = null; }
  get textContent() { return this.data; }
}
export class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attrs = {};
    this.listeners = {};
    this._disabled = false;
    this.value = '';
    this.checked = false;
    this.files = [];
    this.hidden = false;
    this.dataset = {};
    this.style = {};
  }
  get disabled() { return this._disabled; }
  set disabled(v) {
    this._disabled = Boolean(v);
    if (this._disabled && doc.activeElement === this) doc.activeElement = doc.body;
  }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = String(v); }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(String(v)); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  add(node) {
    const n = node instanceof El || node instanceof Text_ ? node : new Text_(node);
    n.parentElement = this;
    this.children.push(n);
  }
  append(...nodes) { nodes.forEach((n) => this.add(n)); }
  replaceChildren(...nodes) {
    this.children.forEach((c) => { c.parentElement = null; });
    this.children = [];
    this.append(...nodes);
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, extra = {}) {
    if (type === 'click' && this.disabled) return;
    const ev = { type, target: this, currentTarget: this, defaultPrevented: false, ...extra };
    ev.preventDefault = () => { ev.defaultPrevented = true; };
    for (const fn of this.listeners[type] || []) fn.call(this, ev);
  }
  focus() { if (!this.disabled) doc.activeElement = this; }
  querySelectorAll(sel) {
    const want = sel === '[name]' ? (n) => n.attrs.name !== undefined : (n) => n.tagName === sel.toUpperCase();
    const out = [];
    const walk = (p) => { for (const c of p.children) { if (c instanceof El) { if (want(c)) out.push(c); walk(c); } } };
    walk(this);
    return out;
  }
}
export function h(tag, props, ...kids) {
  const el = new El(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = String(v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  el.append(...kids.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true));
  return el;
}
doc.body = new El('body');
doc.activeElement = doc.body;
export function reset() { doc.activeElement = doc.body; }
`;

const UI_JS = String.raw`
import { h } from './dom.js';
export { h };
export const brand = () => h('a', { class: 'brand' });
export const toast = () => {};
export const field = (f) => h('div', { class: 'field' },
  h('label', { for: f.name }, f.label),
  h('input', { name: f.name, type: 'text', value: f.value === undefined ? '' : f.value }));
export const readForm = (form) => {
  const out = {};
  for (const el of form.querySelectorAll('[name]')) if (el.attrs.type !== 'file') out[el.attrs.name] = el.value;
  return out;
};
export const clearErrors = () => {};
export const showErrors = () => {};
export const parseAmount = (text) => Number(String(text).replace(/[,\s]/g, ''));
export const guardPress = () => {};
`;

const API_JS = String.raw`
export class ApiError extends Error {
  constructor(message, { status = 0, code, fields, data, offline = false } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields || {};
    this.data = data || {};
    this.offline = offline;
  }
}
export const log = { calls: [], get: null, check: null };
export const newIdempotencyKey = () => 'test-key';
export const fileContentError = async () => (log.check ? log.check() : null);
export const get = (url) => log.get(url);
const call = (method, url, body, opts) => new Promise((resolve, reject) => {
  log.calls.push({ method, url, body, opts, resolve, reject });
});
export const post = (url, body, opts) => call('POST', url, body, opts);
export const api = (method, url, body, opts) => call(method, url, body, opts);
`;

const I18N_JS = String.raw`
import { h } from './dom.js';
export const t = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
export const tServer = (message) => message;
export const tFields = (fields) => fields;
export const guestLang = () => 'en';
export const initGuestLang = () => {};
export const langToggle = () => h('button', { type: 'button' }, 'Tagalog');
export const keepFormValues = () => null;
export const restoreFormValues = () => {};
export const fmtDateL = (d) => String(d);
export const extendTranslations = () => {};
`;

let dir;
let dom;
let api;
let mod;

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r38pay-'));
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'dom.js'), DOM_JS);
  fs.writeFileSync(path.join(dir, 'ui.js'), UI_JS);
  fs.writeFileSync(path.join(dir, 'api.js'), API_JS);
  fs.writeFileSync(path.join(dir, 'i18n.js'), I18N_JS);
  fs.copyFileSync(SRC, path.join(dir, 'views', 'pay.js'));
  dom = await import(pathToFileURL(path.join(dir, 'dom.js')));
  api = await import(pathToFileURL(path.join(dir, 'api.js')));
  mod = await import(pathToFileURL(path.join(dir, 'views', 'pay.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const flush = () => new Promise((ok) => setImmediate(ok));
const all = (root, pred) => {
  const out = [];
  const visit = (n) => { for (const c of n.children) { if (c instanceof dom.El) { if (pred(c)) out.push(c); visit(c); } } };
  visit(root);
  return out;
};
const one = (root, pred, what) => {
  const hits = all(root, pred);
  assert.equal(hits.length, 1, `${what}: expected one, found ${hits.length}`);
  return hits[0];
};
const button = (root, text) => one(root, (n) => n.tagName === 'BUTTON' && n.textContent === text, `button "${text}"`);
const alertWith = (root, text) => all(root, (n) => n.attrs.role === 'alert' && n.textContent === text).length;
const refusal = (message) => new api.ApiError(message, { status: 409 });
const methods = () => api.log.calls.map((c) => c.method);
const png = () => [{ name: 'shot.png', size: 1000, type: 'image/png' }];

const bill = { nights: 2, accommodation_total: 600, cleaning_fee: 0, other_fees: 0, charges: [], payments: [], refunds: [], adjustments: 0, total: 600 };
const fixture = (extra = {}) => ({
  host: 'Maria', listing: 'Casa Azul', property: 'Santos House', check_in: '2026-11-01', check_out: '2026-11-03',
  code: 'BH38PAY', guest_first_name: 'Ana', guest_language: 'en', balance: 600, bill,
  accepting: true, cancelled: false, test_mode: false, manual_payments: null, ...extra,
});
// The guest pays by GCash or bank transfer and sends a proof. `pending` is the proofs the host has not checked yet.
const manualFixture = (pending = [], pendingTotal = 0) => fixture({
  accepting: false,
  manual_payments: { accepting: true, instructions: 'GCash 0917 000 0000', pending, pending_total: pendingTotal },
});
const waitingProof = [{ proof_id: 'p1', amount: 300, method: 'gcash', sent_at: '2026-10-20T08:00:00Z', has_file: false }];

// Mounts the pay page for `d` (and the extras offered), then lets the extras load.
async function mount(d, addons = []) {
  dom.reset();
  api.log.calls = [];
  api.log.check = null;
  api.log.get = (url) => Promise.resolve(url.endsWith('/addons') ? { addons } : d);
  const el = dom.h('div');
  await mod.payBalanceView(el, { params: { token: 'tok' }, query: {} });
  await flush();
  return el;
}

test('the pay button stays focused and sends one payment request while it waits', async () => {
  const el = await mount(fixture());
  const pay = one(el, (n) => n.tagName === 'BUTTON' && /^Pay .+ now$/.test(n.textContent), 'pay button');
  const label = pay.textContent;
  pay.focus();
  pay.dispatch('click');
  await flush();
  assert.equal(pay.getAttribute('aria-disabled'), 'true', 'busy: aria-disabled, not disabled');
  assert.notEqual(pay.disabled, true, 'a disabled control drops focus');
  assert.equal(dom.doc.activeElement, pay, 'focus stays on the pay button while it waits');
  pay.dispatch('click');
  await flush();
  assert.equal(api.log.calls.length, 1, 'a second press sends no second request');
  api.log.calls[0].reject(refusal('QA r38 refused.'));
  await flush();
  assert.equal(pay.getAttribute('aria-disabled'), null, 'the mark goes when the request is refused');
  assert.equal(pay.textContent, label, 'the label goes back');
  assert.equal(alertWith(el, 'QA r38 refused.'), 1, 'the refusal is shown');
});

test('the add-on button stays focused and sends one request while the extras are added', async () => {
  const addon = { addon_id: 'ad1', name: 'Airport pickup', description: '', price: 500, pricing: 'per_stay', max_quantity: 1, left: null, bought: 0 };
  const el = await mount(fixture(), [addon]);
  const pick = one(el, (n) => n.attrs.name === 'addon-pick-ad1', 'add-on tick box');
  pick.checked = true;
  pick.dispatch('input');
  const add = button(el, 'Add selected to my bill');
  add.focus();
  add.dispatch('click');
  await flush();
  assert.equal(add.getAttribute('aria-disabled'), 'true', 'busy: aria-disabled, not disabled');
  assert.notEqual(add.disabled, true, 'a disabled control drops focus');
  assert.equal(dom.doc.activeElement, add, 'focus stays on the add-on button while it waits');
  add.dispatch('click');
  await flush();
  assert.equal(api.log.calls.length, 1, 'a second press sends no second request');
  api.log.calls[0].reject(refusal('QA r38 refused.'));
  await flush();
  assert.equal(add.getAttribute('aria-disabled'), null, 'the mark goes when the request is refused');
  assert.equal(add.textContent, 'Add selected to my bill', 'the label goes back');
});

test('the add-screenshot button stays focused and sends one upload while it waits', async () => {
  const el = await mount(manualFixture(waitingProof));
  const file = one(el, (n) => n.attrs.id === 'proof-add-p1', 'screenshot box');
  file.files = png();
  const add = button(el, 'Add the screenshot');
  const back = button(el, 'Take it back');
  add.focus();
  add.dispatch('click');
  await flush();
  assert.equal(add.getAttribute('aria-disabled'), 'true', 'busy: aria-disabled, not disabled');
  assert.equal(back.getAttribute('aria-disabled'), 'true', 'take back is marked busy too');
  assert.notEqual(add.disabled, true, 'a disabled control drops focus');
  assert.equal(dom.doc.activeElement, add, 'focus stays on the add button while it waits');
  back.dispatch('click');
  add.dispatch('click');
  await flush();
  assert.deepEqual(methods(), ['POST'], 'one upload, and no take-back while it runs');
  api.log.calls[0].reject(refusal('QA r38 refused.'));
  await flush();
  assert.equal(add.getAttribute('aria-disabled'), null, 'the mark goes when the upload is refused');
  assert.equal(back.getAttribute('aria-disabled'), null, 'take back is free again');
  assert.equal(add.textContent, 'Add the screenshot', 'the label goes back');
});

// The screenshot is read before it is sent (fileContentError). The file read is held open here, as a slow phone would hold it.
test('the add-screenshot button is busy while its file is read, so a second press sends no second upload', async () => {
  const el = await mount(manualFixture(waitingProof));
  one(el, (n) => n.attrs.id === 'proof-add-p1', 'screenshot box').files = png();
  const add = button(el, 'Add the screenshot');
  const back = button(el, 'Take it back');
  const reads = [];
  api.log.check = () => new Promise((ok) => reads.push(ok));
  add.focus();
  add.dispatch('click');
  await flush();
  assert.equal(add.getAttribute('aria-disabled'), 'true', 'busy while the file is read');
  assert.equal(back.getAttribute('aria-disabled'), 'true', 'take back is marked busy too');
  add.dispatch('click');
  await flush();
  assert.equal(reads.length, 1, 'a second press starts no second file read');
  reads[0](null);
  await flush();
  assert.deepEqual(methods(), ['POST'], 'one upload for the two presses');
});

test('a screenshot refused while it is read clears the busy mark and focuses the file box', async () => {
  const el = await mount(manualFixture(waitingProof));
  const file = one(el, (n) => n.attrs.id === 'proof-add-p1', 'screenshot box');
  file.files = png();
  const add = button(el, 'Add the screenshot');
  const back = button(el, 'Take it back');
  const refused = "This file isn't a real PDF, JPG, PNG or WEBP. Choose the file again.";
  let release;
  api.log.check = () => new Promise((ok) => { release = ok; });
  add.focus();
  add.dispatch('click');
  await flush();
  assert.equal(add.getAttribute('aria-disabled'), 'true', 'busy while the file is read');
  release(refused);
  await flush();
  assert.deepEqual(methods(), [], 'a refused file sends no upload');
  assert.equal(add.getAttribute('aria-disabled'), null, 'the busy mark goes with the refusal');
  assert.equal(back.getAttribute('aria-disabled'), null, 'take back is free again');
  assert.equal(add.textContent, 'Add the screenshot', 'the label is unchanged');
  assert.equal(dom.doc.activeElement, file, 'focus goes to the file box');
  assert.equal(alertWith(el, refused), 1, 'the refusal is shown on the row');
  api.log.check = null;
  add.dispatch('click');
  await flush();
  assert.deepEqual(methods(), ['POST'], 'the button works again: a fresh try goes through');
});

test('the take-back button stays focused and sends one withdrawal while it waits', async () => {
  const el = await mount(manualFixture(waitingProof));
  const add = button(el, 'Add the screenshot');
  const back = button(el, 'Take it back');
  back.focus();
  back.dispatch('click');
  await flush();
  assert.equal(back.getAttribute('aria-disabled'), 'true', 'busy: aria-disabled, not disabled');
  assert.equal(add.getAttribute('aria-disabled'), 'true', 'add is marked busy too');
  assert.notEqual(back.disabled, true, 'a disabled control drops focus');
  assert.equal(dom.doc.activeElement, back, 'focus stays on the take-back button while it waits');
  add.dispatch('click');
  back.dispatch('click');
  await flush();
  assert.deepEqual(methods(), ['DELETE'], 'one withdrawal, and no upload while it runs');
  api.log.calls[0].reject(refusal('QA r38 refused.'));
  await flush();
  assert.equal(back.getAttribute('aria-disabled'), null, 'the mark goes when the withdrawal is refused');
  assert.equal(add.getAttribute('aria-disabled'), null, 'add is free again');
  assert.equal(back.textContent, 'Take it back', 'the label goes back');
});

test('the proof Send button stays focused and sends one proof while the details are saved', async () => {
  const el = await mount(manualFixture());
  one(el, (n) => n.attrs.id === 'proof-file', 'screenshot box').files = png();
  const form = one(el, (n) => n.tagName === 'FORM', 'proof form');
  const send = button(el, 'Send proof');
  send.focus();
  form.dispatch('submit');
  await flush();
  assert.equal(send.getAttribute('aria-disabled'), 'true', 'busy: aria-disabled, not disabled');
  assert.notEqual(send.disabled, true, 'a disabled control drops focus');
  assert.equal(dom.doc.activeElement, send, 'focus stays on Send while it waits');
  form.dispatch('submit');
  await flush();
  assert.deepEqual(methods(), ['POST'], 'a second Send press sends nothing');
  api.log.calls[0].reject(refusal('QA r38 refused.'));
  await flush();
  assert.equal(send.getAttribute('aria-disabled'), null, 'the mark goes when the details are refused');
  assert.equal(send.textContent, 'Send proof', 'the label goes back');
  assert.equal(alertWith(el, 'QA r38 refused.'), 1, 'the refusal is shown');
});

test('the proof Send button stays busy while the screenshot uploads, then the card is redrawn', async () => {
  const el = await mount(manualFixture());
  one(el, (n) => n.attrs.id === 'proof-file', 'screenshot box').files = png();
  const form = one(el, (n) => n.tagName === 'FORM', 'proof form');
  const send = button(el, 'Send proof');
  send.focus();
  form.dispatch('submit');
  await flush();
  api.log.calls[0].resolve({ proof_id: 'p9' });
  await flush();
  assert.deepEqual(methods(), ['POST', 'POST'], 'the details are saved, then the screenshot uploads');
  assert.equal(send.getAttribute('aria-disabled'), 'true', 'busy until the screenshot lands');
  assert.notEqual(send.disabled, true, 'the button itself is not disabled');
  assert.equal(dom.doc.activeElement, send, 'focus stays on Send while the screenshot uploads');
  form.dispatch('submit');
  await flush();
  assert.equal(api.log.calls.length, 2, 'a second Send press sends nothing');
  api.log.calls[1].resolve({});
  await flush();
  assert.equal(all(el, (n) => n.tagName === 'FORM').length, 0, 'the card is redrawn with the thank-you message');
  assert.equal(all(el, (n) => n.tagName === 'H2' && n.textContent === 'Thank you! Your proof was sent.').length, 1);
});

test('the detail fields still lock with disabled, and the busy comment is written once', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  assert.equal(src.split('// aria-disabled, not disabled:').length - 1, 1, 'the busy comment is written once');
  assert.match(src, /form\.querySelectorAll\('\[name\]'\)\.forEach\(\(el\) => \{ el\.disabled = true; \}\);/);
  assert.match(src, /form\.querySelectorAll\('\[name\]'\)\.forEach\(\(el\) => \{ el\.disabled = false; \}\);/);
  assert.doesNotMatch(src, /\b(btn|add|back|submit)\.disabled = (true|false);/);
});
