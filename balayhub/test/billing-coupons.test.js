'use strict';

process.env.PAYMONGO_SECRET_KEY = 'sk_test_fake';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_fake';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql } = require('./helpers');
const billing = require('../src/lib/billing');
const config = require('../src/config');

// Fake PayMongo (copied from billing.test.js): remembers checkouts; tests flip them to paid, expired or failing.
const realFetch = globalThis.fetch;
const sessions = new Map();
const calls = [];
let failNextCreate = false;
let answerNoUrlNext = false;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.paymongo.com/')) return realFetch(url, opts);
  calls.push({ url: u, method: opts.method, body: opts.body && JSON.parse(opts.body) });
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (opts.method === 'POST' && u.endsWith('/checkout_sessions')) {
    if (failNextCreate) { failNextCreate = false; return json({ errors: [{ detail: 'boom' }] }, 500); }
    if (answerNoUrlNext) { answerNoUrlNext = false; return json({ data: { attributes: {} } }); }
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
// A Manila calendar date, offset days from today.
const manilaDay = (offset) => new Date(Date.now() + 8 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);

let srv; let workspaces = 0;
test.before(async () => { srv = await startServer(); });
test.after(async () => { globalThis.fetch = realFetch; await srv.close(); });

// A fresh owner workspace in the trial state the signup route creates, per test, so one test's coupon never holds
// another's slot. Inserted directly: the signup route allows 10 accounts an hour from one address, which this file exceeds.
async function newWorkspace() {
  workspaces += 1;
  const name = `Coupon Stays ${workspaces}`;
  const [o] = await sql(
    `INSERT INTO organizations (name, business_type, plan, trial_ends_at) VALUES ($1, 'short_term', 'trial', now() + make_interval(days => $2))
     RETURNING organization_id`, [name, config.trialDays]);
  const [u] = await sql(
    `INSERT INTO users (full_name, email, password_hash, organization_id, role, email_verified_at)
     VALUES ('Coupon Host', $1, 'x', $2, 'owner', now()) RETURNING user_id`, [`coupon-host-${workspaces}@example.com`, o.organization_id]);
  return { user: { user_id: u.user_id, organization_id: o.organization_id, organization_name: name } };
}

// A live coupon that started yesterday. Defaults to 50% off the first billed month.
async function addCoupon(code, fields = {}) {
  const f = { kind: 'percent', percent_off: 50, amount_off: null, duration: 'once', duration_months: null, plans: null, require_card: false, ...fields };
  const [row] = await sql(
    `INSERT INTO platform_coupons (code, name, kind, percent_off, amount_off, duration, duration_months, plans, require_card, starts_at)
     VALUES ($1, 'Test coupon', $2, $3, $4, $5, $6, $7, $8, now() - interval '1 day') RETURNING *`,
    [code, f.kind, f.kind === 'percent' ? f.percent_off : null, f.amount_off, f.duration, f.duration_months, f.plans, f.require_card]);
  return row;
}

const billingRow = async (billingId) => (await sql(
  `SELECT amount::text, list_amount::text, discount_amount::text, coupon_months, provider, status, coupon_redemption_id
     FROM billing_payments WHERE billing_id = $1`, [billingId]))[0];

test('no code and no live coupon: the checkout is the list price, as before', async () => {
  const { user } = await newWorkspace();
  const r = await billing.createCheckout(user, 'growth', 3);
  const a = calls.at(-1).body.data.attributes;
  assert.equal(a.line_items[0].amount, 299700);
  assert.equal(a.line_items[0].name, 'BalayHub Growth — 3 months');
  assert.equal(a.metadata.coupon_code, undefined);
  assert.deepEqual(await billingRow(r.billing_id), {
    amount: '2997.00', list_amount: '2997.00', discount_amount: '0.00', coupon_months: 0, provider: 'paymongo', status: 'pending', coupon_redemption_id: null,
  });
});

test('a percent coupon takes its discount off the checkout, and is used up after its one month', async () => {
  const { user } = await newWorkspace();
  await addCoupon('ALPHA50ONCE');
  const r = await billing.createCheckout(user, 'growth', 3, { couponCode: ' alpha50 once ' });
  assert.deepEqual(Object.keys(r).sort(), ['billing_id', 'checkout_url']);
  const a = calls.at(-1).body.data.attributes;
  assert.equal(a.line_items[0].amount, 249750);
  assert.equal(a.line_items[0].name, 'BalayHub Growth — 3 months (coupon ALPHA50ONCE)');
  assert.match(a.description, / · ₱2,997\.00 before coupon$/);
  assert.equal(a.metadata.coupon_code, 'ALPHA50ONCE');
  const row = await billingRow(r.billing_id);
  assert.deepEqual(
    { amount: row.amount, list_amount: row.list_amount, discount_amount: row.discount_amount, coupon_months: row.coupon_months },
    { amount: '2497.50', list_amount: '2997.00', discount_amount: '499.50', coupon_months: 1 });
  const [red] = await sql('SELECT status FROM platform_coupon_redemptions WHERE redemption_id = $1', [row.coupon_redemption_id]);
  assert.equal(red.status, 'pending');

  pay(await checkoutIdOf(r.billing_id), 249750);
  assert.equal(await billing.refresh(r.billing_id), 'paid');
  const [used] = await sql('SELECT status, months_total, months_used FROM platform_coupon_redemptions WHERE redemption_id = $1', [row.coupon_redemption_id]);
  assert.deepEqual(used, { status: 'used_up', months_total: 1, months_used: 1 });
  const [applied] = await sql(`SELECT details FROM audit_logs WHERE action = 'billing.coupon_applied' AND record_id = $1`, [r.billing_id]);
  assert.deepEqual(applied.details, { code: 'ALPHA50ONCE', list_amount: '2997.00', discount_amount: '499.50', covered_months: 1 });
});

test('a months coupon keeps discounting later checkouts with no code typed, until its months are used', async () => {
  const { user } = await newWorkspace();
  await addCoupon('THREEMO', { duration: 'months', duration_months: 3 });
  const first = await billing.createCheckout(user, 'growth', 1, { couponCode: 'THREEMO' });
  pay(await checkoutIdOf(first.billing_id), 49950);
  assert.equal(await billing.refresh(first.billing_id), 'paid');
  // The first month has run out. A paid month after the 14-day trial lands about 45 days ahead, right at the limit that
  // refuses discounted checkouts, so the workspace is set to today to keep this test about the months coupon only.
  await sql('UPDATE organizations SET paid_until = $2 WHERE organization_id = $1', [user.organization_id, manilaDay(0)]);

  const second = await billing.createCheckout(user, 'growth', 1, {});
  assert.equal(calls.at(-1).body.data.attributes.line_items[0].amount, 49950);
  const row = await billingRow(second.billing_id);
  assert.deepEqual({ discount_amount: row.discount_amount, coupon_months: row.coupon_months }, { discount_amount: '499.50', coupon_months: 1 });
});

test('a free coupon activates the plan with no PayMongo call, and the paid period starts when the trial ends', async () => {
  const { user } = await newWorkspace();
  const coupon = await addCoupon('FREEMONTH', { kind: 'free', percent_off: null, duration: 'once' });
  const [org] = await sql('SELECT plan, trial_ends_at FROM organizations WHERE organization_id = $1', [user.organization_id]);
  assert.equal(org.plan, 'trial');
  const trialStart = new Date(new Date(org.trial_ends_at).getTime() + 8 * 3600e3).toISOString().slice(0, 10);

  const before = calls.length;
  const r = await billing.createCheckout(user, 'growth', 1, { couponCode: 'FREEMONTH' });
  assert.equal(calls.length, before, 'no PayMongo call');
  assert.equal(r.activated, true);
  assert.equal(r.plan, 'growth');
  assert.equal(r.paid_until, billing.periodEnd(trialStart, 1));
  assert.equal(r.checkout_url, undefined);

  const row = await billingRow(r.billing_id);
  assert.deepEqual({ provider: row.provider, amount: row.amount, status: row.status }, { provider: 'coupon', amount: '0.00', status: 'paid' });
  const [after] = await sql('SELECT plan FROM organizations WHERE organization_id = $1', [user.organization_id]);
  assert.equal(after.plan, 'growth');
  const [red] = await sql('SELECT status FROM platform_coupon_redemptions WHERE coupon_id = $1', [coupon.coupon_id]);
  assert.equal(red.status, 'used_up');
});

test('a free coupon that requires a card still charges the minimum, by card only', async () => {
  const { user } = await newWorkspace();
  await addCoupon('CARDFREE', { kind: 'free', percent_off: null, duration: 'forever', require_card: true });
  const r = await billing.createCheckout(user, 'growth', 1, { couponCode: 'CARDFREE' });
  const a = calls.at(-1).body.data.attributes;
  assert.equal(a.line_items[0].amount, 2000);
  assert.deepEqual(a.payment_method_types, ['card']);
  const row = await billingRow(r.billing_id);
  assert.deepEqual({ amount: row.amount, discount_amount: row.discount_amount, provider: row.provider }, { amount: '20.00', discount_amount: '979.00', provider: 'paymongo' });
});

test('a card-only coupon is refused while card payments are off', async () => {
  const { user } = await newWorkspace();
  await addCoupon('CARDONLY', { percent_off: 10, require_card: true });
  const saved = config.paymongoMethods;
  config.paymongoMethods = ['gcash'];
  try {
    await assert.rejects(
      billing.createCheckout(user, 'growth', 1, { couponCode: 'CARDONLY' }),
      (err) => err.status === 409 && err.extra.code === 'CARD_OFF' && /card payments are off/.test(err.message));
  } finally {
    config.paymongoMethods = saved;
  }
});

test('a checkout PayMongo refuses frees its redemption and its limit slot', async () => {
  const { user } = await newWorkspace();
  const limited = await addCoupon('ONESLOT', { percent_off: 20 });
  await sql('UPDATE platform_coupons SET max_redemptions = 1 WHERE coupon_id = $1', [limited.coupon_id]);
  failNextCreate = true;
  await assert.rejects(billing.createCheckout(user, 'growth', 1, { couponCode: 'ONESLOT' }), { status: 502 });
  const [b] = await sql('SELECT status FROM billing_payments WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1', [user.organization_id]);
  assert.equal(b.status, 'failed');
  const [red] = await sql('SELECT status FROM platform_coupon_redemptions WHERE organization_id = $1', [user.organization_id]);
  assert.equal(red.status, 'released');

  const other = await newWorkspace();
  const ok = await billing.createCheckout(other.user, 'growth', 1, { couponCode: 'ONESLOT' });
  assert.match(ok.checkout_url, /^https:\/\/checkout\.paymongo\.com\//);
});

test('an expired checkout releases its pending redemption on refresh', async () => {
  const { user } = await newWorkspace();
  await addCoupon('EXPIRES', { percent_off: 20 });
  const r = await billing.createCheckout(user, 'growth', 1, { couponCode: 'EXPIRES' });
  sessions.get(await checkoutIdOf(r.billing_id)).attributes.status = 'expired';
  assert.equal(await billing.refresh(r.billing_id), 'expired');
  const [red] = await sql('SELECT status FROM platform_coupon_redemptions WHERE organization_id = $1', [user.organization_id]);
  assert.equal(red.status, 'released');
});

test('reconcile releases a pending redemption that is older than two days', async () => {
  const { user } = await newWorkspace();
  const coupon = await addCoupon('STALE', { percent_off: 20 });
  await sql(
    `INSERT INTO platform_coupon_redemptions (coupon_id, organization_id, months_total, created_at)
     VALUES ($1, $2, 1, now() - interval '3 days')`, [coupon.coupon_id, user.organization_id]);
  await billing.reconcile();
  const [red] = await sql('SELECT status, released_at FROM platform_coupon_redemptions WHERE coupon_id = $1', [coupon.coupon_id]);
  assert.equal(red.status, 'released');
  assert.ok(red.released_at);
});

test('a PayMongo answer with no checkout link marks the checkout failed and frees its coupon slot', async () => {
  const { user } = await newWorkspace();
  const limited = await addCoupon('NOURL', { percent_off: 20 });
  await sql('UPDATE platform_coupons SET max_redemptions = 1 WHERE coupon_id = $1', [limited.coupon_id]);
  answerNoUrlNext = true;
  await assert.rejects(billing.createCheckout(user, 'growth', 1, { couponCode: 'NOURL' }), { status: 502 });
  const [b] = await sql('SELECT status FROM billing_payments WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1', [user.organization_id]);
  assert.equal(b.status, 'failed');
  const [red] = await sql('SELECT status FROM platform_coupon_redemptions WHERE organization_id = $1', [user.organization_id]);
  assert.equal(red.status, 'released');

  const other = await newWorkspace();
  const ok = await billing.createCheckout(other.user, 'growth', 1, { couponCode: 'NOURL' });
  assert.match(ok.checkout_url, /^https:\/\/checkout\.paymongo\.com\//);
});

test('a free checkout whose activation fails is marked failed and frees its coupon slot', async () => {
  const { user } = await newWorkspace();
  const free = await addCoupon('ACTIVATE', { kind: 'free', percent_off: null, duration: 'forever' });
  await sql('UPDATE platform_coupons SET max_redemptions = 1 WHERE coupon_id = $1', [free.coupon_id]);
  // Make the plan switch fail inside markPaid's transaction, then take the failure away again.
  await sql("CREATE FUNCTION fail_org_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'activation failed'; END $$");
  await sql('CREATE TRIGGER fail_org_update BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION fail_org_update()');
  try {
    await assert.rejects(billing.createCheckout(user, 'growth', 1, { couponCode: 'ACTIVATE' }), /activation failed/);
  } finally {
    await sql('DROP TRIGGER fail_org_update ON organizations');
    await sql('DROP FUNCTION fail_org_update()');
  }
  const [b] = await sql('SELECT status FROM billing_payments WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1', [user.organization_id]);
  assert.equal(b.status, 'failed');
  const [red] = await sql('SELECT status FROM platform_coupon_redemptions WHERE organization_id = $1', [user.organization_id]);
  assert.equal(red.status, 'released');

  const other = await newWorkspace();
  const ok = await billing.createCheckout(other.user, 'growth', 1, { couponCode: 'ACTIVATE' });
  assert.equal(ok.activated, true, 'the slot is free again, so the code activates for another workspace');
});

test('a discounted checkout gets COUPON_AHEAD while paid more than 45 days ahead; a full-price one is still allowed', async () => {
  const { user } = await newWorkspace();
  await addCoupon('FREEYEAR', { kind: 'free', percent_off: null, duration: 'months', duration_months: 12 });
  await addCoupon('FREEAGAIN', { kind: 'free', percent_off: null, duration: 'forever' });
  const first = await billing.createCheckout(user, 'starter', 12, { couponCode: 'FREEYEAR' });
  assert.equal(first.activated, true);

  await assert.rejects(
    billing.createCheckout(user, 'starter', 12, { couponCode: 'FREEAGAIN' }),
    (err) => err.status === 409 && err.extra.code === 'COUPON_AHEAD'
      && err.message === 'Your plan is already paid ahead. Your coupon applies at your next renewal.');
  const [n] = await sql(`SELECT COUNT(*)::int AS n FROM platform_coupon_redemptions r JOIN platform_coupons c USING (coupon_id) WHERE c.code = 'FREEAGAIN'`);
  assert.equal(n.n, 0, 'the refused checkout took no coupon slot');

  const full = await billing.createCheckout(user, 'starter', 1);
  assert.match(full.checkout_url, /^https:\/\/checkout\.paymongo\.com\//);
  assert.equal((await billingRow(full.billing_id)).discount_amount, '0.00');
});

test('couponAheadError refuses only a discounted quote when the workspace is paid more than 45 days ahead', () => {
  const discounted = { discountC: 49950 };
  assert.equal(billing.couponAheadError({ paid_until: null }, discounted), null, 'not paid ahead');
  assert.equal(billing.couponAheadError({ paid_until: manilaDay(45) }, discounted), null, 'exactly 45 days is allowed');
  assert.equal(billing.couponAheadError({ paid_until: manilaDay(400) }, { discountC: 0 }), null, 'full price is allowed');
  const err = billing.couponAheadError({ paid_until: manilaDay(46) }, discounted);
  assert.equal(err.status, 409);
  assert.equal(err.extra.code, 'COUPON_AHEAD');
});
