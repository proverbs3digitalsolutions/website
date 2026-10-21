'use strict';
require('./helpers');

// QA round 38 (lane SETTINGS, D-120): a control that is waiting for its own request keeps focus.
// Covers settings.js rows 11 to 14 of the round 38 audit: the plan renewal Change and Save (cardBlock), the payOnline
// buttons (Pay now, Pay another way, Pay with the saved card) and Guest experience Save.
// The views run against a stand-in DOM with ui.js, api.js, app.js and the other imports stubbed, and the real
// billingcoupon.js. The stand-in drops focus to the page when a focused control is switched off with `disabled`, as a
// browser does. QA_R38_SETTINGS_SRC lets the red run point at the round 37 copy of settings.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SETTINGS_SRC = process.env.QA_R38_SETTINGS_SRC || path.join(__dirname, '..', 'public', 'js', 'views', 'settings.js');
const BILLING_SRC = path.join(__dirname, '..', 'public', 'js', 'views', 'billingcoupon.js');

class El {
  constructor(tag) {
    this.tag = tag; this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.listeners = {};
    this.hidden = false; this.value = ''; this.checked = false; this._disabled = false; this._t = '';
  }
  get disabled() { return this._disabled; }
  set disabled(v) { // a focused control switched off drops focus to the page (D-97, D-105)
    this._disabled = Boolean(v);
    if (this._disabled && document.activeElement === this) document.activeElement = document.body;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { this.listeners[t] = f; }
  append(...c) { this.children.push(...c); }
  replaceChildren(...c) { this.children = c; }
  focus() { if (!this._disabled) document.activeElement = this; }
  set textContent(v) { this._t = String(v); this.children = []; }
  get textContent() { return this._t + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  fire(t, init = {}) { return this.listeners[t]?.({ type: t, preventDefault() {}, target: this, currentTarget: this, ...init }); }
  all(f, out = []) { if (f(this)) out.push(this); this.children.forEach((c) => c.all && c.all(f, out)); return out; }
}

const pageBody = new El('body');
const waits = []; // every POST and PATCH the views send; each waits until the test settles it
const toasts = [];
const nav = [];
const GUEST_SETTINGS = () => ({ review_links: [{ label: 'Google', url: 'https://g.page/balay' }], returning_guest_pct: 10, abandoned_followup: false });
let rerenders = 0;
let refreshes = 0;
let settings;
let bc;
let dir;

globalThis.__r38 = {
  send: (url, body) => new Promise((res, rej) => waits.push({ url, body, res, rej })),
  get: async () => GUEST_SETTINGS(),
  toast: (msg, kind) => toasts.push([msg, kind || 'info']),
  refresh: () => { refreshes += 1; },
};

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r38-settings-'));
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'ui.js'), `
    export function h(tag, props, ...kids) {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(props || {})) {
        if (k === 'value') { el.value = v == null ? '' : String(v); continue; }
        if (k === 'checked') { el.checked = Boolean(v); continue; }
        if (k === 'disabled') { el.disabled = Boolean(v); continue; }
        if (v === undefined || v === null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'hidden') el.hidden = true;
        else if (k === 'class') el.className = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
      el.append(...kids.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
      return el;
    }
    export const toast = (m, k) => globalThis.__r38.toast(m, k);
    export const fmtDate = (d) => { const [y, m, day] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };
    export const fmtMonth = fmtDate; export const fmtDateTime = fmtDate; export const peso = (v) => String(v);
    export const icon = () => null; export const label = (x) => x; export const field = () => null; export const formModal = () => null;
    export const confirmDialog = async () => false; export const emptyState = () => null; export const pageHead = () => null;
    export const openModal = () => null; export const clearErrors = () => null; export const showErrors = () => null;`);
  fs.writeFileSync(path.join(dir, 'api.js'), `
    export class ApiError extends Error { constructor(m, o = {}) { super(m); Object.assign(this, o); } }
    export const post = (u, b) => globalThis.__r38.send(u, b);
    export const patch = (u, b) => globalThis.__r38.send(u, b);
    export const get = (u) => globalThis.__r38.get(u);
    export const api = async () => ({});`);
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = {}; export async function refreshUser() { globalThis.__r38.refresh(); }\n');
  fs.writeFileSync(path.join(dir, 'notifications.js'), 'export async function notificationsCard() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'themeswitch.js'), 'export function themeSwitch() { return null; }\n');
  fs.copyFileSync(BILLING_SRC, path.join(dir, 'views', 'billingcoupon.js'));
  // guestExperienceCard is not exported from the product file; the copy exports it so the test can run the real Save.
  fs.writeFileSync(path.join(dir, 'views', 'settings.js'), `${fs.readFileSync(SETTINGS_SRC, 'utf8')}\nexport { guestExperienceCard };\n`);
  global.document = { body: pageBody, activeElement: pageBody, createElement: (t) => new El(t) };
  global.location = { set href(v) { nav.push(v); }, assign(v) { nav.push(v); } };
  bc = await import(pathToFileURL(path.join(dir, 'views', 'billingcoupon.js')).href);
  settings = await import(pathToFileURL(path.join(dir, 'views', 'settings.js')).href);
});

test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test.beforeEach(() => {
  waits.length = 0; toasts.length = 0; nav.length = 0; rerenders = 0; refreshes = 0;
  document.activeElement = pageBody;
});

const OPTIONS = [
  { key: 'starter', name: 'Starter', listings: 3, ai: false, prices: [{ months: 1, amount: 499 }, { months: 3, amount: 1347 }, { months: 12, amount: 4990 }] },
  { key: 'growth', name: 'Growth', listings: 10, ai: true, prices: [{ months: 1, amount: 999 }, { months: 3, amount: 2997 }, { months: 12, amount: 9990 }] },
];
const CARD = { brand: 'visa', last4: '4242' };
const mountPay = (bill = {}) => settings.payOnline({ plan: 'trial', read_only: false },
  { online: true, options: OPTIONS, history: [], coupon: null, ...bill }, () => { rerenders += 1; }, bc);
const renewalCard = () => settings.cardBlock({ plan: 'growth', paid_until: '2026-11-28' },
  { card: CARD, renewal_plan: 'starter', options: OPTIONS, history: [] }, () => { rerenders += 1; });
const tick = () => new Promise((r) => setTimeout(r, 0));
const find = (root, f) => root.all(f)[0];
const button = (root, text) => find(root, (e) => e.tag === 'button' && e.textContent === text);
const sent = (url) => waits.filter((w) => w.url === url).length;
const lastSent = (url) => waits.filter((w) => w.url === url).at(-1);
const lastToast = () => toasts.at(-1);

test('renewal Save: while the change waits, Save keeps focus and a second press sends nothing; the mark goes when it ends', async () => {
  const root = renewalCard();
  button(root, 'Change').fire('click');
  const sel = find(root, (e) => e.tag === 'select'); sel.value = 'growth';
  const save = button(root, 'Save'); save.focus(); save.fire('click'); await tick();
  assert.equal(sent('/billing/renewal'), 1);
  assert.deepEqual(lastSent('/billing/renewal').body, { renewal_plan: 'growth' });
  assert.equal(save.getAttribute('aria-disabled'), 'true', 'busy mark while the request waits');
  assert.equal(save.disabled, false, 'not switched off');
  assert.equal(document.activeElement, save, 'focus stays on Save');
  save.fire('click'); await tick();
  assert.equal(sent('/billing/renewal'), 1, 'a second press sends no second request');
  lastSent('/billing/renewal').res({}); await tick();
  assert.deepEqual(lastToast(), ['Saved.', 'info']);
  assert.equal(rerenders, 1);
  assert.equal(save.getAttribute('aria-disabled'), null, 'mark gone when the wait ends');
});

test('renewal Save: a refused change shows its message, clears the mark and leaves focus on Save', async () => {
  const root = renewalCard();
  button(root, 'Change').fire('click');
  const save = button(root, 'Save'); save.focus(); save.fire('click'); await tick();
  lastSent('/billing/renewal').rej(new Error('QA r38 refused.')); await tick();
  assert.deepEqual(lastToast(), ['QA r38 refused.', 'error']);
  assert.equal(save.getAttribute('aria-disabled'), null);
  assert.equal(save.disabled, false);
  assert.equal(document.activeElement, save);
  assert.equal(rerenders, 0);
});

test('Pay now: while the checkout request waits, the button keeps focus and a second press sends nothing; a refusal clears the mark', async () => {
  const root = mountPay({});
  const btn = button(root, 'Pay now');
  btn.focus(); btn.fire('click'); await tick();
  assert.equal(sent('/billing/checkout'), 1);
  assert.equal(btn.textContent, 'Opening secure checkout…');
  assert.equal(btn.getAttribute('aria-disabled'), 'true', 'busy mark while the request waits');
  assert.equal(btn.disabled, false, 'not switched off');
  assert.equal(document.activeElement, btn, 'focus stays on the button');
  btn.fire('click'); await tick();
  assert.equal(sent('/billing/checkout'), 1, 'a second press sends no second request');
  lastSent('/billing/checkout').rej(new Error('QA r38 refused.')); await tick();
  assert.deepEqual(lastToast(), ['QA r38 refused.', 'error']);
  assert.equal(btn.getAttribute('aria-disabled'), null, 'mark gone after a refusal');
  assert.equal(btn.textContent, 'Pay now');
  assert.equal(document.activeElement, btn);
});

test('Pay now: a redirect to the secure checkout keeps the mark while the browser leaves, so a press during the load sends nothing', async () => {
  const root = mountPay({});
  const btn = button(root, 'Pay now'); btn.focus(); btn.fire('click'); await tick();
  lastSent('/billing/checkout').res({ billing_id: 'b', checkout_url: 'https://pay.example/x' }); await tick();
  assert.deepEqual(nav, ['https://pay.example/x']);
  btn.fire('click'); await tick();
  assert.equal(sent('/billing/checkout'), 1, 'no second checkout while the page leaves');
});

test('Pay now: a free activation refreshes the user and redraws the page', async () => {
  const root = mountPay({});
  button(root, 'Pay now').fire('click'); await tick();
  lastSent('/billing/checkout').res({ activated: true, plan: 'growth', paid_until: '2026-11-28' });
  await tick(); await tick();
  assert.equal(refreshes, 1);
  assert.deepEqual(lastToast(), ['Your Growth plan is active until Nov 28, 2026.', 'info']);
  assert.equal(rerenders, 1, 'the redraw replaces the button');
});

test('Pay with the saved card: both pay buttons keep their mark while the charge waits, a press on either sends nothing, and a refusal hands focus to Pay another way', async () => {
  const root = mountPay({ card: CARD, saved_card_pay: true });
  const saved = button(root, 'Pay ₱999.00 with Visa ending 4242');
  const other = button(root, 'Pay another way');
  assert.ok(saved && other);
  saved.focus(); saved.fire('click'); await tick();
  assert.equal(sent('/billing/pay-saved'), 1);
  assert.deepEqual(lastSent('/billing/pay-saved').body, { plan: 'growth', months: '1', seen_paid_until: null });
  assert.equal(saved.getAttribute('aria-disabled'), 'true');
  assert.equal(other.getAttribute('aria-disabled'), 'true', 'the other pay button is busy too');
  assert.equal(saved.disabled, false); assert.equal(other.disabled, false);
  assert.equal(document.activeElement, saved, 'focus stays on the pressed button');
  assert.equal(saved.textContent, 'Charging your card…');
  saved.fire('click'); other.fire('click'); await tick();
  assert.equal(sent('/billing/pay-saved'), 1, 'a second press on either button sends no second charge');
  assert.equal(sent('/billing/checkout'), 0, 'Pay another way does not start a checkout while the charge waits');
  const months = find(root, (e) => e.attrs['aria-label'] === 'Months');
  months.value = '3'; months.fire('change'); await tick();
  assert.equal(saved.textContent, 'Charging your card…', 'a price redraw keeps the saving text');
  lastSent('/billing/pay-saved').rej(Object.assign(new Error("Your saved card couldn't be charged."), { code: 'SAVED_CARD_FAILED' })); await tick();
  assert.equal(saved.getAttribute('aria-disabled'), null);
  assert.equal(other.getAttribute('aria-disabled'), null);
  assert.equal(document.activeElement, other, 'focus goes to Pay another way');
  assert.match(root.textContent, /Your saved card couldn't be charged\. Pay another way, or use a different card\./);
  assert.equal(saved.textContent, 'Pay ₱2,997.00 with Visa ending 4242', 'the saved-card price follows the new length after the refusal');
});

test('Guest experience Save: while the save waits, Save keeps focus and a second press sends nothing; the mark goes when it ends', async () => {
  const card = await settings.guestExperienceCard();
  const save = find(card, (e) => e.tag === 'button' && e.attrs['aria-label'] === 'Save guest experience');
  save.focus(); save.fire('click'); await tick();
  assert.equal(sent('/workspace/guest-settings'), 1);
  assert.deepEqual(lastSent('/workspace/guest-settings').body, {
    review_links: [{ label: 'Google', url: 'https://g.page/balay' }], returning_guest_pct: 10, abandoned_followup: false,
  });
  assert.equal(save.getAttribute('aria-disabled'), 'true', 'busy mark while the request waits');
  assert.equal(save.disabled, false, 'not switched off');
  assert.equal(document.activeElement, save, 'focus stays on Save');
  save.fire('click'); await tick();
  assert.equal(sent('/workspace/guest-settings'), 1, 'a second press sends no second request');
  lastSent('/workspace/guest-settings').res({}); await tick();
  assert.deepEqual(lastToast(), ['Guest experience saved.', 'info']);
  assert.equal(save.getAttribute('aria-disabled'), null, 'mark gone when the wait ends');
});

test('Guest experience Save: a refused save shows its message, clears the mark and leaves focus on Save', async () => {
  const card = await settings.guestExperienceCard();
  const save = find(card, (e) => e.tag === 'button' && e.attrs['aria-label'] === 'Save guest experience');
  save.focus(); save.fire('click'); await tick();
  lastSent('/workspace/guest-settings').rej(new Error('QA r38 refused.')); await tick();
  assert.equal(find(card, (e) => e.attrs.role === 'alert').textContent, 'QA r38 refused.');
  assert.equal(save.getAttribute('aria-disabled'), null);
  assert.equal(save.disabled, false);
  assert.equal(document.activeElement, save);
});

test('Guest experience Save: a 409 with no field messages shows the server words, not an empty line', async () => {
  const card = await settings.guestExperienceCard();
  const save = find(card, (e) => e.tag === 'button' && e.attrs['aria-label'] === 'Save guest experience');
  const err = find(card, (e) => e.attrs.role === 'alert');
  save.focus(); save.fire('click'); await tick();
  // api.js's ApiError always sets fields to an object, so a refusal with no field messages arrives with an empty one.
  lastSent('/workspace/guest-settings').rej(Object.assign(new Error('QA r38 refused.'), { status: 409, fields: {} })); await tick();
  assert.equal(err.textContent, 'QA r38 refused.');
  assert.equal(save.getAttribute('aria-disabled'), null);
  assert.equal(document.activeElement, save);
});

test('Guest experience Save: a 400 with a field message shows that field message', async () => {
  const card = await settings.guestExperienceCard();
  const save = find(card, (e) => e.tag === 'button' && e.attrs['aria-label'] === 'Save guest experience');
  const err = find(card, (e) => e.attrs.role === 'alert');
  save.focus(); save.fire('click'); await tick();
  lastSent('/workspace/guest-settings').rej(Object.assign(new Error('Check the review links.'), { status: 400, fields: { review_links: 'Each review link needs a name.' } })); await tick();
  assert.equal(err.textContent, 'Each review link needs a name.');
  assert.equal(document.activeElement, save);
});
