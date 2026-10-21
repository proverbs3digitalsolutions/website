'use strict';
require('./helpers');

// QA round 40, PAYFOCUS (D-122). After a paid one-tap charge or a free activation, Settings is drawn again and focus goes to
// the "Plan & billing" heading, never to the new Pay button, so a repeated Enter does nothing. The views run against a stand-in
// DOM with ui.js, api.js, app.js and the other imports stubbed, and the real billingcoupon.js. The redraw is a real settingsView
// call, made again by rerender as the router does. R40_VIEWS_DIR (optional) points the test at another copy of public/js/views,
// used to prove the test red on the round 39 tree.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const VIEWS = process.env.R40_VIEWS_DIR || path.join(__dirname, '..', 'public', 'js', 'views');

class El {
  constructor(tag) { this.tag = tag; this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.l = {}; this.hidden = false; this.value = ''; this.checked = false; this._t = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; } // the busy marks read aria-disabled (D-120)
  addEventListener(t, f) { this.l[t] = f; }
  append(...c) { this.children.push(...c); }
  replaceChildren(...c) { this.children = c; }
  focus() { global.document.activeElement = this; }
  set textContent(v) { this._t = String(v); this.children = []; }
  get textContent() { return this._t + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  fire(t, init = {}) { return this.l[t]?.({ type: t, preventDefault() {}, target: this, ...init }); }
  all(f, out = []) { if (f(this)) out.push(this); this.children.forEach((c) => c.all && c.all(f, out)); return out; }
}

let dir; let app; let mod; let page;
const calls = []; const toasts = []; const nav = [];
const stub = { bill: null, post: async () => ({}), patch: async () => ({}) };
const GETS = {
  '/public/plans': { plans: [], contact_email: '' },
  '/listings': { listings: [] },
  '/team': { members: [], invitations: [] },
  '/properties': { properties: [] },
  '/audit': { entries: [] },
};
globalThis.__r40 = {
  toast: (m, k) => toasts.push([m, k || 'info']),
  post: (u, b) => { calls.push(['post', u, b]); return stub.post(u, b); },
  patch: (u, b) => { calls.push(['patch', u, b]); return stub.patch(u, b); },
  get: async (u) => (u === '/billing' ? stub.bill : GETS[u]),
};

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r40-payfocus-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'ui.js'), `
    export function h(tag, props, ...kids) {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(props || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'hidden') el.hidden = true;
        else if (k === 'class') el.className = v;
        else if (k === 'style' || k === 'dataset') continue;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
      el.append(...kids.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
      return el;
    }
    export const pageHead = (o) => h('div', null, o.title, o.sub);
    export const toast = (m, k) => globalThis.__r40.toast(m, k);
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    export const fmtDate = (d) => { const [y, m, day] = String(d).slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + day + ', ' + y; };
    export const fmtMonth = fmtDate; export const fmtDateTime = fmtDate; export const peso = (v) => '₱' + Number(v).toLocaleString('en-PH');
    export const icon = () => null; export const label = (x) => x; export const field = () => null; export const formModal = () => null;
    export const confirmDialog = async () => false; export const emptyState = () => null;
    export const openModal = () => null; export const clearErrors = () => null; export const showErrors = () => null;`);
  fs.writeFileSync(path.join(dir, 'api.js'), `
    export class ApiError extends Error { constructor(m, o = {}) { super(m); Object.assign(this, o); } }
    export const post = (u, b) => globalThis.__r40.post(u, b);
    export const patch = (u, b) => globalThis.__r40.patch(u, b);
    export const get = (u) => globalThis.__r40.get(u);
    export const api = async () => ({});`);
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: null }; export async function refreshUser() {}\n');
  fs.writeFileSync(path.join(dir, 'notifications.js'), 'export async function notificationsCard() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'themeswitch.js'), 'export function themeSwitch() { return null; }\n');
  for (const f of ['billingcoupon.js', 'settings.js']) fs.copyFileSync(path.join(VIEWS, f), path.join(dir, 'views', f));
  global.document = { activeElement: null, createElement: (t) => new El(t), addEventListener() {}, removeEventListener() {} };
  global.window = { addEventListener() {}, removeEventListener() {} };
  global.location = { hash: '#/settings', origin: 'https://qa.test', set href(v) { nav.push(v); }, assign(v) { nav.push(v); } };
  global.history = { replaceState() {} };
  app = await import(pathToFileURL(path.join(dir, 'app.js')).href);
  mod = await import(pathToFileURL(path.join(dir, 'views', 'settings.js')).href);
});

test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test.beforeEach(() => {
  calls.length = 0; toasts.length = 0; nav.length = 0;
  document.activeElement = null;
  app.state.user = ownerUser();
  stub.bill = billOf();
  stub.post = async () => ({});
  stub.patch = async () => ({});
});

const OPTIONS = [
  { key: 'starter', name: 'Starter', listings: 3, ai: false, prices: [{ months: 1, amount: 499 }, { months: 3, amount: 1347 }, { months: 12, amount: 4990 }] },
  { key: 'growth', name: 'Growth', listings: 10, ai: true, prices: [{ months: 1, amount: 999 }, { months: 3, amount: 2997 }, { months: 12, amount: 9990 }] },
];
const CARD = { brand: 'visa', last4: '4345' };
const PAID_UNTIL = '2026-11-28';
const PAY = 'Pay ₱999.00 with Visa ending 4345';
const PAID_TOAST = ['Your Growth plan is active until Nov 28, 2026.', 'info'];
const FREE_QUOTE = { coupon: { code: 'FREE1' }, plan: 'growth', months: 1, list_amount: '999.00', discount_amount: '999.00', amount: '0.00', free: true, card_only: false, message: '' };
const billOf = (over = {}) => ({ online: true, options: OPTIONS, history: [], coupon: null, card: CARD, renewal_plan: 'growth', paid_until: '2026-10-28', saved_card_pay: true, subscriptions: false, auto_renew: { on: false, status: null, consented_at: null, next_charge_on: null }, ...over });
// long_term leaves out the booking, guest and payment-method cards, which these tests do not read. The plan card is the same.
const ownerUser = () => ({ role: 'owner', business_type: 'long_term', user_id: 'r40-payfocus-owner', full_name: 'QA r40 payfocus owner', email: 'qa-r40-payfocus@example.test', organization_name: 'QA r40 payfocus Stays', plan: { plan: 'growth', name: 'Growth', price: 999, listing_limit: 10, paid_until: '2026-10-28', read_only: false, is_demo: false } });

const rerender = () => mod.settingsView(page, { rerender, query: {} });
const draw = async () => { page = document.createElement('div'); document.activeElement = null; await mod.settingsView(page, { rerender, query: {} }); };
// The redraw awaits its reads and a module import, so wait until it has finished drawing.
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5)); };
const find = (root, f) => root.all(f)[0];
const button = (root, text) => find(root, (e) => e.tag === 'button' && e.textContent === text);
const payButton = (root) => find(root, (e) => e.tag === 'button' && /^Pay ₱[\d.,]+ with /.test(e.textContent));
const planHeading = (root) => find(root, (e) => e.tag === 'h2' && e.textContent === 'Plan & billing');

test('a paid one-tap charge redraws Settings with focus on the Plan & billing heading, not the new Pay button', async () => {
  stub.post = async () => { stub.bill = billOf({ paid_until: PAID_UNTIL }); return { billing_id: 'r40-payfocus-1', status: 'paid', paid_until: PAID_UNTIL }; };
  await draw();
  button(page, PAY).fire('click');
  await settle();
  assert.deepEqual(toasts, [PAID_TOAST]);
  const head = planHeading(page);
  assert.ok(head, 'the redrawn page has its Plan & billing heading');
  assert.ok(payButton(page), 'the redrawn page has its own Pay button');
  assert.equal(document.activeElement, head, 'focus is on the Plan & billing heading after the redraw');
  assert.notEqual(document.activeElement, payButton(page), 'focus is not on the new Pay button');
  assert.equal(head.attrs.tabindex, '-1', 'the heading takes focus from script');
});

test('a free activation redraws Settings with focus on the Plan & billing heading too', async () => {
  stub.post = async (u) => {
    if (u === '/billing/coupon/preview') return FREE_QUOTE;
    if (u === '/billing/checkout') { stub.bill = billOf({ paid_until: PAID_UNTIL }); return { activated: true, paid_until: PAID_UNTIL }; }
    throw new Error(`unexpected request to ${u}`);
  };
  await draw();
  find(page, (e) => e.tag === 'input' && e.attrs.type !== 'checkbox').value = 'free1';
  button(page, 'Apply').fire('click');
  await settle();
  const act = button(page, 'Activate free plan');
  assert.ok(act, 'a free coupon offers Activate free plan');
  act.fire('click');
  await settle();
  assert.deepEqual(toasts, [PAID_TOAST]);
  assert.equal(document.activeElement, planHeading(page), 'focus is on the Plan & billing heading after the activation');
});

test('a refused charge still shows its notice at the top and takes focus; the heading does not', async () => {
  const msg = 'That payment was just received. Check your plan before paying again.';
  stub.post = async () => { throw Object.assign(new Error(msg), { code: 'PAYMENT_RECEIVED' }); };
  await draw();
  button(page, PAY).fire('click');
  await settle();
  const notice = find(page, (e) => e.attrs.role === 'alert' && e.textContent === msg);
  assert.ok(notice, 'the refusal is shown on the redrawn page');
  assert.equal(document.activeElement, notice, 'focus is on the refusal');
  assert.notEqual(document.activeElement, planHeading(page));
  assert.deepEqual(toasts, []);
});

test('a page drawn with no payment takes no focus, and a later redraw does not move it again', async () => {
  await draw();
  assert.equal(document.activeElement, null, 'nothing takes focus on a plain draw');
  stub.post = async () => { stub.bill = billOf({ paid_until: PAID_UNTIL }); return { status: 'paid', paid_until: PAID_UNTIL }; };
  button(page, PAY).fire('click');
  await settle();
  assert.equal(document.activeElement, planHeading(page), 'the paid redraw moves focus to the heading');
  document.activeElement = null;
  await mod.settingsView(page, { rerender, query: {} });
  assert.equal(document.activeElement, null, 'the move was made once, by the paid redraw');
});
