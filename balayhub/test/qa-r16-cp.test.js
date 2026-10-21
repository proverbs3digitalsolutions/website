'use strict';

// QA round 16, lane CP (finding #16, decision O10): a free platform coupon that needs a card still charges the ₱20
// minimum, and its message says so ("You pay ₱20.00 once by card."). src/lib/coupons.js, resolve().
// Runs on this lane's own test database, which must be named:
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_23 node --test --test-concurrency=1 test/qa-r16-cp.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const c = require('../src/lib/coupons');
const config = require('../src/config');
const { pool } = require('../src/db');
const { migrate } = require('../scripts/migrate');

const sql = (text, params) => pool.query(text, params).then((r) => r.rows);
const past = (days) => new Date(Date.now() - days * 86400000);

let orgSeq = 0;
let savedMethods;

// A workspace on the given plan. resolve() reads organization_id, plan and is_demo.
async function makeOrg(plan = 'growth') {
  const [org] = await sql('INSERT INTO organizations (name, plan) VALUES ($1, $2) RETURNING organization_id, plan, is_demo',
    [`CP Workspace ${++orgSeq}`, plan]);
  return org;
}

// A live platform coupon that started yesterday. Keys are table columns.
async function makeCoupon(over) {
  const row = { name: 'CP coupon', starts_at: past(1), require_card: false, ...over };
  const cols = Object.keys(row);
  await sql(
    `INSERT INTO platform_coupons (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(row));
  return row.code;
}

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
  // The card method must be on for a card-only coupon to resolve; the CARD_OFF path is covered by qa-r15-coupons-lib.
  savedMethods = config.paymongoMethods;
  config.paymongoMethods = ['gcash', 'paymaya', 'card', 'grab_pay'];
});
after(async () => {
  config.paymongoMethods = savedMethods;
  await pool.end();
});

test('a free once coupon that needs a card says the ₱20.00 card charge, and charges the minimum', async () => {
  const code = 'CPONCE1';
  await makeCoupon({ code, kind: 'free', percent_off: null, duration: 'once', duration_months: null, require_card: true });
  const r = await c.resolve(pool, { org: await makeOrg(), code, plan: 'growth', months: '1' });
  assert.deepEqual([r.amountC, r.free, r.cardOnly, r.minChargeApplied], [2000, false, true, true]);
  assert.equal(r.message, 'Free for your first month. You pay ₱20.00 once by card.');
});

test('a free 3-month coupon that needs a card names the covered months first, then the ₱20.00 card charge', async () => {
  const code = 'CP3MO001';
  await makeCoupon({ code, kind: 'free', percent_off: null, duration: 'months', duration_months: 3, require_card: true });
  const r = await c.resolve(pool, { org: await makeOrg(), code, plan: 'growth', months: '3' });
  assert.equal(r.covered, 3);
  assert.equal(r.amountC, 2000);
  assert.equal(r.message, 'This payment covers 3 of your 3 coupon months. You pay ₱20.00 once by card.');
});

test('a free forever coupon that needs a card says the card charge after "every month"', async () => {
  const code = 'CPFOREV1';
  await makeCoupon({ code, kind: 'free', percent_off: null, duration: 'forever', duration_months: null, require_card: true });
  const r = await c.resolve(pool, { org: await makeOrg(), code, plan: 'growth', months: '1' });
  assert.equal(r.message, 'Free for every month. You pay ₱20.00 once by card.');
});

test('a free coupon with no card requirement keeps its message, with no card sentence', async () => {
  const code = 'CPFREE01';
  await makeCoupon({ code, kind: 'free', percent_off: null, duration: 'once', duration_months: null, require_card: false });
  const r = await c.resolve(pool, { org: await makeOrg(), code, plan: 'growth', months: '1' });
  assert.deepEqual([r.amountC, r.free], [0, true]);
  assert.equal(r.message, 'Free for your first month.');
});

test('a free 3-month card coupon on a 12-month purchase that stays above the minimum has no card sentence', async () => {
  // Growth for 12 months is 9,990 pesos. Three covered months leave 7,492.50 to pay, so the ₱20 floor never applies.
  const code = 'CP3OF12A';
  await makeCoupon({ code, kind: 'free', percent_off: null, duration: 'months', duration_months: 3, require_card: true });
  const r = await c.resolve(pool, { org: await makeOrg(), code, plan: 'growth', months: '12' });
  assert.equal(r.amountC, 749250);
  assert.equal(r.minChargeApplied, false);
  assert.equal(r.message, 'This payment covers 3 of your 3 coupon months.');
});

test('a percent coupon raised to the minimum keeps its message; only free coupons name the card charge', async () => {
  const code = 'CPPCT99A';
  await makeCoupon({ code, kind: 'percent', percent_off: 99, duration: 'once', duration_months: null, require_card: true });
  const r = await c.resolve(pool, { org: await makeOrg(), code, plan: 'growth', months: '1' });
  assert.equal(r.minChargeApplied, true);
  assert.equal(r.message, '99% off your first month.');
});
