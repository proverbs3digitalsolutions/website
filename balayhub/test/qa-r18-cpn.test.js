'use strict';

// QA round 18, fix lane CPN (money finding 1, and the limited-months offer carried from round 15): platform plan coupons, src/lib/coupons.js.
// Runs on this lane's own test database, which must be named:
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_08 node --test --test-concurrency=1 test/qa-r18-cpn.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* database.');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/lib/coupons');
const { pool } = require('../src/db');
const { migrate } = require('../scripts/migrate');

const sql = (text, params) => pool.query(text, params).then((r) => r.rows);
const DAY = 86400000;
const past = (days) => new Date(Date.now() - days * DAY);
// Resolves to the error a promise rejects with, or null when it resolves.
const failure = (p) => p.then(() => null, (err) => err);
const INVALID = "This code isn't valid right now. Check it and try again.";
const COMPED = "Your workspace is on a complimentary plan, so coupons don't apply.";

let orgSeq = 0;

// A workspace on the given plan. Returns the shape resolve() reads.
async function makeOrg(plan = 'growth') {
  const [org] = await sql('INSERT INTO organizations (name, plan) VALUES ($1, $2) RETURNING organization_id, plan, is_demo',
    [`CPN workspace ${++orgSeq}`, plan]);
  return org;
}

// A platform coupon. Keys are table columns and `code` is required. The defaults are 50% off for 3 months.
async function makeCoupon(over) {
  const row = { name: 'Test coupon', kind: 'percent', percent_off: 50, duration: 'months', duration_months: 3, starts_at: past(1), ...over };
  const cols = Object.keys(row);
  const [saved] = await sql(
    `INSERT INTO platform_coupons (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    Object.values(row));
  return saved;
}

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
});
after(async () => { await pool.end(); });

test('a comped workspace that sends an unknown or unusable code hears COUPON_INVALID, not COMPED', async () => {
  const org = await makeOrg('comped');
  await makeCoupon({ code: 'CMPOFF01', active: false });
  await makeCoupon({ code: 'CMPEND01', starts_at: past(2), ends_at: past(1) });
  for (const code of ['CMPNONE1', 'CMPOFF01', 'CMPEND01']) {
    const err = await failure(c.resolve(pool, { org, code, plan: 'growth', months: '1' }));
    assert.ok(err, code);
    assert.equal(err.status, 400, code);
    assert.equal(err.extra.code, 'COUPON_INVALID', code);
    assert.equal(err.message, INVALID, code);
  }
});

test('a comped workspace that sends a usable code, or no code, hears COMPED', async () => {
  const org = await makeOrg('comped');
  await makeCoupon({ code: 'CMPUSE01' });
  const withCode = await failure(c.resolve(pool, { org, code: 'CMPUSE01', plan: 'growth', months: '1' }));
  assert.equal(withCode.status, 409);
  assert.equal(withCode.extra.code, 'COMPED');
  assert.equal(withCode.message, COMPED);
  const noCode = await failure(c.resolve(pool, { org, plan: 'growth', months: '1' }));
  assert.equal(noCode.extra.code, 'COMPED');
});

test('a limited-months coupon says what this payment covers, and the under-total line does not repeat the offer', async () => {
  await makeCoupon({ code: 'LIMIT001' });
  const one = await c.resolve(pool, { org: await makeOrg(), code: 'LIMIT001', plan: 'growth', months: '1' });
  assert.equal(one.message, 'This payment covers 1 of your 3 coupon months.');
  const three = await c.resolve(pool, { org: await makeOrg(), code: 'LIMIT001', plan: 'growth', months: '3' });
  assert.equal(three.message, 'This payment covers 3 of your 3 coupon months.');
  await makeCoupon({ code: 'LIMITCRD', kind: 'free', percent_off: null, require_card: true });
  const card = await c.resolve(pool, { org: await makeOrg(), code: 'LIMITCRD', plan: 'growth', months: '1' });
  assert.equal(card.message, 'This payment covers 1 of your 3 coupon months. You pay ₱20.00 once by card.');
});
