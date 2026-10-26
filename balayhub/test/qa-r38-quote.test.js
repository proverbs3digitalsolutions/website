'use strict';
require('./helpers');

// QA round 38, lane QUOTE (public/js/views/quote.js). Frontend only: no database rows, no server.
// Pay on a guest's quote keeps focus on the button while the checkout request runs (D-97, D-105, D-120).
// A disabled button drops focus to the page, so the button is marked aria-disabled instead, and a second press sends nothing.
// The view runs for real, with the real api.js and i18n.js, against a stand-in ui.js (written below) and a stubbed fetch.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '..', 'public', 'js');
const quoteSrc = fs.readFileSync(path.join(SRC, 'views', 'quote.js'), 'utf8');

const TOKEN = 'qa-r38-quote-token';
const CHECKOUT = '/api/public/quote/qa-r38-quote-token/checkout';
const QUOTE = {
  host: { name: 'QA r38 host', guest_language: 'en' },
  status: 'open',
  listing: { unit_name: 'QA r38 quote unit', property_name: 'QA r38 property', city: 'Tagaytay', house_rules: null },
  check_in: '2027-01-10',
  check_out: '2027-01-12',
  num_guests: 2,
  accommodation_total: 1500,
  cleaning_fee: 0,
  discount_amount: 0,
  addons: [],
  total_amount: 1500,
  amount_due_now: 1500,
  note: null,
  expires_at: '2026-11-30T00:00:00+08:00',
  guest_name: 'QA r38 quote guest',
  guest_email: 'qa-r38-quote@example.test',
  guest_phone: '0917 123 4567',
};

// The stand-in ui.js: the helpers quote.js and i18n.js import, on a small DOM with the browser's focus rules.
const STAND_IN_UI = String.raw`
// Stand-in for public/js/ui.js (QA r38 quote test). Setting disabled on the focused element moves focus to the body,
// as a browser does; so does removing a focused element.
const F = { active: null, body: { tagName: 'BODY', focus() {} } };
F.active = F.body;
globalThis.__r38Focus = F;

const PROPS = ['checked', 'disabled', 'value', 'name', 'type'];
const within = (node, root) => { for (let n = node; n; n = n.parentElement) if (n === root) return true; return false; };
const classes = (n) => (n.attrs.class || '').split(/\s+/).filter(Boolean);
const COND = /\.[\w-]+|\[[\w-]+(?:=[^\]]*)?\]/g;

function matches(n, sel) {
  return sel.split(',').some((part) => {
    const m = /^([a-zA-Z]*)((?:\.[\w-]+|\[[\w-]+(?:=[^\]]*)?\])*)$/.exec(part.trim());
    if (!m) return false;
    if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
    return (m[2].match(COND) || []).every((c) => {
      if (c[0] === '.') return classes(n).includes(c.slice(1));
      const [k, v] = c.slice(1, -1).split('=');
      if (!Object.prototype.hasOwnProperty.call(n.attrs, k)) return false;
      return v === undefined || n.attrs[k] === v;
    });
  });
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.parentElement = null;
    this.name = '';
    this.type = '';
    this.value = '';
    this.checked = false;
    this._disabled = false;
  }
  get disabled() { return this._disabled; }
  set disabled(v) {
    this._disabled = Boolean(v);
    if (this._disabled && F.active === this) F.active = F.body;
  }
  get textContent() { return this.children.map((c) => (c instanceof El ? c.textContent : c)).join(''); }
  set textContent(v) { this.replaceChildren(String(v)); }
  get elements() {
    const out = {};
    const walk = (n) => n.children.forEach((c) => {
      if (!(c instanceof El)) return;
      if (c.name && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(c.tagName)) out[c.name] = c;
      walk(c);
    });
    walk(this);
    return out;
  }
  get classList() {
    const self = this;
    return {
      contains: (c) => classes(self).includes(c),
      add: (c) => { const l = classes(self); if (!l.includes(c)) l.push(c); self.attrs.class = l.join(' '); },
      remove: (c) => { self.attrs.class = classes(self).filter((x) => x !== c).join(' '); },
    };
  }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  focus() { if (!this._disabled) F.active = this; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  // A user event: the listeners run in order; the result settles when the async ones do.
  fire(type, evt = {}) {
    const e = { preventDefault() {}, target: this, ...evt };
    return Promise.all((this.listeners[type] || []).map((fn) => fn(e)));
  }
  append(c) {
    if (c === null || c === undefined || typeof c === 'boolean') return;
    if (c instanceof El) c.parentElement = this;
    this.children.push(c instanceof El ? c : String(c));
  }
  replaceChildren(...list) {
    const old = this.children;
    this.children = [];
    for (const c of old) {
      if (!(c instanceof El)) continue;
      if (F.active && within(F.active, c)) F.active = F.body;
      c.parentElement = null;
    }
    list.flat(Infinity).forEach((c) => this.append(c));
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => n.children.forEach((c) => { if (c instanceof El) { if (matches(c, sel)) out.push(c); walk(c); } });
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) {
    for (let n = this; n instanceof El; n = n.parentElement) if (matches(n, sel)) return n;
    return null;
  }
}

export function h(tag, props, ...kids) {
  const n = new El(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null) continue;
    if (k === 'dataset') { for (const [dk, dv] of Object.entries(v)) n.attrs['data-' + dk] = String(dv); continue; }
    if (typeof v === 'function' && k.startsWith('on')) { n.addEventListener(k.slice(2), v); continue; }
    if (PROPS.includes(k)) n[k] = v;
    if (!PROPS.includes(k) || k === 'name' || k === 'type') n.attrs[k] = String(v);
  }
  n.replaceChildren(...kids);
  return n;
}
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const manilaDay = (d) => String(d).slice(0, 10);
export function brand() { return h('span', { class: 'brand' }, 'BalayHub'); }
export function guardPress() {}
export function field(o) {
  const id = 'f-' + o.name;
  return h('div', { class: 'field', 'data-field': o.name },
    h('label', { for: id }, o.label),
    h('input', { id, name: o.name, type: o.type || 'text', value: o.value || '', required: o.required ? 'true' : undefined,
      autocomplete: o.autocomplete, inputmode: o.inputmode, placeholder: o.placeholder, maxlength: o.maxlength }),
    o.hint ? h('div', { class: 'hint' }, o.hint) : null,
    h('div', { class: 'error' }));
}
export function readForm(form) {
  const out = {};
  for (const [k, c] of Object.entries(form.elements)) out[k] = c.type === 'checkbox' ? c.checked : c.value;
  return out;
}
export function clearErrors(root) {
  root.querySelectorAll('.error').forEach((e) => { e.textContent = ''; });
  root.querySelectorAll('[aria-invalid]').forEach((c) => c.removeAttribute('aria-invalid'));
  root.querySelectorAll('.field--invalid').forEach((w) => w.classList.remove('field--invalid'));
}
export function showErrors(form, problems) {
  const unplaced = [];
  for (const [name, msg] of Object.entries(problems || {})) {
    const c = form.elements[name];
    const wrap = c && c.closest('[data-field]');
    if (!wrap) { unplaced.push(msg); continue; }
    wrap.classList.add('field--invalid');
    c.setAttribute('aria-invalid', 'true');
    const err = wrap.querySelector('.error');
    if (err) err.textContent = msg;
  }
  return unplaced;
}
`;

let dir;
let ui;
let view;
let focus;
let requests = [];
let respond = () => ({ status: 500, body: {} });

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-quote-r38-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(SRC, 'api.js'), path.join(dir, 'api.js'));
  fs.copyFileSync(path.join(SRC, 'i18n.js'), path.join(dir, 'i18n.js'));
  fs.writeFileSync(path.join(dir, 'ui.js'), STAND_IN_UI);
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'views', 'quote.js'), quoteSrc);
  // The page globals the view and i18n.js touch. Storage is absent, as in a private window: i18n.js handles that.
  globalThis.document = { title: '', documentElement: { lang: '', dataset: {} }, getElementById: () => null };
  globalThis.location = { href: 'https://balayhub.test/#/quote/qa-r38-quote-token' };
  globalThis.fetch = (url, opts = {}) => {
    const req = { url, method: opts.method || 'GET', body: opts.body };
    requests.push(req);
    return Promise.resolve(respond(req)).then((r) => ({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: () => 'application/json' },
      json: async () => r.body,
    }));
  };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')).href);
  view = await import(pathToFileURL(path.join(dir, 'views', 'quote.js')).href);
  focus = globalThis.__r38Focus;
});

test.after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// Holds the next checkout request until the test settles it; the quote itself loads at once.
function holdCheckout() {
  let settle;
  const held = new Promise((resolve) => { settle = resolve; });
  respond = (req) => (req.method === 'GET' ? { status: 200, body: QUOTE } : held);
  return (result) => settle(result);
}

// Draws the quote page as a guest sees it, with the details filled in and the consent box ticked.
async function openQuote() {
  requests = [];
  focus.active = focus.body;
  respond = () => ({ status: 200, body: QUOTE });
  const root = ui.h('div');
  await view.quoteView(root, { params: { token: TOKEN } });
  const form = root.querySelector('form');
  const submit = form.querySelectorAll('button').find((b) => b.type === 'submit');
  form.elements.consent.checked = true;
  return { form, submit, formError: form.children[0] };
}

const posts = () => requests.filter((r) => r.method === 'POST');

test('Pay keeps focus on the button while the checkout request runs, and a second press sends nothing', async () => {
  const { form, submit, formError } = await openQuote();
  const settle = holdCheckout();
  submit.focus();
  const pressed = form.fire('submit');
  // The request is still pending: the button is busy (aria-disabled), not switched off, and still has focus.
  assert.equal(submit.getAttribute('aria-disabled'), 'true');
  assert.notEqual(submit.disabled, true);
  assert.equal(focus.active, submit);
  assert.equal(submit.textContent, 'Opening secure payment…');
  // A second press during the wait is refused by the busy flag.
  await form.fire('submit');
  assert.equal(posts().length, 1);
  assert.equal(posts()[0].url, CHECKOUT);
  assert.equal(focus.active, submit);
  // The server refuses: the button is usable again, the refusal shows, and focus has not moved.
  settle({ status: 409, body: { error: 'QA r38 refused.' } });
  await pressed;
  assert.equal(submit.getAttribute('aria-disabled'), null);
  assert.equal(submit.disabled, false);
  assert.equal(submit.textContent, 'Pay ₱1,500.00');
  assert.equal(focus.active, submit);
  assert.match(formError.textContent, /QA r38 refused\./);
});

test('a checkout that goes through hands the guest to PayMongo, and the press cannot send twice', async () => {
  const { form, submit } = await openQuote();
  const settle = holdCheckout();
  submit.focus();
  const pressed = form.fire('submit');
  assert.equal(submit.getAttribute('aria-disabled'), 'true');
  assert.notEqual(submit.disabled, true);
  assert.equal(focus.active, submit);
  await form.fire('submit');
  assert.equal(posts().length, 1);
  settle({ status: 200, body: { checkout_url: 'https://checkout.example.test/qa-r38' } });
  await pressed;
  assert.equal(globalThis.location.href, 'https://checkout.example.test/qa-r38');
  assert.equal(posts().length, 1);
});

test('a refusal that names a field marks that field and still frees the button', async () => {
  const { form, submit, formError } = await openQuote();
  const settle = holdCheckout();
  submit.focus();
  const pressed = form.fire('submit');
  settle({ status: 400, body: { error: 'Check the form.', code: 'VALIDATION', fields: { email: 'Enter a valid email address.' } } });
  await pressed;
  assert.equal(submit.getAttribute('aria-disabled'), null);
  assert.equal(submit.disabled, false);
  assert.equal(focus.active, submit);
  assert.equal(form.elements.email.getAttribute('aria-invalid'), 'true');
  assert.match(form.elements.email.closest('[data-field]').querySelector('.error').textContent, /Enter a valid email address\./);
  assert.match(formError.textContent, /Please check the highlighted fields\./);
});

test('the quote view never switches its pay button off with disabled', () => {
  assert.doesNotMatch(quoteSrc, /submit\.disabled\s*=/);
  assert.match(quoteSrc, /submit\.setAttribute\('aria-disabled', 'true'\);/);
  assert.match(quoteSrc, /submit\.removeAttribute\('aria-disabled'\);/);
});
