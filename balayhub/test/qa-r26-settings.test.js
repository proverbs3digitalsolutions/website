'use strict';

// QA round 26 (SETTINGS): the "Have a coupon code?" box on Plan & billing and the payOnline changes in settings.js.
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
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; } // the busy checks read aria-disabled (QA r38 PINS)
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r26set-'));
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


const fsrc = fs.readFileSync(path.join(__dirname, '../public/js/views/settings.js'), 'utf8');
const mountKeep = (bill = {}) => mount({ renewal_plan: 'starter', ...bill });
const settle = () => new Promise((r) => setTimeout(r, 5));

test('CARD-2: a coupon typed in the box is still there after a card row is saved', async () => {
  stubPost.fn = async () => quote();
  const first = mountKeep();
  type(first, 'alpha50'); button(first, 'Apply').fire('click'); await tick();
  button(first, 'Change').fire('click');
  button(first, 'Save').fire('click'); await settle();
  assert.ok(calls.some((c) => c[0] === 'rerender'), 'saving a card row redraws the page');
  calls.length = 0;
  const second = mountKeep(); await tick();
  assert.equal(input(second).value, 'alpha50');
  assert.equal(find(second, (e) => e.tag === 'details').open, true);
  assert.deepEqual(calls[0], ['/billing/coupon/preview', { code: 'alpha50', plan: 'starter', months: '1' }]);
  assert.match(second.textContent, /ALPHA50 applied/);
});

test('CARD-2: without a kept code the box starts empty and closed, and a later redraw does not reuse it', async () => {
  stubPost.fn = async () => quote();
  const root = mountKeep(); await tick();
  assert.equal(input(root).value, '');
  assert.equal(find(root, (e) => e.tag === 'details').open, false);
  assert.equal(calls.length, 0);
});

test('CARD-2: only the card block stores the kept code; the payment-result catches do not', () => {
  assert.match(fsrc, /cardBlock\(p, bill, \(\) => \{ keptCoupon = box\.getCode\(\) \|\| null; rerender\(\); \}\)/);
  assert.equal((fsrc.match(/keptCoupon = box\.getCode/g) || []).length, 1);
  const catches = fsrc.split('\n').filter((l) => /err\.code === 'PAYMENT_(RECEIVED|IN_PROGRESS)'/.test(l));
  assert.equal(catches.length, 4);
  catches.forEach((l) => assert.doesNotMatch(l, /keptCoupon/));
});

test('CARD-3: a carried in-progress sentence says the payment was received when paid_until moved and nothing waits', () => {
  assert.equal((fsrc.match(/carriedSentPaidUntil = bill\.paid_until \?\? null;/g) || []).length, 2);
  assert.match(fsrc, /billPaidUntil = bill\.paid_until \?\? null;/);
  const block = fsrc.slice(fsrc.indexOf('if (unlessWaiting && billingNotice === carriedEl)'));
  const body = block.slice(0, block.indexOf('el.replaceChildren'));
  // nothing waiting and paid_until the same: dropped; paid_until moved: the new sentence; a payment waiting: dropped
  assert.match(body, /if \(billWaiting\) billingNotice = null;\s*else if \(billPaidUntil !== sentPaidUntil\) billingNotice\.textContent = 'That payment was just received\. Check your plan before paying again\.';\s*else billingNotice = null;/);
});
