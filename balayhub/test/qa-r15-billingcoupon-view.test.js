'use strict';

// QA round 15 (B6): the "Have a coupon code?" box on Plan & billing and the payOnline changes in settings.js.
// Both modules run against a tiny fake DOM with ui.js, api.js and app.js stubbed (the real ones need a browser).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

class El {
  constructor(tag) { this.tag = tag; this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.l = {}; this.hidden = false; this.value = ''; this.open = false; this.disabled = false; this._t = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { this.l[t] = f; }
  append(...c) { this.children.push(...c); }
  replaceChildren(...c) { this.children = c; }
  focus() { global.document.activeElement = this; }
  set textContent(v) { this._t = String(v); this.children = []; }
  get textContent() { return this._t + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  fire(t, init = {}) { const e = { type: t, preventDefault() {}, target: this, ...init }; return this.l[t]?.(e); }
  all(f, out = []) { if (f(this)) out.push(this); this.children.forEach((c) => c.all && c.all(f, out)); return out; }
}

let bc; let po; let calls; let toasts; let refreshed; let nav;
const stubPost = { fn: null };

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r15b6-'));
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
        else el.setAttribute(k, v === true ? '' : String(v));
      }
      el.append(...kids.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
      return el;
    }
    export const toast = (m, k) => globalThis.__toasts.push([m, k || 'info']);
    export const fmtDate = (d) => { const [y, m, day] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };
    export const fmtMonth = fmtDate; export const fmtDateTime = fmtDate; export const peso = (v) => String(v);
    export const icon = () => null; export const label = (x) => x; export const field = () => null; export const formModal = () => null;
    export const confirmDialog = () => null; export const emptyState = () => null; export const pageHead = () => null;
    export const openModal = () => null; export const clearErrors = () => null; export const showErrors = () => null;`);
  fs.writeFileSync(path.join(dir, 'api.js'), `
    export class ApiError extends Error { constructor(m, o = {}) { super(m); Object.assign(this, o); } }
    export const post = (...a) => globalThis.__post(...a); export const get = async () => ({}); export const patch = async () => ({}); export const api = async () => ({});`);
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = {}; export async function refreshUser() { globalThis.__refreshed += 1; }\n');
  fs.writeFileSync(path.join(dir, 'notifications.js'), 'export async function notificationsCard() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'themeswitch.js'), 'export function themeSwitch() { return null; }\n');
  for (const f of ['billingcoupon.js', 'settings.js']) fs.copyFileSync(path.join(__dirname, '../public/js/views', f), path.join(dir, 'views', f));
  global.document = { activeElement: null, createElement: (t) => new El(t) };
  globalThis.Element = class { };
  global.location = { set href(v) { nav.push(v); } };
  bc = await import(pathToFileURL(path.join(dir, 'views', 'billingcoupon.js')).href);
  po = (await import(pathToFileURL(path.join(dir, 'views', 'settings.js')).href)).payOnline;
});

test.beforeEach(() => {
  calls = []; toasts = []; nav = []; refreshed = 0;
  globalThis.__toasts = toasts; globalThis.__refreshed = 0;
  globalThis.__post = (url, body) => { calls.push([url, body]); return stubPost.fn(url, body); };
});

const OPTIONS = [
  { key: 'starter', name: 'Starter', listings: 3, ai: false, prices: [{ months: 1, amount: 499 }, { months: 3, amount: 1347 }, { months: 12, amount: 4990 }] },
  { key: 'growth', name: 'Growth', listings: 10, ai: true, prices: [{ months: 1, amount: 999 }, { months: 3, amount: 2997 }, { months: 12, amount: 9990 }] },
];
const quote = (o = {}) => ({
  coupon: { code: 'ALPHA50', kind: 'percent', percent_off: 50, amount_off: null, duration: 'months', duration_months: 3, months_left: 3 },
  plan: 'growth', months: 1, list_amount: '999.00', discount_amount: '499.50', amount: '499.50', covered_months: 1,
  free: false, card_only: false, message: 'This payment covers 1 of your 3 coupon months.', ...o,
});
const mount = (bill = {}) => po({ plan: 'trial', read_only: false }, { online: true, options: OPTIONS, history: [], coupon: null, ...bill }, () => { calls.push(['rerender']); }, bc);
const find = (root, f) => root.all(f)[0];
const input = (root) => find(root, (e) => e.tag === 'input');
const button = (root, text) => find(root, (e) => e.tag === 'button' && e.textContent === text);
const alertBox = (root) => find(root, (e) => e.attrs.role === 'alert');
const tick = () => new Promise((r) => setTimeout(r, 0));
const type = (root, v) => { input(root).value = v; };

test('typing a code and pressing Apply previews it and shows a struck list price and the discounted total', async () => {
  stubPost.fn = async () => quote();
  const root = mount();
  assert.equal(calls.length, 0, 'no preview without a code');
  type(root, 'alpha50'); button(root, 'Apply').fire('click'); await tick();
  assert.deepEqual(calls[0], ['/billing/coupon/preview', { code: 'alpha50', plan: 'growth', months: '1' }]);
  const strike = find(root, (e) => e.className === 'strike muted');
  assert.equal(strike.hidden, false); assert.equal(strike.textContent, '₱999.00');
  assert.equal(find(root, (e) => e.tag === 'strong' && e.textContent === '₱499.50').tag, 'strong');
  assert.match(root.textContent, /This payment covers 1 of your 3 coupon months\./);
  assert.match(root.textContent, /ALPHA50 applied: 50% off your first 3 months\./);
  assert.match(root.textContent, /BalayHub never charges your card on its own; you renew here\./);
  assert.doesNotMatch(root.textContent, /applied automatically/);
});

test('Enter in the code box applies it', async () => {
  stubPost.fn = async () => quote();
  const root = mount(); type(root, 'alpha50');
  input(root).fire('keydown', { key: 'Enter' }); await tick();
  assert.equal(calls.length, 1);
});

test('a free quote changes the button, and checkout sends coupon_code', async () => {
  stubPost.fn = async (url) => (url === '/billing/checkout' ? { activated: true, plan: 'growth', paid_until: '2026-11-28' }
    : quote({ free: true, amount: '0.00', discount_amount: '999.00' }));
  const root = mount();
  type(root, 'free1'); button(root, 'Apply').fire('click'); await tick();
  const btn = button(root, 'Activate free plan');
  assert.ok(btn);
  btn.fire('click'); await tick(); await tick();
  assert.deepEqual(calls.find((c) => c[0] === '/billing/checkout')[1], { plan: 'growth', months: '1', seen_paid_until: null, coupon_code: 'free1' });
  assert.equal(globalThis.__refreshed, 1, 'refreshUser ran');
  assert.deepEqual(nav, [], 'no redirect to a checkout page');
  assert.deepEqual(toasts, [['Your Growth plan is active until Nov 28, 2026.', 'info']]);
  assert.ok(calls.some((c) => c[0] === 'rerender'));
});

test('a card-only quote reads "Pay ₱20 by card" and a paid checkout redirects', async () => {
  stubPost.fn = async (url) => (url === '/billing/checkout' ? { billing_id: 'b', checkout_url: 'https://pay.example/x' }
    : quote({ card_only: true, amount: '20.00', discount_amount: '979.00' }));
  const root = mount(); type(root, 'free1'); button(root, 'Apply').fire('click'); await tick();
  button(root, 'Pay ₱20 by card').fire('click'); await tick(); await tick();
  assert.deepEqual(nav, ['https://pay.example/x']);
});

test('a 400 shows inside the coupon box, not as a toast, and the total stays at list price', async () => {
  stubPost.fn = async () => { const e = new Error("This code isn't valid right now. Check it and try again."); e.code = 'COUPON_INVALID'; e.status = 400; throw e; };
  const root = mount(); type(root, 'nope'); button(root, 'Apply').fire('click'); await tick();
  assert.equal(alertBox(root).textContent, "This code isn't valid right now. Check it and try again.");
  assert.deepEqual(toasts, []);
  assert.ok(find(root, (e) => e.tag === 'strong' && e.textContent === '₱999.00'));
  assert.equal(find(root, (e) => e.className === 'strike muted').hidden, true);
});

test('focus stays in the code box after an error (nothing is rebuilt)', async () => {
  stubPost.fn = async () => { throw new Error('bad'); };
  const root = mount(); const inp = input(root); inp.focus(); type(root, 'nope');
  inp.fire('keydown', { key: 'Enter' }); await tick();
  assert.equal(input(root), inp); assert.equal(global.document.activeElement, inp);
});

test('with a live coupon the box shows the applied line and no input', () => {
  stubPost.fn = async () => quote();
  const root = mount({ coupon: { code: 'ALPHA50', kind: 'percent', percent_off: 50, duration: 'months', duration_months: 3, months_left: 2, status: 'active' } });
  assert.match(root.textContent, /Coupon ALPHA50: 50% off your first 3 months\. 2 months left\./);
  assert.equal(input(root), undefined);
  assert.deepEqual(calls[0], ['/billing/coupon/preview', { plan: 'growth', months: '1' }], 'previewed with no code typed');
});

test('a forever coupon says "every month" once', () => {
  stubPost.fn = async () => quote();
  const root = mount({ coupon: { code: 'VIP', kind: 'percent', percent_off: 20, duration: 'forever', duration_months: null, months_left: null, status: 'active' } });
  assert.match(root.textContent, /Coupon VIP: 20% off every month\.(?! Applies)/);
});

test('a used-up coupon shows a muted line and the input', () => {
  stubPost.fn = async () => quote();
  const root = mount({ coupon: { code: 'ALPHA50', status: 'used_up' } });
  assert.match(root.textContent, /Your coupon ALPHA50 is used up\./);
  assert.ok(input(root));
});

test('switching months after Apply previews again with the new months', async () => {
  stubPost.fn = async () => quote();
  const root = mount(); type(root, 'alpha50'); button(root, 'Apply').fire('click'); await tick();
  const sel = find(root, (e) => e.tag === 'select'); sel.value = '3'; sel.fire('change'); await tick();
  assert.deepEqual(calls[1], ['/billing/coupon/preview', { code: 'alpha50', plan: 'growth', months: '3' }]);
});

test('a late answer for an older selection is ignored', async () => {
  const waiting = [];
  stubPost.fn = (_u, body) => new Promise((res) => waiting.push([body, res]));
  const root = mount(); type(root, 'alpha50'); button(root, 'Apply').fire('click');
  const sel = find(root, (e) => e.tag === 'select'); sel.value = '3'; sel.fire('change');
  assert.equal(waiting.length, 2);
  waiting[1][1](quote({ months: 3, list_amount: '2997.00', discount_amount: '499.50', amount: '2497.50' })); await tick();
  waiting[0][1](quote({ amount: '499.50' })); await tick();
  assert.ok(find(root, (e) => e.tag === 'strong' && e.textContent === '₱2,497.50'), 'the 3-month total stays');
});

test('Remove clears the code and goes back to the list price', async () => {
  stubPost.fn = async () => quote();
  const root = mount(); type(root, 'alpha50'); button(root, 'Apply').fire('click'); await tick();
  button(root, 'Remove').fire('click');
  assert.equal(input(root).value, '');
  assert.ok(find(root, (e) => e.tag === 'strong' && e.textContent === '₱999.00'));
});

test('money shows two decimals only when there are centavos', () => {
  assert.equal(bc.money('499.50'), '₱499.50'); assert.equal(bc.money('999.00'), '₱999.00'); assert.equal(bc.money(2997), '₱2,997.00');
  assert.equal(bc.plain('999.00'), '₱999'); assert.equal(bc.plain('20.00'), '₱20'); assert.equal(bc.plain('499.50'), '₱499.50');
});

test('long-term invite offers bookkeeping and caretaker staff, not cleaner or front desk', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/settings.js'), 'utf8');
  assert.match(src, /'Staff \(bookkeeping, caretaker\)'/);
});

test('settings.js: Privacy Notice and "Your link" are tappable links, the coupon audit label exists', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/settings.js'), 'utf8');
  assert.match(src, /h\('a', \{ class: 'link-tap', href: '#\/privacy' \}, 'Read the Privacy Notice'\)/);
  assert.match(src, /h\('a', \{ class: 'link-tap', href: b\.url\.slice/);
  assert.match(src, /'billing\.coupon_applied': 'Used a plan coupon'/);
});

test('the PayMongo key box does not cut a long paste (the server refuses over 200 and says so)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/settings.js'), 'utf8');
  const line = src.split('\n').find((l) => l.includes("name: 'paymongo_secret_key'"));
  assert.match(line, /maxlength: (\d+)/);
  assert.ok(Number(line.match(/maxlength: (\d+)/)[1]) >= 500, 'client maxlength must stay well above the server limit of 200');
});

test('a months change never re-sends a code the server refused; Apply may, and an accepted code is refreshed', async () => {
  stubPost.fn = async () => { const e = new Error('nope'); e.code = 'COUPON_INVALID'; throw e; };
  const root = mount(); type(root, 'bad1'); button(root, 'Apply').fire('click'); await tick();
  const sel = find(root, (e) => e.tag === 'select');
  for (const m of ['3', '12', '1', '3']) { sel.value = m; sel.fire('change'); await tick(); }
  assert.equal(calls.length, 1, 'only the Apply posted');
  assert.equal(alertBox(root).textContent, 'nope', 'the refusal message stays');
  type(root, 'bad1'); button(root, 'Apply').fire('click'); await tick();
  assert.equal(calls.length, 2, 'a new Apply with the same code posts');
  stubPost.fn = async () => quote();
  type(root, 'good'); button(root, 'Apply').fire('click'); await tick();
  sel.value = '12'; sel.fire('change'); await tick();
  assert.equal(calls.length, 4, 'an accepted code is re-checked on a months change');
});

test('COUPON_PLAN is re-checked on a plan change but not a months change; COUPON_AHEAD on either', async () => {
  const err = (code) => async () => { const e = new Error(code); e.code = code; throw e; };
  stubPost.fn = err('COUPON_PLAN');
  let root = mount(); type(root, 'pro1'); button(root, 'Apply').fire('click'); await tick();
  const sel = find(root, (e) => e.tag === 'select'); sel.value = '3'; sel.fire('change'); await tick();
  assert.equal(calls.length, 1, 'months change: no post');
  find(root, (e) => e.tag === 'button' && e.textContent.startsWith('Starter')).fire('click'); await tick();
  assert.equal(calls.length, 2, 'plan change: one post');
  calls.length = 0; stubPost.fn = err('COUPON_AHEAD');
  root = mount(); type(root, 'ahead'); button(root, 'Apply').fire('click'); await tick();
  const sel2 = find(root, (e) => e.tag === 'select'); sel2.value = '3'; sel2.fire('change'); await tick();
  assert.equal(calls.length, 2, 'months change re-checks once');
});

test('live coupon: a Pay-now error (COUPON_AHEAD) shows next to the button', () => {
  stubPost.fn = async () => quote();
  const root = mount({ coupon: { code: 'ALPHA50', kind: 'percent', percent_off: 50, duration: 'months', duration_months: 3, months_left: 2, status: 'active' } });
  root.all((e) => e.attrs.role === 'alert'); // the message element is attached
  assert.ok(alertBox(root), 'role=alert element is in the box');
  const box = find(root, (e) => e.refresh);
  box.showError('Your plan is already paid ahead. Your coupon applies at your next renewal.');
  assert.equal(alertBox(root).textContent, 'Your plan is already paid ahead. Your coupon applies at your next renewal.');
});

test('an emptied code field means no code: no re-send, old error cleared', async () => {
  stubPost.fn = async () => { const e = new Error('nope'); e.code = 'COUPON_PLAN'; throw e; };
  const root = mount(); type(root, 'pro1'); button(root, 'Apply').fire('click'); await tick();
  assert.equal(alertBox(root).textContent, 'nope');
  type(root, '');
  find(root, (e) => e.tag === 'button' && e.textContent.startsWith('Starter')).fire('click'); await tick();
  assert.equal(calls.length, 1, 'nothing re-sent');
  assert.equal(alertBox(root).textContent, '');
});

test('a used-up coupon asks the server with no code and shows its full-price message', async () => {
  stubPost.fn = async () => ({ coupon: null, list_amount: '999.00', discount_amount: '0.00', amount: '999.00', message: "Your coupon's 2 months are used. This payment is the full price." });
  const root = mount({ coupon: { code: 'ALPHA50', status: 'used_up' } }); await tick();
  assert.deepEqual(calls[0], ['/billing/coupon/preview', { plan: 'growth', months: '1' }]);
  assert.match(root.textContent, /Your coupon's 2 months are used\. This payment is the full price\./);
  const sel = find(root, (e) => e.tag === 'select'); sel.value = '3'; sel.fire('change'); await tick();
  assert.deepEqual(calls[1], ['/billing/coupon/preview', { plan: 'growth', months: '3' }]);
});

test('discounted totals and the saved amount keep two decimals; a card-only button stays short', async () => {
  stubPost.fn = async () => quote({ list_amount: '2997.00', discount_amount: '200.00', amount: '2797.00' });
  const root = mount(); type(root, 'alpha50'); button(root, 'Apply').fire('click'); await tick();
  assert.equal(find(root, (e) => e.className === 'strike muted').textContent, '₱2,997.00');
  assert.ok(find(root, (e) => e.tag === 'strong' && e.textContent === '₱2,797.00'));
  stubPost.fn = async () => quote({ card_only: true, amount: '20.00', discount_amount: '979.00' });
  type(root, 'free1'); button(root, 'Apply').fire('click'); await tick();
  assert.ok(button(root, 'Pay ₱20 by card'));
});
