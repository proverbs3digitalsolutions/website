'use strict';

// QA round 17 (card on file, lane F2): saved-card one-tap pay, card row, renewal plan, automatic payment and the
// "Paid until" date format on Plan & billing. settings.js runs against a tiny fake DOM with ui.js, api.js, app.js stubbed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

class El {
  constructor(tag) { this.tag = tag; this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.l = {}; this.hidden = false; this.value = ''; this.checked = false; this.disabled = false; this._t = ''; }
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

let mod; let calls; let toasts; let nav; let dialogs;
const stub = { post: null, patch: null, dialog: true, bill: {} };
const settingsSrc = path.join(__dirname, '../public/js/views/settings.js');

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r17f2-'));
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
        else if (k === 'style') continue;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
      el.append(...kids.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
      return el;
    }
    export const toast = (m, k) => globalThis.__toasts.push([m, k || 'info']);
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    export const fmtDate = (d) => { const [y, m, day] = String(d).slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + day + ', ' + y; };
    export const fmtMonth = fmtDate; export const fmtDateTime = fmtDate; export const peso = (v) => '₱' + Number(v).toLocaleString('en-PH');
    export const icon = () => null; export const label = (x) => x; export const field = () => null; export const formModal = () => null;
    export const confirmDialog = async (o) => { globalThis.__dialogs.push(o); return globalThis.__dialogAnswer; };
    export const emptyState = () => null; export const pageHead = () => null;
    export const openModal = () => null; export const clearErrors = () => null; export const showErrors = () => null;`);
  fs.writeFileSync(path.join(dir, 'api.js'), `
    export class ApiError extends Error { constructor(m, o = {}) { super(m); Object.assign(this, o); } }
    export const post = (...a) => globalThis.__post(...a);
    export const patch = (...a) => globalThis.__patch(...a);
    export const api = (...a) => globalThis.__api(...a);
    export const get = async (u) => globalThis.__get(u);`);
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = {}; export async function refreshUser() {}\n');
  fs.writeFileSync(path.join(dir, 'notifications.js'), 'export async function notificationsCard() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'themeswitch.js'), 'export function themeSwitch() { return null; }\n');
  for (const f of ['billingcoupon.js', 'settings.js']) fs.copyFileSync(path.join(__dirname, '../public/js/views', f), path.join(dir, 'views', f));
  global.document = { activeElement: null, createElement: (t) => new El(t) };
  globalThis.Element = class { };
  global.location = { set href(v) { nav.push(v); }, assign(v) { nav.push(v); } };
  global.history = { replaceState() {} };
  mod = await import(pathToFileURL(path.join(dir, 'views', 'settings.js')).href);
});

test.beforeEach(() => {
  calls = []; toasts = []; nav = []; dialogs = [];
  Object.assign(stub, { post: async () => ({}), patch: async () => ({}), dialog: true });
  globalThis.__toasts = toasts; globalThis.__dialogs = dialogs; globalThis.__dialogAnswer = true;
  globalThis.__post = (u, b) => { calls.push(['post', u, b]); return stub.post(u, b); };
  globalThis.__patch = (u, b) => { calls.push(['patch', u, b]); return stub.patch(u, b); };
  globalThis.__api = async (m, u) => { calls.push([m, u]); return { ok: true }; };
  globalThis.__get = async (u) => (u === '/billing' ? stub.bill : u === '/public/plans' ? { plans: [], contact_email: '' } : u === '/listings' ? { listings: [] } : {});
});

const OPTIONS = [
  { key: 'starter', name: 'Starter', listings: 3, ai: false, prices: [{ months: 1, amount: 499 }, { months: 3, amount: 1347 }, { months: 12, amount: 4990 }] },
  { key: 'growth', name: 'Growth', listings: 10, ai: true, prices: [{ months: 1, amount: 999 }, { months: 3, amount: 2997 }, { months: 12, amount: 9990 }] },
];
const CARD = { brand: 'visa', last4: '4242' };
const PLAN = { plan: 'trial', read_only: false };
const baseBill = (o = {}) => ({ online: true, options: OPTIONS, history: [], coupon: null, card: CARD, renewal_plan: 'growth', saved_card_pay: true, subscriptions: false, auto_renew: { on: false, status: null, consented_at: null, next_charge_on: null }, ...o });
let bc;
test.before(async () => { bc = await import(pathToFileURL(path.join(fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('bh-r17f2-')).map((d) => path.join(os.tmpdir(), d)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0], 'views', 'billingcoupon.js')).href); });
const mount = (bill = {}, p = PLAN) => mod.payOnline(p, baseBill(bill), () => { calls.push(['rerender']); }, bc);
const find = (root, f) => root.all(f)[0];
const button = (root, text) => find(root, (e) => e.tag === 'button' && e.textContent === text);
const tick = () => new Promise((r) => setTimeout(r, 0));
const apply = async (root, code) => { find(root, (e) => e.tag === 'input' && e.attrs.type !== 'checkbox').value = code; button(root, 'Apply').fire('click'); await tick(); };

test('a saved card makes the one-tap button the main one and keeps Pay another way', () => {
  const root = mount();
  assert.ok(button(root, 'Pay ₱999.00 with Visa ending 4242'));
  assert.equal(button(root, 'Pay another way').className, 'btn btn--secondary');
});

test('no saved card shows only the existing button', () => {
  const root = mount({ card: null });
  assert.equal(button(root, 'Pay now').className, 'btn btn--primary');
  assert.equal(button(root, 'Pay another way'), undefined);
  assert.equal(find(root, (e) => /^Pay .* with /.test(e.textContent) && e.tag === 'button').hidden, true);
});

test('Stage 1 coupon note drops the applied-automatically sentence; Stage 2 keeps it', async () => {
  stub.post = async () => ({ coupon: { code: 'A' }, plan: 'growth', months: 1, list_amount: '999.00', discount_amount: '499.50', amount: '499.50', free: false, card_only: false, message: '' });
  const root = mount();
  await apply(root, 'alpha');
  assert.match(root.textContent, /BalayHub never charges your card on its own; you renew here\./);
  assert.doesNotMatch(root.textContent, /applied automatically/);
});

test('the one-tap amount follows a coupon preview and a free coupon keeps Activate free plan', async () => {
  stub.post = async () => ({ coupon: { code: 'A' }, plan: 'growth', months: 1, list_amount: '999.00', discount_amount: '499.50', amount: '499.50', free: false, card_only: false, message: '' });
  const root = mount();
  await apply(root, 'alpha');
  assert.ok(button(root, 'Pay ₱499.50 with Visa ending 4242'));
  stub.post = async () => ({ coupon: { code: 'F' }, plan: 'growth', months: 1, list_amount: '999.00', discount_amount: '999.00', amount: '0.00', free: true, card_only: false, message: '' });
  await apply(root, 'free1');
  const act = button(root, 'Activate free plan');
  assert.equal(act.className, 'btn btn--primary');
  assert.equal(find(root, (e) => e.tag === 'button' && /^Pay .* with Visa/.test(e.textContent)).hidden, true);
});

test('one tap posts to pay-saved with the checkout body and activates on success', async () => {
  stub.post = async (u) => (u === '/billing/pay-saved' ? { billing_id: 'b', status: 'paid', paid_until: '2026-11-28' } : {});
  const root = mount();
  button(root, 'Pay ₱999.00 with Visa ending 4242').fire('click'); await tick(); await tick();
  assert.deepEqual(calls.find((c) => c[1] === '/billing/pay-saved'), ['post', '/billing/pay-saved', { plan: 'growth', months: '1' }]);
  assert.deepEqual(toasts, [['Your Growth plan is active until Nov 28, 2026.', 'info']]);
  assert.ok(calls.some((c) => c[0] === 'rerender'));
});

test('action_required sends the browser to the bank page', async () => {
  stub.post = async () => ({ billing_id: 'b', status: 'action_required', redirect_url: 'https://bank.example/3ds' });
  const root = mount();
  button(root, 'Pay ₱999.00 with Visa ending 4242').fire('click'); await tick(); await tick();
  assert.deepEqual(nav, ['https://bank.example/3ds']);
});

test('SAVED_CARD_FAILED shows the message and focuses Pay another way', async () => {
  stub.post = async () => { const e = new Error('x'); e.code = 'SAVED_CARD_FAILED'; throw e; };
  const root = mount();
  button(root, 'Pay ₱999.00 with Visa ending 4242').fire('click'); await tick(); await tick();
  const msg = find(root, (e) => e.attrs['aria-live'] === 'polite');
  assert.equal(msg.textContent, "Your saved card couldn't be charged. Pay another way, or use a different card.");
  assert.equal(global.document.activeElement, button(root, 'Pay another way'));
  assert.deepEqual(toasts, []);
});

test('Remove card asks first (Stage 1 text), then deletes and toasts', async () => {
  const root = mod.cardBlock(PLAN, baseBill(), () => calls.push(['rerender']));
  assert.match(root.textContent, /Card on file: Visa ending 4242/);
  await button(root, 'Remove card').fire('click'); await tick();
  assert.equal(dialogs[0].title, 'Remove your card?');
  assert.equal(dialogs[0].text, 'BalayHub forgets this card. You can still pay another way.');
  assert.equal(dialogs[0].confirmText, 'Remove card'); assert.equal(dialogs[0].cancelText, 'Keep card');
  assert.ok(calls.some((c) => c[0] === 'DELETE' && c[1] === '/billing/card'));
  assert.deepEqual(toasts, [['Card removed.', 'info']]);
});

test('Remove card in Stage 2 says automatic payment goes off, and Keep card changes nothing', async () => {
  globalThis.__dialogAnswer = null;
  const root = mod.cardBlock({ plan: 'growth', paid_until: '2026-11-28' }, baseBill({ subscriptions: true }), () => {});
  await button(root, 'Remove card').fire('click'); await tick();
  assert.equal(dialogs[0].text, 'BalayHub forgets this card and turns off automatic payment. Your plan stays active until Nov 28, 2026.');
  assert.equal(calls.length, 0);
});

test('renewal row: Change reveals the picker and Save patches /billing/renewal', async () => {
  const root = mod.cardBlock(PLAN, baseBill(), () => calls.push(['rerender']));
  assert.match(root.textContent, /Plan after your trial: Growth/);
  button(root, 'Change').fire('click');
  const sel = find(root, (e) => e.tag === 'select'); sel.value = 'starter';
  button(root, 'Save').fire('click'); await tick();
  assert.deepEqual(calls.find((c) => c[0] === 'patch'), ['patch', '/billing/renewal', { renewal_plan: 'starter' }]);
  assert.deepEqual(toasts, [['Saved.', 'info']]);
  const paid = mod.cardBlock({ plan: 'growth' }, baseBill(), () => {});
  assert.match(paid.textContent, /Next plan: Growth/);
});

test('Stage 2: on, off and past due texts', async () => {
  const on = mod.cardBlock({ plan: 'growth', paid_until: '2026-11-28' }, baseBill({ subscriptions: true, auto_renew: { on: true, status: 'active', next_charge_on: '2026-11-29' } }), () => {});
  assert.match(on.textContent, /Automatic payment is on\. Next charge: ₱999 to Visa ending 4242 on Nov 29, 2026\./);
  await button(on, 'Cancel automatic payment').fire('click'); await tick();
  assert.equal(dialogs[0].title, 'Cancel automatic payment?');
  assert.equal(dialogs[0].text, 'Your plan stays active until Nov 28, 2026. After that, renew here by hand.');
  assert.equal(dialogs[0].cancelText, 'Keep it on');
  assert.deepEqual(calls.find((c) => c[0] === 'patch'), ['patch', '/billing/renewal', { auto_renew: false }]);
  assert.deepEqual(toasts, [['Automatic payment is off.', 'info']]);
  const off = mod.cardBlock(PLAN, baseBill({ subscriptions: true }), () => {});
  assert.match(off.textContent, /Automatic payment is off\./);
  assert.ok(button(off, 'Turn on automatic payment'));
  const late = mod.cardBlock({ plan: 'growth' }, baseBill({ subscriptions: true, auto_renew: { on: false, status: 'past_due', next_charge_on: '2026-11-29' } }), () => {});
  assert.match(late.textContent, /Your card payment on Nov 29, 2026 didn't go through\. Pay now to keep making changes\./);
});

test('turning on automatic payment needs the tick box', async () => {
  const off = mod.cardBlock(PLAN, baseBill({ subscriptions: true }), () => {});
  const go = button(off, 'Turn on automatic payment');
  go.fire('click'); go.fire('click'); await tick();
  assert.equal(calls.filter((c) => c[0] === 'patch').length, 0);
  assert.match(off.textContent, /Tick the box to agree to automatic payment\./);
  find(off, (e) => e.attrs.type === 'checkbox').checked = true;
  go.fire('click'); await tick();
  assert.deepEqual(calls.find((c) => c[0] === 'patch'), ['patch', '/billing/renewal', { auto_renew: true, consent: true }]);
});

test('Stage 1 has no automatic payment text; no card and no renewal plan draws nothing', () => {
  assert.doesNotMatch(mod.cardBlock(PLAN, baseBill(), () => {}).textContent, /Automatic payment/);
  assert.equal(mod.cardBlock(PLAN, baseBill({ card: null, renewal_plan: null }), () => {}), null);
});

test('Plan & billing: Paid until uses the app date format, card check shows in the history', async () => {
  const u = { plan: { plan: 'growth', name: 'Growth', price: 999, listing_limit: 10, paid_until: '2026-11-14', read_only: false }, organization_name: 'X' };
  stub.bill = baseBill({ history: [{ kind: 'card_check', plan: null, months: null, amount: '20.00', status: 'paid', provider: 'paymongo_intent', paid_at: '2026-10-15' }] });
  const root = await mod.planCard(u, () => {});
  assert.match(root.textContent, /Paid untilNov 14, 2026/);
  assert.doesNotMatch(root.textContent, /2026-11-14/);
  assert.match(root.textContent, /Card checkPaid Oct 15, 2026 · Visa ending 4242/);
  assert.ok(find(root, (e) => e.className === 'badge badge--paid' && e.textContent === 'Paid'));
});

test('a comped workspace shows no Pay now or coupon box', async () => {
  const u = { plan: { plan: 'comped', name: 'Complimentary', paid_until: null, listing_limit: 1000, read_only: false }, organization_name: 'X' };
  stub.bill = baseBill();
  const root = await mod.planCard(u, () => {});
  assert.equal(button(root, 'Pay now'), undefined);
  assert.doesNotMatch(root.textContent, /coupon/i);
});

test('focus restore: Save and the redrawn Change share a data-focus-key, so focus lands on Change after a plan save', () => {
  const root = mod.cardBlock(PLAN, baseBill(), () => {});
  const chg = button(root, 'Change'); const save = button(root, 'Save');
  assert.ok(chg.attrs['data-focus-key']);
  assert.equal(save.attrs['data-focus-key'], chg.attrs['data-focus-key']);
});

test('focus restore: automatic payment turn on and cancel share a data-focus-key', () => {
  const sub = { subscriptions: true };
  const off = button(mod.cardBlock(PLAN, baseBill(sub), () => {}), 'Turn on automatic payment');
  const on = button(mod.cardBlock(PLAN, baseBill({ ...sub, auto_renew: { on: true, status: 'active', next_charge_on: null } }), () => {}), 'Cancel automatic payment');
  assert.ok(off.attrs['data-focus-key']);
  assert.equal(on.attrs['data-focus-key'], off.attrs['data-focus-key']);
});

test('settings.js passes node --check', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bh-chk-')), 'settings.mjs');
  fs.copyFileSync(settingsSrc, f);
  execFileSync(process.execPath, ['--check', f]);
});
