'use strict';

// QA round 15, atom B3b (founder plan): the owner coupon routes in src/routes/billing.js.
// Contract: docs/contracts/platform-coupons.md, section 2. Runs on this lane's own database and never falls back to the default one:
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_11 node --test --test-concurrency=1 test/qa-r15-billing-routes.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_fake';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_fake';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const config = require('../src/config');

// Fake PayMongo (as in billing-coupons.test.js): remembers checkouts; tests flip them to paid.
const realFetch = globalThis.fetch;
const sessions = new Map();
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.paymongo.com/')) return realFetch(url, opts);
  calls.push({ url: u, method: opts.method, body: opts.body && JSON.parse(opts.body) });
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (opts.method === 'POST' && u.endsWith('/checkout_sessions')) {
    const a = JSON.parse(opts.body).data.attributes;
    const id = `cs_${crypto.randomBytes(6).toString('hex')}`;
    sessions.set(id, { id, attributes: { ...a, checkout_url: `https://checkout.paymongo.com/${id}`, status: 'active', payments: [] } });
    return json({ data: sessions.get(id) });
  }
  const m = /checkout_sessions\/(cs_\w+)$/.exec(u);
  if (m && sessions.has(m[1])) return json({ data: sessions.get(m[1]) });
  return json({ errors: [{ detail: 'not found' }] }, 404);
};
const pay = (id, amountCentavos) => {
  const s = sessions.get(id);
  s.attributes.payments = [{ id: 'pay_1', attributes: { status: 'paid', amount: amountCentavos, source: { type: 'gcash' } } }];
  s.attributes.payment_method_used = 'gcash';
};
const checkoutIdOf = async (billingId) => (await sql('SELECT checkout_id FROM billing_payments WHERE billing_id = $1', [billingId]))[0].checkout_id;

const INVALID = { error: "This code isn't valid right now. Check it and try again.", code: 'COUPON_INVALID' };

// The signup limit is 10 an hour per IP and every test here comes from one IP, so the file makes 9 owner accounts in all.
// Read-only tests share one owner; each test that changes the workspace's coupon or plan gets its own.
let srv; let workspaces = 0; let shared;
test.before(async () => {
  srv = await startServer();
  shared = await newOwner();
});
test.after(async () => { globalThis.fetch = realFetch; await srv.close(); });

async function newOwner() {
  workspaces += 1;
  const email = `b3b-owner-${workspaces}@example.com`;
  const name = `B3b Stays ${workspaces}`;
  const c = await ownerAccount(srv.base, email, name);
  const [o] = await sql('SELECT organization_id FROM organizations WHERE name = $1', [name]);
  return { c, orgId: o.organization_id };
}

// A live coupon that started yesterday, unless the fields say otherwise. Defaults to 50% off the first 3 billed months.
async function addCoupon(code, fields = {}) {
  const f = {
    kind: 'percent', percent_off: 50, amount_off: null, duration: 'months', duration_months: 3, plans: null,
    require_card: false, active: true, starts_at: new Date(Date.now() - 86400e3), ends_at: null, ...fields,
  };
  const [row] = await sql(
    `INSERT INTO platform_coupons (code, name, kind, percent_off, amount_off, duration, duration_months, plans, require_card, active, starts_at, ends_at)
     VALUES ($1, 'Test coupon', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [code, f.kind, f.kind === 'percent' ? f.percent_off : null, f.kind === 'fixed' ? f.amount_off : null,
      f.duration, f.duration === 'months' ? f.duration_months : null, f.plans, f.require_card, f.active, f.starts_at, f.ends_at]);
  return row;
}

test('owner previews a coupon and gets the documented shape', async () => {
  const { c } = shared;
  await addCoupon('ALPHA50');
  const r = await c.post('/api/billing/coupon/preview', { code: 'ALPHA50', plan: 'growth', months: '1' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(Object.keys(r.data).sort(), ['amount', 'card_only', 'coupon', 'covered_months', 'discount_amount', 'free', 'list_amount', 'message', 'min_charge_applied', 'months', 'plan']);
  assert.deepEqual(Object.keys(r.data.coupon).sort(), ['amount_off', 'code', 'duration', 'duration_months', 'kind', 'months_left', 'name', 'percent_off', 'plans', 'require_card', 'source']);
  assert.deepEqual(r.data, {
    coupon: { code: 'ALPHA50', name: 'Test coupon', kind: 'percent', percent_off: 50, amount_off: null, duration: 'months', duration_months: 3, months_left: 3, plans: null, require_card: false, source: 'new' },
    plan: 'growth',
    months: 1,
    list_amount: '999.00',
    discount_amount: '499.50',
    amount: '499.50',
    covered_months: 1,
    free: false,
    card_only: false,
    min_charge_applied: false,
    message: 'This payment covers 1 of your 3 coupon months.',
  });
});

test('the code ignores case, spaces around it and spaces inside it', async () => {
  const { c } = shared;
  await addCoupon('CASE50');
  const r = await c.post('/api/billing/coupon/preview', { code: ' case 50 ', plan: 'growth', months: '1' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.coupon.code, 'CASE50');
});

test('managers and staff cannot preview, check out or read the coupon box', async () => {
  const { c } = shared;
  const property = (await c.post('/api/properties', {
    property_name: 'Azure', property_type: 'condominium', address: 'Azure Ave', city: 'Taguig', province: 'Metro Manila',
  })).data.property;
  for (const [email, role] of [['b3b-mgr@example.com', 'manager'], ['b3b-staff@example.com', 'staff']]) {
    const inv = await c.post('/api/team/invitations', { email, role, property_ids: [property.property_id] });
    const token = decodeURIComponent(inv.data.inviteLink.split('invite=')[1]);
    const member = client(srv.base);
    const s = await member.post('/api/auth/signup', { full_name: role, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: token });
    assert.equal(s.status, 201, JSON.stringify(s.data));
    assert.equal((await member.post('/api/billing/coupon/preview', { code: 'ALPHA50', plan: 'growth', months: '1' })).status, 403, role);
    assert.equal((await member.post('/api/billing/checkout', { plan: 'growth', months: '1', coupon_code: 'ALPHA50' })).status, 403, role);
    assert.equal((await member.get('/api/billing')).status, 403, role);
  }
});

test('unknown, switched-off and ended codes all answer the same 400', async () => {
  const { c } = shared;
  await addCoupon('OFFCODE', { active: false });
  await addCoupon('ENDEDCODE', { ends_at: new Date(Date.now() - 3600e3) });
  const bodies = [];
  for (const code of ['NOSUCHCODE', 'OFFCODE', 'ENDEDCODE']) {
    const r = await c.post('/api/billing/coupon/preview', { code, plan: 'growth', months: '1' });
    assert.equal(r.status, 400);
    bodies.push(r.data);
  }
  assert.deepEqual(bodies, [INVALID, INVALID, INVALID]);
});

// A discounted quote waits while the workspace is paid more than 45 days ahead (checkout already does this; preview must agree).
test('a discounted preview is refused while the workspace is paid more than 45 days ahead', async () => {
  const { c, orgId } = shared;
  const [{ paid_until: before }] = await sql('SELECT paid_until FROM organizations WHERE organization_id = $1', [orgId]);
  const manilaPlus = (days) => new Date(Date.now() + 8 * 3600e3 + days * 86400e3).toISOString().slice(0, 10);
  try {
    await sql('UPDATE organizations SET paid_until = $2 WHERE organization_id = $1', [orgId, manilaPlus(60)]);
    const r = await c.post('/api/billing/coupon/preview', { code: 'ALPHA50', plan: 'growth', months: '1' });
    assert.equal(r.status, 409);
    assert.deepEqual(r.data, { error: 'Your plan is already paid ahead. Your coupon applies at your next renewal.', code: 'COUPON_AHEAD' });
    const plain = await c.post('/api/billing/coupon/preview', { plan: 'growth', months: '1' });
    assert.equal(plain.status, 200, JSON.stringify(plain.data));
    assert.equal(plain.data.coupon, null);
    await sql('UPDATE organizations SET paid_until = $2 WHERE organization_id = $1', [orgId, manilaPlus(45)]);
    const edge = await c.post('/api/billing/coupon/preview', { code: 'ALPHA50', plan: 'growth', months: '1' });
    assert.equal(edge.status, 200, JSON.stringify(edge.data));
  } finally {
    await sql('UPDATE organizations SET paid_until = $2 WHERE organization_id = $1', [orgId, before]);
  }
});

test('a coupon checkout is discounted; the owner box shows months left and the history row shows the saving', async () => {
  const { c } = await newOwner();
  await addCoupon('THREEMO');
  const r = await c.post('/api/billing/checkout', { plan: 'growth', months: '1', coupon_code: 'threemo' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.checkout_url, /^https:\/\/checkout\.paymongo\.com\//);
  assert.equal(calls.at(-1).body.data.attributes.line_items[0].amount, 49950);
  pay(await checkoutIdOf(r.data.billing_id), 49950);
  assert.deepEqual((await c.post(`/api/billing/${r.data.billing_id}/refresh`)).data, { status: 'paid' });

  // The next checkout applies the coupon's remaining months with no code typed.
  const again = await c.post('/api/billing/coupon/preview', { plan: 'growth', months: '1' });
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(again.data.coupon.source, 'redeemed');
  assert.equal(again.data.discount_amount, '499.50');

  const bill = (await c.get('/api/billing')).data;
  assert.deepEqual(bill.coupon, {
    code: 'THREEMO', name: 'Test coupon', kind: 'percent', percent_off: 50, amount_off: null, duration: 'months', duration_months: 3,
    months_left: 2, plans: null, require_card: false, status: 'active',
  });
  const row = bill.history.find((h) => h.billing_id === r.data.billing_id);
  assert.deepEqual(
    { coupon_code: row.coupon_code, provider: row.provider, list_amount: row.list_amount, discount_amount: row.discount_amount, amount: row.amount },
    { coupon_code: 'THREEMO', provider: 'paymongo', list_amount: '999.00', discount_amount: '499.50', amount: '499.50' });
});

test('a free coupon activates the plan with no PayMongo call', async () => {
  const { c } = await newOwner();
  await addCoupon('FREEMONTH', { kind: 'free', percent_off: null, duration: 'once', duration_months: null });
  const before = calls.length;
  const r = await c.post('/api/billing/checkout', { plan: 'growth', months: '1', coupon_code: 'FREEMONTH' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(calls.length, before, 'no PayMongo call');
  assert.deepEqual(Object.keys(r.data).sort(), ['activated', 'billing_id', 'paid_until', 'plan']);
  assert.equal(r.data.activated, true);
  assert.equal(r.data.plan, 'growth');
  assert.match(r.data.paid_until, /^\d{4}-\d{2}-\d{2}$/);
});

test('a complimentary workspace gets the coupon copy, not a payment message', async () => {
  const { c, orgId } = await newOwner();
  await addCoupon('COMPED50');
  await sql(`UPDATE organizations SET plan = 'comped' WHERE organization_id = $1`, [orgId]);
  const r = await c.post('/api/billing/coupon/preview', { code: 'COMPED50', plan: 'growth', months: '1' });
  assert.equal(r.status, 409);
  assert.deepEqual(r.data, { error: "Your workspace is on a complimentary plan, so coupons don't apply.", code: 'COMPED' });
  const k = await c.post('/api/billing/checkout', { plan: 'growth', months: '1', coupon_code: 'COMPED50' });
  assert.deepEqual(k.data, { error: "Your workspace is on a complimentary plan, so coupons don't apply.", code: 'COMPED' });
  const plain = await c.post('/api/billing/checkout', { plan: 'growth', months: '1' });
  assert.deepEqual(plain.data, { error: 'Your workspace is on a complimentary plan, so there is nothing to pay.', code: 'COMPED' });
});

// The app-wide read-only guard (planGuard) refuses every write from a demo workspace before the route runs, so the
// coupon route's own demo check (coupons.resolve) is a backstop that HTTP never reaches.
test('a demo workspace cannot use coupons: the read-only guard refuses the preview and the checkout', async () => {
  const { c, orgId } = await newOwner();
  await addCoupon('DEMO50');
  await sql('UPDATE organizations SET is_demo = true WHERE organization_id = $1', [orgId]);
  const r = await c.post('/api/billing/coupon/preview', { code: 'DEMO50', plan: 'growth', months: '1' });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'DEMO_READ_ONLY');
  const k = await c.post('/api/billing/checkout', { plan: 'growth', months: '1', coupon_code: 'DEMO50' });
  assert.equal(k.status, 403);
  assert.equal(k.data.code, 'DEMO_READ_ONLY');
});

test('a card-only code is refused with the coupon copy while card payments are off; with card on, the free period keeps the minimum charge', async () => {
  const { c } = await newOwner();
  await addCoupon('CARDFREE', { kind: 'free', percent_off: null, duration: 'once', duration_months: null, require_card: true });
  const methods = config.paymongoMethods;
  try {
    config.paymongoMethods = ['gcash'];
    const preview = await c.post('/api/billing/coupon/preview', { code: 'CARDFREE', plan: 'growth', months: '1' });
    assert.equal(preview.status, 409);
    assert.deepEqual(preview.data, { error: 'This code needs a card payment, and card payments are off right now.', code: 'CARD_OFF' });
    const checkout = await c.post('/api/billing/checkout', { plan: 'growth', months: '1', coupon_code: 'CARDFREE' });
    assert.equal(checkout.status, 409);
    assert.equal(checkout.data.code, 'CARD_OFF');
  } finally {
    config.paymongoMethods = methods;
  }
  const on = await c.post('/api/billing/coupon/preview', { code: 'CARDFREE', plan: 'growth', months: '1' });
  assert.equal(on.status, 200, JSON.stringify(on.data));
  assert.deepEqual(
    { amount: on.data.amount, discount_amount: on.data.discount_amount, free: on.data.free, card_only: on.data.card_only, min_charge_applied: on.data.min_charge_applied },
    { amount: '20.00', discount_amount: '979.00', free: false, card_only: true, min_charge_applied: true });
});

// Online payment off is answered before the code is looked at, so the reply never says whether a code exists.
test('while online payment is off, preview refuses before it checks the code, with the checkout message', async () => {
  const { c } = shared;
  const key = config.paymongoSecretKey;
  try {
    config.paymongoSecretKey = '';
    const r = await c.post('/api/billing/coupon/preview', { code: 'NOSUCHCODE', plan: 'growth', months: '1' });
    assert.equal(r.status, 409);
    assert.deepEqual(r.data, { error: 'Online payment is not set up yet. Please pay by GCash or bank transfer and contact us.', code: 'BILLING_OFF' });
  } finally {
    config.paymongoSecretKey = key;
  }
});

// Every failed code check in this file counts against the same IP (127.0.0.1). The per-IP limit is 60 per 15 minutes,
// far above this file's total, so the 11th check here is stopped by the per-workspace limit of 10.
test('failed codes are limited to 10 per workspace in 15 minutes; successful checks do not count; a checkout without a code is not limited', async () => {
  const { c } = await newOwner();
  await addCoupon('RATE50');
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await c.post('/api/billing/coupon/preview', { code: 'RATE50', plan: 'growth', months: '1' })).status, 200);
  }
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await c.post('/api/billing/coupon/preview', { code: 'NOSUCHCODE', plan: 'growth', months: '1' })).status, 400);
  }
  const over = await c.post('/api/billing/coupon/preview', { code: 'NOSUCHCODE', plan: 'growth', months: '1' });
  assert.equal(over.status, 429);
  assert.equal(over.data.code, 'RATE_LIMITED');
  assert.equal((await c.post('/api/billing/checkout', { plan: 'growth', months: '1', coupon_code: 'NOSUCHCODE' })).status, 429);
  const plain = await c.post('/api/billing/checkout', { plan: 'growth', months: '1' });
  assert.equal(plain.status, 200, JSON.stringify(plain.data));
});
