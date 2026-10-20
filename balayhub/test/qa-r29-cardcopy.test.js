'use strict';

// QA round 29 CARDCOPY (D-111): the 429 message names the server's own wait. Harness copied from qa-r17-cardcheck-view.
// (the Confirm your payment card page, its pure helpers and the route access rule.
// The view runs against a tiny fake DOM with ui.js, api.js and app.js stubbed (the real ones need a browser). Frontend only, no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

class El {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.l = {}; this.hidden = false; this.value = ''; this.checked = false; this.className = ''; this._t = ''; const self = this; this.classList = { add: (c) => { self.className = `${self.className} ${c}`.trim(); }, remove: (c) => { self.className = self.className.split(' ').filter((x) => x !== c).join(' '); } }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { this.l[t] = f; }
  append(...c) { this.children.push(...c); }
  replaceChildren(...c) { this.children = c; }
  focus() { global.document.activeElement = this; }
  set textContent(v) { this._t = String(v); this.children = []; }
  get textContent() { return this._t + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  fire(t, init = {}) { return this.l[t]?.({ type: t, preventDefault() {}, target: this, ...init }); }
  all(f, out = []) { if (f(this)) out.push(this); this.children.forEach((c) => c.all && c.all(f, out)); return out; }
}

let view; let access; let cc; let calls; let fetches; let assigned; let st;
const stub = { get: null, post: null, fetch: null };

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r29cc-'));
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
        else if (k === 'value') el.value = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
      el.append(...kids.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
      return el;
    }
    export const fmtDate = (d) => { const [y, m, day] = String(d).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };`);
  fs.writeFileSync(path.join(dir, 'api.js'), 'export const get = (...a) => globalThis.__get(...a); export const post = (...a) => globalThis.__post(...a);\n');
  fs.writeFileSync(path.join(dir, 'app.js'), `export const state = globalThis.__state;
    export const navigate = (...a) => globalThis.__nav.push(a);
    export const refreshUser = async () => { globalThis.__refreshed += 1; };
    export const logout = () => {}; export const homeRoute = () => '#/home';`);
  fs.copyFileSync(path.join(__dirname, '../public/js/views/cardcheck.js'), path.join(dir, 'views', 'cardcheck.js'));
  fs.copyFileSync(path.join(__dirname, '../public/js/routeaccess.js'), path.join(dir, 'routeaccess.js'));
  globalThis.__state = { user: null }; globalThis.__nav = []; globalThis.__refreshed = 0;
  global.document = { activeElement: null, createElement: (t) => new El(t) };
  global.location = { assign: (u) => assigned.push(u) };
  globalThis.fetch = (...a) => stub.fetch(...a);
  cc = await import(pathToFileURL(path.join(dir, 'views', 'cardcheck.js')).href);
  view = cc.cardCheckView;
  access = (await import(pathToFileURL(path.join(dir, 'routeaccess.js')).href)).routeAllowed;
});

const INFO = {
  required: true, status: 'required', amount: '20.00', trial_days: 14, trial_would_end: '2026-10-29', public_key: 'pk_test_abc', paymongo_api: 'https://api.paymongo.com/v1',
  subscriptions: false, renewal_plan: 'growth', pending: null,
  plans: [{ key: 'starter', name: 'Starter', price: 499, listings: 2 }, { key: 'growth', name: 'Growth', price: 999, listings: 10 }, { key: 'pro', name: 'Pro', price: 1799, listings: 30 }],
};

test.beforeEach(() => {
  calls = []; fetches = []; assigned = [];
  st = globalThis.__state; globalThis.__nav.length = 0;
  st.user = { role: 'owner', email: 'ana@example.com', business_type: 'short_term', owner_name: 'Ana Reyes' };
  globalThis.__refreshed = 0;
  stub.get = async () => ({ ...INFO });
  stub.post = async (url, body) => { calls.push([url, body]); if (url.endsWith('/start')) return { billing_id: 'b1', amount: '20.00' }; if (url.endsWith('/attach')) return { status: 'passed', trial_ends_at: '2026-10-29T15:59:59.000Z' }; return { status: 'pending' }; };
  stub.fetch = async (url, opts) => { fetches.push([url, opts]); return { ok: true, status: 200, json: async () => ({ data: { id: 'pm_abcdef123' } }) }; };
  globalThis.__get = (...a) => stub.get(...a);
  globalThis.__post = (...a) => stub.post(...a);
});

// The fake DOM is re-imported per module load, so state is read through globalThis at import time: set it once.
const mount = async (info = {}, query = {}) => { stub.get = async () => ({ ...INFO, ...info }); const el = new El('main'); await view(el, { query }); return el; };
const find = (root, f) => root.all(f)[0];
const inputBy = (root, auto) => find(root, (e) => e.tag === 'input' && e.attrs.autocomplete === auto);
const payBtn = (root) => find(root, (e) => e.tag === 'button' && /^(Pay ₱20|Checking)/.test(e.textContent));
const tick = () => new Promise((r) => setTimeout(r, 0));
const fill = (root, o = {}) => {
  inputBy(root, 'cc-name').value = o.name ?? 'Ana Reyes'; inputBy(root, 'cc-number').value = o.number ?? '4120 0000 0000 0007';
  inputBy(root, 'cc-exp').value = o.exp ?? '12/30'; inputBy(root, 'cc-csc').value = o.cvc ?? '123';
};
const run = async (root) => { payBtn(root).fire('click'); for (let i = 0; i < 6; i++) await tick(); };

const OLD = 'Too many tries. Please wait a few minutes and try again.';
const reject429 = (data) => { stub.post = async () => { const e = new Error('x'); e.status = 429; if (data) e.data = data; throw e; }; };

test('rateText: no usable number keeps the old sentence', () => {
  for (const v of [undefined, null, 0, -5, 'x', NaN]) assert.equal(cc.rateText(v), OLD);
});

test('rateText: minutes and hours from the server wait', () => {
  assert.equal(cc.rateText(30), 'Too many tries. Please try again in 1 minute.');
  assert.equal(cc.rateText(61), 'Too many tries. Please try again in 2 minutes.');
  assert.equal(cc.rateText(3540), 'Too many tries. Please try again in 59 minutes.');
  assert.equal(cc.rateText(3600), 'Too many tries. Please try again in about an hour.');
  assert.equal(cc.rateText(86400), 'Too many tries. Please try again in about 24 hours.');
});

test('mounted page: a 429 with retry_after shows the real wait', async () => {
  const root = await mount(); fill(root);
  reject429({ retry_after: 1500 });
  await run(root);
  assert.equal(find(root, (e) => e.className.includes('alert')).textContent, 'Too many tries. Please try again in 25 minutes.');
});

test('mounted page: a 429 with no data keeps the old sentence', async () => {
  const root = await mount(); fill(root);
  reject429();
  await run(root);
  assert.equal(find(root, (e) => e.className.includes('alert')).textContent, OLD);
});
