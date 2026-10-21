'use strict';

// QA round 15, atom B2 (D-94): platform plan coupons, src/lib/coupons.js.
// The pricing functions run with no database. The rest runs on this lane's own test database, which must be named:
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_18 node --test --test-concurrency=1 test/qa-r15-coupons-lib.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const c = require('../src/lib/coupons');
const config = require('../src/config');
const { pool, tx } = require('../src/db');
const { migrate } = require('../scripts/migrate');

// ---- pure pricing (no database) ----

const pct = (p, duration = 'months', n = 3) => ({ kind: 'percent', percent_off: p, duration, duration_months: duration === 'months' ? n : null });

test('normalizeCode trims, drops inner spaces and upper-cases; CODE_RE accepts letters, digits and dashes only', () => {
  assert.equal(c.normalizeCode('  alpha 50 '), 'ALPHA50');
  assert.ok(c.CODE_RE.test('ALPHA-50'));
  assert.ok(!c.CODE_RE.test('AB'));
  assert.ok(!c.CODE_RE.test('ALPHA_50'));
});

test('centavo maths uses integers only', () => {
  assert.equal(c.toCentavos('499.50'), 49950);
  assert.equal(c.toCentavos('1799'), 179900);
  assert.equal(c.toPesos(49950), '499.50');
  assert.equal(c.toPesos(0), '0.00');
});

test('percent takes its share of the covered months, and the 12-month price is respected', () => {
  // Growth for 12 months is 9,990 pesos. 3 of the 12 months at 50% off: 999000 * 3 * 50 / (12 * 100) = 124875.
  const r = c.priceWithCoupon({ listC: 999000, months: 12, covered: 3, coupon: pct(50) });
  assert.deepEqual([r.discountC, r.amountC], [124875, 874125]);
});

test('Pro for 12 months does not divide evenly and still rounds to whole centavos', () => {
  const r = c.priceWithCoupon({ listC: 1799000, months: 12, covered: 1, coupon: pct(10, 'once') });
  assert.equal(r.discountC, 14992);
  assert.equal(r.amountC, 1799000 - 14992);
});

test('fixed is per covered month and never more than that month costs', () => {
  const fixed = { kind: 'fixed', amount_off: '200.00', duration: 'months', duration_months: 2 };
  assert.equal(c.priceWithCoupon({ listC: 299700, months: 3, covered: 2, coupon: fixed }).discountC, 40000);
  const big = { kind: 'fixed', amount_off: '5000.00', duration: 'once' };
  assert.equal(c.priceWithCoupon({ listC: 99900, months: 1, covered: 1, coupon: big }).amountC, 0);
});

test('free with no card is 0 and needs no payment; with card required it keeps the minimum and is card only', () => {
  const free = { kind: 'free', duration: 'forever', require_card: false };
  const plain = c.priceWithCoupon({ listC: 99900, months: 1, covered: 1, coupon: free });
  assert.deepEqual([plain.amountC, plain.free, plain.cardOnly], [0, true, false]);
  const card = c.priceWithCoupon({ listC: 99900, months: 1, covered: 1, coupon: { ...free, require_card: true } });
  assert.deepEqual([card.amountC, card.free, card.cardOnly, card.minChargeApplied], [2000, false, true, true]);
});

test('a total between 0 and the minimum is raised to the minimum, and the discount shrinks to match', () => {
  const r = c.priceWithCoupon({ listC: 49900, months: 1, covered: 1, coupon: { kind: 'fixed', amount_off: '490.00', duration: 'once' } });
  assert.deepEqual([r.amountC, r.discountC, r.minChargeApplied], [2000, 47900, true]);
});

test('free covering 3 of 12 months charges the other 9', () => {
  const r = c.priceWithCoupon({ listC: 999000, months: 12, covered: 3, coupon: { kind: 'free', duration: 'months', duration_months: 3 } });
  assert.equal(r.amountC, 749250);
  assert.equal(r.free, false);
});

test('a checkout that no months are covered by gets the full price and is never card only', () => {
  const r = c.priceWithCoupon({ listC: 99900, months: 1, covered: 0, coupon: { kind: 'free', duration: 'once', require_card: true } });
  assert.deepEqual([r.amountC, r.discountC, r.cardOnly], [99900, 0, false]);
});

test('coveredMonths and couponState', () => {
  assert.equal(c.coveredMonths({ duration: 'forever' }, null, 12), 12);
  assert.equal(c.coveredMonths({ duration: 'months' }, 2, 3), 2);
  assert.equal(c.coveredMonths({ duration: 'once' }, 1, 12), 1);
  const now = new Date('2026-10-16T00:00:00Z');
  const row = { active: true, starts_at: new Date('2026-10-01'), ends_at: null, max_redemptions: 2 };
  assert.equal(c.couponState(row, 0, now), 'active');
  assert.equal(c.couponState(row, 2, now), 'full');
  assert.equal(c.couponState({ ...row, active: false }, 0, now), 'off');
  assert.equal(c.couponState({ ...row, starts_at: new Date('2026-11-01') }, 0, now), 'scheduled');
  assert.equal(c.couponState({ ...row, ends_at: new Date('2026-10-10') }, 0, now), 'ended');
});

test('describe says what the coupon does and for how long', () => {
  assert.equal(c.describe(pct(50)), '50% off your first 3 months.');
  assert.equal(c.describe({ kind: 'free', duration: 'once', duration_months: null }), 'Free for your first month.');
  assert.equal(c.describe({ kind: 'fixed', amount_off: '200.00', duration: 'forever', duration_months: null }), '₱200 off every month.');
});

// ---- database rules (the lane's own test database) ----

const sql = (text, params) => pool.query(text, params).then((r) => r.rows);
const DAY = 86400000;
const past = (days) => new Date(Date.now() - days * DAY);
const future = (days) => new Date(Date.now() + days * DAY);
const FREE = { kind: 'free', percent_off: null };
const ONCE = { duration: 'once', duration_months: null };
const FOREVER = { duration: 'forever', duration_months: null };
// Resolves to the error a promise rejects with, or null when it resolves.
const failure = (p) => p.then(() => null, (err) => err);

let orgSeq = 0;
let couponSeq = 0;

// A workspace on the given plan. Returns the shape resolve() reads.
async function makeOrg(plan = 'growth') {
  const [org] = await sql('INSERT INTO organizations (name, plan) VALUES ($1, $2) RETURNING organization_id, plan, is_demo',
    [`Workspace ${++orgSeq}`, plan]);
  return org;
}

// A platform coupon. Keys are table columns. The defaults are 50% off for 3 months.
async function makeCoupon(over = {}) {
  const row = {
    code: `T${String(++couponSeq).padStart(3, '0')}X`, name: 'Test coupon', kind: 'percent', percent_off: 50,
    duration: 'months', duration_months: 3, starts_at: past(1), ...over,
  };
  const cols = Object.keys(row);
  const [saved] = await sql(
    `INSERT INTO platform_coupons (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    Object.values(row));
  return saved;
}

// A redemption as a workspace's checkout leaves it. `over` sets status, months used and age.
async function makeRedemption(coupon, org, over = {}) {
  const months = coupon.duration === 'forever' ? null : coupon.duration === 'once' ? 1 : coupon.duration_months;
  const [r] = await sql(
    `INSERT INTO platform_coupon_redemptions (coupon_id, organization_id, months_total, status, months_used, created_at)
     VALUES ($1, $2, $3, $4, $5, now() - $6::interval) RETURNING *`,
    [coupon.coupon_id, org.organization_id, months, over.status || 'pending', over.months_used || 0, over.age || '0 days']);
  return r;
}

// A billing row as billing.js writes it for a coupon checkout (list and discount in pesos).
async function makeBilling(org, redemption, { coupon_months = 1, status = 'pending', created = '0 days' } = {}) {
  const [b] = await sql(
    `INSERT INTO billing_payments (organization_id, plan, months, amount, list_amount, discount_amount, status, provider,
                                   coupon_redemption_id, coupon_months, created_at)
     VALUES ($1, 'growth', 3, 2497.50, 2997.00, 499.50, $2, 'paymongo', $3, $4, now() - $5::interval) RETURNING *`,
    [org.organization_id, status, redemption.redemption_id, coupon_months, created]);
  return b;
}

const redemptionOf = async (id) => (await sql(
  'SELECT status, months_used, months_total, released_at FROM platform_coupon_redemptions WHERE redemption_id = $1', [id]))[0];

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
});
after(async () => { await pool.end(); });

test('an unusable code gets one answer, whatever the reason', async () => {
  const org = await makeOrg();
  const full = await makeCoupon({ code: 'FULL0001', max_redemptions: 1 });
  await makeRedemption(full, await makeOrg(), { status: 'active' });
  await makeCoupon({ code: 'OFF00001', active: false });
  await makeCoupon({ code: 'LATER001', starts_at: future(2) });
  await makeCoupon({ code: 'ENDED001', starts_at: past(2), ends_at: past(1) });
  const messages = [];
  for (const code of ['NOSUCH01', 'OFF00001', 'LATER001', 'ENDED001', 'FULL0001']) {
    const err = await failure(c.resolve(pool, { org, code, plan: 'growth', months: '1' }));
    assert.ok(err, code);
    assert.equal(err.status, 400, code);
    assert.equal(err.extra.code, 'COUPON_INVALID', code);
    messages.push(err.message);
  }
  assert.equal(new Set(messages).size, 1);
  assert.equal(messages[0], "This code isn't valid right now. Check it and try again.");
});

test('a code is found whatever its case or spacing, and a percent coupon discounts the covered month', async () => {
  await makeCoupon({ code: 'ALPHA50' });
  const r = await c.resolve(pool, { org: await makeOrg(), code: ' alpha50 ', plan: 'growth', months: '1' });
  assert.equal(r.coupon.code, 'ALPHA50');
  assert.equal(r.source, 'new');
  assert.equal(r.covered, 1);
  assert.equal(r.amountC, 49950);
  assert.equal(r.message, 'This payment covers 1 of your 3 coupon months.');
});

test('a once coupon discounts only the first billed month of a 3-month purchase', async () => {
  await makeCoupon({ code: 'FIRST001', ...ONCE });
  const r = await c.resolve(pool, { org: await makeOrg(), code: 'FIRST001', plan: 'growth', months: '3' });
  assert.equal(r.listC, 299700);
  assert.equal(r.discountC, 49950);
  assert.equal(r.amountC, 249750);
  assert.equal(r.message, '50% off your first month.');
});

test('once per workspace: a used-up code is refused, unless the coupon allows repeats', async () => {
  const org = await makeOrg();
  const once = await makeCoupon({ code: 'ONCE0001', ...ONCE });
  await makeRedemption(once, org, { status: 'used_up', months_used: 1 });
  const err = await failure(c.resolve(pool, { org, code: 'ONCE0001', plan: 'growth', months: '1' }));
  assert.equal(err.status, 409);
  assert.equal(err.extra.code, 'COUPON_USED');
  assert.equal(err.message, 'Your workspace has already used this code.');
  const again = await makeCoupon({ code: 'REPEAT01', once_per_workspace: false, ...ONCE });
  await makeRedemption(again, org, { status: 'used_up', months_used: 1 });
  const r = await c.resolve(pool, { org, code: 'REPEAT01', plan: 'growth', months: '1' });
  assert.equal(r.source, 'new');
  assert.equal(r.covered, 1);
});

test('a used-up coupon with no code gives the full price and says why', async () => {
  const org = await makeOrg();
  const coupon = await makeCoupon({ code: 'USED3MO1' });
  await makeRedemption(coupon, org, { status: 'used_up', months_used: 3 });
  const r = await c.resolve(pool, { org, plan: 'growth', months: '1' });
  assert.equal(r.coupon, null);
  assert.equal(r.covered, 0);
  assert.equal(r.amountC, 99900);
  assert.equal(r.message, "Your coupon's 3 months are used. This payment is the full price.");
});

test('a live coupon applies with no code, and months that open checkouts have claimed are not counted again', async () => {
  const org = await makeOrg();
  const coupon = await makeCoupon({ code: 'OPEN0001' });
  const red = await makeRedemption(coupon, org, { status: 'active', months_used: 1 });
  await makeBilling(org, red, { coupon_months: 1, status: 'pending' });
  const r = await c.resolve(pool, { org, plan: 'growth', months: '1' });
  assert.equal(r.source, 'redeemed');
  assert.equal(r.monthsLeft, 1);
  assert.equal(r.covered, 1);
  assert.equal(r.message, 'This payment covers 1 of your 3 coupon months.');
});

test('the months counter counts up to the limit, ends as used_up, and writes one audit row per paid checkout', async () => {
  const org = await makeOrg();
  const coupon = await makeCoupon({ code: 'COUNT001' });
  const red = await makeRedemption(coupon, org);
  const first = await makeBilling(org, red, { coupon_months: 2, status: 'paid' });
  await tx((db) => c.applyPaid(db, first));
  assert.deepEqual(await redemptionOf(red.redemption_id), { status: 'active', months_used: 2, months_total: 3, released_at: null });
  const second = await makeBilling(org, red, { coupon_months: 2, status: 'paid' });
  await tx((db) => c.applyPaid(db, second));
  assert.deepEqual(await redemptionOf(red.redemption_id), { status: 'used_up', months_used: 3, months_total: 3, released_at: null });
  const audits = await sql(`SELECT details FROM audit_logs WHERE organization_id = $1 AND action = 'billing.coupon_applied'`, [org.organization_id]);
  assert.equal(audits.length, 2);
  assert.equal(audits[0].details.code, 'COUNT001');
  assert.equal(audits[0].details.covered_months, 2);
});

test('a forever coupon covers every month and never runs out', async () => {
  const org = await makeOrg();
  const coupon = await makeCoupon({ code: 'FOREVER1', ...FOREVER, percent_off: 10 });
  const red = await makeRedemption(coupon, org, { status: 'active' });
  const first = await makeBilling(org, red, { coupon_months: 12, status: 'paid' });
  await tx((db) => c.applyPaid(db, first));
  const second = await makeBilling(org, red, { coupon_months: 12, status: 'paid' });
  await tx((db) => c.applyPaid(db, second));
  assert.deepEqual(await redemptionOf(red.redemption_id), { status: 'active', months_used: 24, months_total: null, released_at: null });
  const r = await c.resolve(pool, { org, plan: 'growth', months: '12' });
  assert.equal(r.monthsLeft, null);
  assert.equal(r.covered, 12);
});

test('a code for other plans is refused by name, and a live coupon that does not cover the plan gives the full price', async () => {
  const org = await makeOrg();
  await makeCoupon({ code: 'PROONLY1', plans: ['pro'] });
  const err = await failure(c.resolve(pool, { org, code: 'PROONLY1', plan: 'growth', months: '1' }));
  assert.equal(err.status, 409);
  assert.equal(err.extra.code, 'COUPON_PLAN');
  assert.equal(err.message, 'This code is for Pro.');
  const live = await makeCoupon({ code: 'PROONLY2', plans: ['pro'] });
  await makeRedemption(live, org, { status: 'active' });
  const r = await c.resolve(pool, { org, plan: 'growth', months: '1' });
  assert.equal(r.covered, 0);
  assert.equal(r.amountC, 99900);
  assert.equal(r.message, 'Your coupon covers Pro, so this payment is the full price.');
});

test('a free coupon with no card needs no payment; with card required it keeps the minimum and is card only', async () => {
  const org = await makeOrg();
  await makeCoupon({ code: 'FREE0001', kind: 'free', ...FREE, ...FOREVER });
  const r = await c.resolve(pool, { org, code: 'FREE0001', plan: 'growth', months: '1' });
  assert.deepEqual([r.amountC, r.free, r.cardOnly], [0, true, false]);
  assert.equal(r.message, 'Free for every month.');
  await makeCoupon({ code: 'FREECARD', kind: 'free', ...FREE, ...FOREVER, require_card: true });
  const withCard = await c.resolve(pool, { org: await makeOrg(), code: 'FREECARD', plan: 'growth', months: '1' });
  assert.deepEqual([withCard.amountC, withCard.free, withCard.cardOnly, withCard.minChargeApplied], [2000, false, true, true]);
});

test('a card-only coupon is refused while card payments are off', async () => {
  await makeCoupon({ code: 'CARDOFF1', kind: 'free', ...FREE, ...FOREVER, require_card: true });
  const saved = config.paymongoMethods;
  config.paymongoMethods = ['gcash'];
  try {
    const err = await failure(c.resolve(pool, { org: await makeOrg(), code: 'CARDOFF1', plan: 'growth', months: '1' }));
    assert.equal(err.status, 409);
    assert.equal(err.extra.code, 'CARD_OFF');
  } finally {
    config.paymongoMethods = saved;
  }
});

test('the limit: workspaces reserving the last slot at once, exactly one gets it', async () => {
  // Eight at once, not two: with only two, the first transaction often commits before the second one counts, so the test
  // would pass with the row lock removed too. Eight overlap reliably.
  const coupon = await makeCoupon({ code: 'RACE0001', max_redemptions: 1 });
  const orgs = await Promise.all(Array.from({ length: 8 }, () => makeOrg()));
  const results = await Promise.allSettled(orgs.map((org) => tx((db) => c.reserve(db, { org, userId: null, coupon, redemption: null }))));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  for (const lost of results.filter((r) => r.status === 'rejected')) {
    assert.equal(lost.reason.status, 400);
    assert.equal(lost.reason.extra.code, 'COUPON_INVALID');
  }
  assert.equal(await c.usedCount(pool, coupon.coupon_id), 1);
});

test('a pending reservation older than two days does not hold a slot', async () => {
  const coupon = await makeCoupon({ code: 'STALE001', max_redemptions: 1 });
  await makeRedemption(coupon, await makeOrg(), { status: 'pending', age: '3 days' });
  assert.equal(await c.usedCount(pool, coupon.coupon_id), 0);
  const org = await makeOrg();
  const id = await tx((db) => c.reserve(db, { org, userId: null, coupon, redemption: null }));
  assert.match(id, /^[0-9a-f-]{36}$/);
});

test('release gives back a reservation that no payment is using, and keeps one that is', async () => {
  const coupon = await makeCoupon({ code: 'RELEASE1' });
  const orgs = [await makeOrg(), await makeOrg(), await makeOrg()];
  const [expired, open, paid] = await Promise.all(orgs.map((org) => makeRedemption(coupon, org)));
  await makeBilling(orgs[0], expired, { status: 'expired' });
  await makeBilling(orgs[1], open, { status: 'pending' });
  await makeBilling(orgs[2], paid, { status: 'paid' });
  for (const red of [expired, open, paid]) await c.releaseIfUnused(pool, red.redemption_id);
  const released = await redemptionOf(expired.redemption_id);
  assert.equal(released.status, 'released');
  assert.ok(released.released_at);
  assert.equal((await redemptionOf(open.redemption_id)).status, 'pending');
  assert.equal((await redemptionOf(paid.redemption_id)).status, 'pending');
});

test('a payment that lands after its redemption was released does not revive it, and nothing throws', async () => {
  // The checkout expired and the reservation was released. The workspace then started a new redemption of the same coupon,
  // which the live-slot index allows. Reviving the old row would collide with it and roll back markPaid.
  const coupon = await makeCoupon({ code: 'LATEPAY1' });
  const org = await makeOrg();
  const old = await makeRedemption(coupon, org, { status: 'pending' });
  const late = await makeBilling(org, old, { coupon_months: 1, status: 'expired' });
  await c.releaseIfUnused(pool, old.redemption_id);
  assert.equal((await redemptionOf(old.redemption_id)).status, 'released');
  await sql(`UPDATE billing_payments SET status = 'paid' WHERE billing_id = $1`, [late.billing_id]); // what markPaid does
  const current = await makeRedemption(coupon, org, { status: 'pending' });
  await tx((db) => c.applyPaid(db, late));
  const revived = await redemptionOf(old.redemption_id);
  assert.equal(revived.status, 'released');
  assert.equal(revived.months_used, 0);
  assert.equal((await redemptionOf(current.redemption_id)).status, 'pending');
  const audits = await sql(`SELECT 1 FROM audit_logs WHERE organization_id = $1 AND action = 'billing.coupon_applied'`, [org.organization_id]);
  assert.equal(audits.length, 0);
});

test('demo and complimentary workspaces cannot use coupons', async () => {
  await makeCoupon({ code: 'DEMO0001' });
  const [demo] = await sql('INSERT INTO organizations (name, is_demo) VALUES ($1, true) RETURNING organization_id, plan, is_demo', ['Demo']);
  const demoErr = await failure(c.resolve(pool, { org: demo, code: 'DEMO0001', plan: 'growth', months: '1' }));
  assert.equal(demoErr.extra.code, 'COMPED');
  assert.equal(demoErr.message, "The demo workspace can't use coupons.");
  const comped = await failure(c.resolve(pool, { org: await makeOrg('comped'), plan: 'growth', months: '1' }));
  assert.equal(comped.extra.code, 'COMPED');
});
