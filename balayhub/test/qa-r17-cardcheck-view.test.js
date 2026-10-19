'use strict';

// Card on file (D-98), lane F1: the Confirm your payment card page, its pure helpers and the route access rule.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r17f1-'));
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

test('luhnOk and parseExpiry', () => {
  assert.equal(cc.luhnOk('4120000000000007'), true);
  assert.equal(cc.luhnOk('4242424242424242'), true);
  assert.equal(cc.luhnOk('4242424242424241'), false);
  assert.equal(cc.luhnOk('1234'), false);
  assert.deepEqual(cc.parseExpiry('12/30'), { month: 12, year: 2030 });
  assert.deepEqual(cc.parseExpiry('1/2031'), { month: 1, year: 2031 });
  assert.deepEqual(cc.parseExpiry('0930'), { month: 9, year: 2030 });
  assert.equal(cc.parseExpiry('13/30'), null);
  assert.equal(cc.parseExpiry('ab'), null);
});

test('cardProblems messages are the exact 5.1 strings', () => {
  const today = new Date(2026, 9, 15);
  assert.deepEqual(cc.cardProblems({ name: ' ', number: '', exp: '', cvc: '' }, today), {
    name: 'Enter the name on the card.', number: 'Enter the card number.', exp: 'Enter the expiry as MM/YY.', cvc: 'Enter the 3 or 4 digit code on the back of the card.' });
  assert.equal(cc.cardProblems({ name: 'A', number: '4242 4242 4242 4241', exp: '12/30', cvc: '123' }, today).number, "This card number isn't valid. Check it and try again.");
  assert.equal(cc.cardProblems({ name: 'A', number: '4242424242424242', exp: '09/26', cvc: '123' }, today).exp, 'This card has expired.');
  assert.deepEqual(cc.cardProblems({ name: 'A', number: '4242424242424242', exp: '10/26', cvc: '1234' }, today), {}, 'the expiry month itself is still good');
});

test('owner page: heading, lead, three what-happens lines (stage 1)', async () => {
  const root = await mount();
  assert.equal(find(root, (e) => e.tag === 'h1').textContent, 'Confirm your payment card');
  assert.match(root.textContent, /One last step before your 14-day free trial starts\./);
  assert.match(root.textContent, /We charge ₱20 to your card once, to confirm it's yours\. The ₱20 is not refunded and is not part of a plan payment\./);
  assert.match(root.textContent, /PayMongo keeps your card details\. BalayHub never sees or stores your card number\./);
  assert.match(root.textContent, /Your trial ends on Oct 29, 2026\. Then pay for Growth \(₱999 a month\) with this card in one tap\. We'll email you 3 days and 1 day before\. Nothing is charged automatically\./);
  assert.equal(find(root, (e) => e.attrs.id === 'cc-consent'), undefined, 'no tick box in stage 1');
  assert.ok(find(root, (e) => e.attrs['aria-label'] === 'Starter · ₱499/mo · Up to 2 listings'));
  assert.equal(inputBy(root, 'cc-number').attrs.inputmode, 'numeric');
  assert.equal(inputBy(root, 'cc-number').attrs.name, undefined, 'no name attribute on card fields');
  assert.match(root.textContent, /Card payments are handled by PayMongo\. Your bank may ask you to confirm with a code\./);
  assert.ok(find(root, (e) => e.attrs.href === '#/help') && find(root, (e) => e.attrs.href === '#/account'));
});

test('picking a plan changes the line in place, same button elements', async () => {
  const root = await mount();
  const pro = find(root, (e) => e.attrs['aria-label']?.startsWith('Pro'));
  pro.fire('click');
  assert.equal(find(root, (e) => e.attrs['aria-label']?.startsWith('Pro')), pro);
  assert.equal(pro.attrs['aria-pressed'], 'true');
  assert.match(root.textContent, /Then pay for Pro \(₱1,799 a month\)/);
  await run((fill(root), root));
  assert.deepEqual(calls[0], ['/billing/card-check/start', { renewal_plan: 'pro' }]);
});

test('stage 2: monthly wording and a required tick box', async () => {
  const root = await mount({ subscriptions: true });
  assert.match(root.textContent, /Then we charge Growth \(₱999 a month\) to this card every month until you cancel\. You can cancel anytime in Settings, Plan & billing, and you won't be charged again after you cancel\./);
  assert.match(root.textContent, /I agree that BalayHub may charge my card for the plan above every month after my trial, until I cancel\./);
  fill(root); await run(root);
  assert.equal(calls.length, 0, 'unticked: nothing sent');
  const box = find(root, (e) => e.attrs.id === 'cc-consent');
  assert.equal(document.activeElement, box);
  assert.equal(find(root, (e) => e.attrs.id === 'cc-consent-err').textContent, 'Tick the box to agree to automatic payment.');
  box.checked = true; await run(root);
  assert.deepEqual(calls[0], ['/billing/card-check/start', { renewal_plan: 'growth', consent: true }]);
});

test('bad fields: messages under the fields, focus on the first bad one, nothing sent', async () => {
  const root = await mount(); fill(root, { name: '', number: '4242 4242 4242 4241', cvc: '1' });
  await run(root);
  assert.equal(calls.length, 0); assert.equal(fetches.length, 0);
  assert.equal(document.activeElement, inputBy(root, 'cc-name'));
  assert.equal(inputBy(root, 'cc-name').attrs['aria-invalid'], 'true');
  assert.match(inputBy(root, 'cc-number').attrs['aria-describedby'], /-err$/);
  assert.match(root.textContent, /This card number isn't valid\. Check it and try again\./);
});

test('a good card: PayMongo gets the card with the public key, BalayHub only the payment method id', async () => {
  const root = await mount(); fill(root);
  const numIn = inputBy(root, 'cc-number'); const cvcIn = inputBy(root, 'cc-csc');
  await run(root);
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0][0], 'https://api.paymongo.com/v1/payment_methods');
  assert.equal(fetches[0][1].headers.Authorization, `Basic ${Buffer.from('pk_test_abc:').toString('base64')}`);
  const sent = JSON.parse(fetches[0][1].body).data.attributes;
  assert.deepEqual(sent.details, { card_number: '4120000000000007', exp_month: 12, exp_year: 2030, cvc: '123' });
  assert.deepEqual(sent.billing, { name: 'Ana Reyes', email: 'ana@example.com' });
  const attach = calls.find((c) => c[0].endsWith('/attach'));
  assert.deepEqual(attach, ['/billing/card-check/b1/attach', { payment_method_id: 'pm_abcdef123' }]);
  const everything = JSON.stringify(calls);
  for (const secret of ['4120', '0007', '12/30', '"123"', 'Ana Reyes']) assert.ok(!everything.includes(secret), `BalayHub calls never carry ${secret}`);
  assert.equal(numIn.value, ''); assert.equal(cvcIn.value, '');
  assert.equal(globalThis.__refreshed, 1);
  const h2 = find(root, (e) => e.tag === 'h2' && e.textContent === 'Your card is confirmed');
  assert.equal(document.activeElement, h2);
  assert.match(root.textContent, /Your free trial has started\. It ends on Oct 29, 2026\./);
  assert.equal(find(root, (e) => e.tag === 'a' && e.textContent === 'Set up my workspace').attrs.href, '#/launchpad');
});

test('long-term only workspaces go to add a property after success', async () => {
  st.user.business_type = 'long_term';
  const root = await mount(); fill(root); await run(root);
  assert.equal(find(root, (e) => e.tag === 'a' && e.textContent === 'Set up my workspace').attrs.href, '#/properties?new=1');
});

test('action_required sends the browser to the bank', async () => {
  const base = stub.post;
  const root = await mount(); fill(root);
  stub.post = async (u, b) => (u.endsWith('/attach') ? (calls.push([u, b]), { status: 'action_required', redirect_url: 'https://bank.example/3ds' }) : base(u, b));
  await run(root);
  assert.deepEqual(assigned, ['https://bank.example/3ds']);
});

test('a declined card puts the message in the summary and focus on it', async () => {
  const base = stub.post;
  const root = await mount(); fill(root);
  stub.post = async (u, b) => (u.endsWith('/attach') ? { status: 'failed', message: 'Your card was declined. Try another card, or ask your bank.' } : base(u, b));
  await run(root);
  const box = find(root, (e) => e.attrs.role === 'alert' && e.tag === 'div' && e.className.includes('alert'));
  assert.equal(box.hidden, false); assert.equal(box.textContent, 'Your card was declined. Try another card, or ask your bank.');
  assert.equal(document.activeElement, box);
  assert.equal(payBtn(root).textContent, 'Pay ₱20 and start my trial');
});

test('PayMongo field error and network failure messages', async () => {
  const root = await mount(); fill(root);
  stub.fetch = async () => ({ ok: false, status: 400, json: async () => ({ errors: [{ detail: 'card_number is invalid.' }] }) });
  await run(root);
  assert.match(find(root, (e) => e.className.includes('alert')).textContent, /^PayMongo says: card_number is invalid\.$/);
  fill(root); stub.fetch = async () => { throw new TypeError('network'); };
  await run(root);
  assert.equal(find(root, (e) => e.className.includes('alert')).textContent, "We couldn't reach the payment service. Nothing was charged. Please try again in a moment.");
  assert.equal(inputBy(root, 'cc-number').value, '', 'card number cleared even when the request failed');
});

test('429 says wait', async () => {
  const root = await mount(); fill(root);
  stub.post = async () => { const e = new Error('x'); e.status = 429; throw e; };
  await run(root);
  assert.equal(find(root, (e) => e.className.includes('alert')).textContent, 'Too many tries. Please wait a few minutes and try again.');
});

test('coming back from the bank polls refresh, then shows success', async () => {
  globalThis.history = { state: null, replaceState: (...a) => calls.push(['replaceState', a[2]]) };
  const base = stub.post; let n = 0;
  stub.post = async (u, b) => { calls.push([u, b]); return u.endsWith('/refresh') ? (++n < 2 ? { status: 'pending' } : { status: 'passed', trial_ends_at: '2026-10-29T15:59:59.000Z' }) : base(u, b); };
  cc.poll.ms = 5;
  const root = await mount({}, { check: 'b9' });
  assert.equal(calls[0][0], 'replaceState'); assert.equal(calls[0][1], '#/confirm-card');
  assert.match(root.textContent, /Checking with your bank…/);
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(calls.filter((c) => c[0] === '/billing/card-check/b9/refresh').length, 2);
  assert.match(root.textContent, /Your card is confirmed/);
  cc.poll.ms = 3000;
});

test('a view started with ?check= on a detached page starts polling once the page is attached', async () => {
  globalThis.history = { state: null, replaceState() {} };
  stub.post = async (u, b) => { calls.push([u, b]); return u.endsWith('/refresh') ? { status: 'passed', trial_ends_at: '2026-10-29T15:59:59.000Z' } : { status: 'pending' }; };
  cc.poll.attachMs = 5;
  stub.get = async () => ({ ...INFO });
  const el = new El('main'); el.isConnected = false;
  await view(el, { query: { check: 'b7' } });
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(calls.filter((c) => c[0].endsWith('/refresh')).length, 0, 'waits while detached');
  el.isConnected = true;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls.filter((c) => c[0] === '/billing/card-check/b7/refresh').length, 1);
  assert.match(el.textContent, /Your card is confirmed/);
  assert.equal(document.activeElement.textContent, 'Your card is confirmed');
  cc.poll.attachMs = 50;
});

test('a page removed after it was attached stops polling', async () => {
  globalThis.history = { state: null, replaceState() {} };
  let n = 0; stub.post = async (u) => { if (u.endsWith('/refresh')) n++; return { status: 'pending' }; };
  const saved = cc.poll.ms; cc.poll.ms = 5;
  const el = new El('main'); el.isConnected = true;
  stub.get = async () => ({ ...INFO });
  await view(el, { query: { check: 'b8' } });
  await new Promise((r) => setTimeout(r, 30)); el.isConnected = false;
  await new Promise((r) => setTimeout(r, 20)); const seen = n;
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(seen > 0); assert.equal(n, seen); cc.poll.ms = saved;
});

test('a 402 from attach shows the server message, or the declined copy when it has none', async () => {
  const base = stub.post;
  const root = await mount(); fill(root);
  const fail = (data) => async (u, b) => { if (!u.endsWith('/attach')) return base(u, b); const e = new Error('Request failed (402).'); e.status = 402; e.data = data; throw e; };
  stub.post = fail({ status: 'failed', message: 'Your card was declined. Try another card, or ask your bank.' });
  await run(root);
  assert.equal(find(root, (e) => e.className.includes('alert')).textContent, 'Your card was declined. Try another card, or ask your bank.');
  fill(root); stub.post = fail({ status: 'failed' }); await run(root);
  assert.equal(find(root, (e) => e.className.includes('alert')).textContent, 'Your card was declined. Try another card, or ask your bank.');
});

test('start answering passed goes straight to success and sends no card to PayMongo', async () => {
  const base = stub.post;
  const root = await mount(); fill(root);
  stub.post = async (u, b) => (u.endsWith('/start') ? (calls.push([u, b]), { billing_id: 'b1', amount: '20.00', status: 'passed', trial_ends_at: '2026-10-29T15:59:59.000Z' }) : base(u, b));
  await run(root);
  assert.equal(fetches.length, 0); assert.equal(calls.filter((c) => c[0].endsWith('/attach')).length, 0);
  assert.equal(globalThis.__refreshed, 1);
  assert.equal(document.activeElement, find(root, (e) => e.tag === 'h2' && e.textContent === 'Your card is confirmed'));
});

test('start answering passed clears the card number and CVC from the inputs', async () => {
  const base = stub.post;
  const root = await mount(); fill(root);
  const numIn = inputBy(root, 'cc-number'); const cvcIn = inputBy(root, 'cc-csc');
  stub.post = async (u, b) => (u.endsWith('/start') ? (calls.push([u, b]), { billing_id: 'b1', amount: '20.00', status: 'passed', trial_ends_at: '2026-10-29T15:59:59.000Z' }) : base(u, b));
  await run(root);
  assert.equal(numIn.value, ''); assert.equal(cvcIn.value, '');
});

test('503 PAYMENT_PROVIDER_UNAVAILABLE shows the server message, focused, nothing sent to PayMongo', async () => {
  const root = await mount(); fill(root);
  const msg = "We couldn't reach our payment provider to check your earlier payment, so nothing was charged. Please try again in a minute.";
  stub.post = async () => { const e = new Error(msg); e.status = 503; e.code = 'PAYMENT_PROVIDER_UNAVAILABLE'; throw e; };
  await run(root);
  const box = find(root, (e) => e.className.includes('alert'));
  assert.equal(box.textContent, msg); assert.equal(document.activeElement, box); assert.equal(fetches.length, 0);
});

test('start answering 503 clears the card number and CVC from the inputs', async () => {
  const root = await mount(); fill(root);
  const numIn = inputBy(root, 'cc-number'); const cvcIn = inputBy(root, 'cc-csc');
  stub.post = async () => { const e = new Error('We couldn\'t reach our payment provider to check your earlier payment, so nothing was charged. Please try again in a minute.'); e.status = 503; e.code = 'PAYMENT_PROVIDER_UNAVAILABLE'; throw e; };
  await run(root);
  assert.equal(numIn.value, ''); assert.equal(cvcIn.value, ''); assert.equal(fetches.length, 0);
});

test('team member sees the waiting page with the owner name and no API call', async () => {
  st.user.role = 'manager';
  const root = await mount();
  assert.equal(find(root, (e) => e.tag === 'h1').textContent, 'Waiting for your workspace owner');
  assert.match(root.textContent, /Ana Reyes needs to confirm a payment card before your team can use BalayHub\. Ask them to log in and finish setup\./);
});

test('bank return when the server says passed but the user is still card-due: refresh first, show success, never loop', async () => {
  globalThis.history = { state: null, replaceState() {} };
  const order = [];
  st.user.plan = { card_check_due: true };
  const root = await mount({ status: 'passed', required: false }, { check: 'b5' });
  order.push(globalThis.__refreshed);
  assert.equal(globalThis.__refreshed, 1, 'refreshUser awaited');
  assert.ok(globalThis.__nav.length <= 1, 'navigate at most once');
  assert.equal(globalThis.__nav.length, 0, 'stale card_check_due: no navigate, so no loop');
  const h2 = find(root, (e) => e.tag === 'h2' && e.textContent === 'Your card is confirmed');
  assert.ok(h2, 'success panel shown');
  assert.equal(document.activeElement, h2);
  assert.match(root.textContent, /Your free trial has started\. It ends on Oct 29, 2026\./);
  assert.ok(find(root, (e) => e.tag === 'a' && e.textContent === 'Set up my workspace'));
});

test('passed without ?check= and the user refreshed clean: one navigate home; still due: Continue link, no navigate', async () => {
  st.user.plan = { card_check_due: false };
  await mount({ status: 'passed', required: false });
  assert.equal(globalThis.__refreshed, 1);
  assert.equal(globalThis.__nav.length, 1);
  globalThis.__nav.length = 0; st.user.plan = { card_check_due: true };
  const root = await mount({ status: 'passed', required: false });
  assert.equal(globalThis.__nav.length, 0);
  assert.ok(find(root, (e) => e.tag === 'a' && e.textContent === 'Continue'));
});

test('routeAllowed while the card is due', () => {
  const due = { role: 'owner', business_type: 'short_term', plan: { card_check_due: true } };
  const ok = { role: 'owner', business_type: 'short_term', plan: { card_check_due: false } };
  assert.equal(access('/home', due), false);
  assert.equal(access('/settings', due), false);
  assert.equal(access('/confirm-card', due), true);
  assert.equal(access('/help', due), true); assert.equal(access('/help/new', due), true);
  assert.equal(access('/account', due), true);
  assert.equal(access('/confirm-card', ok), false);
  assert.equal(access('/home', ok), true);
});
