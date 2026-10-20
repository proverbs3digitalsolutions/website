'use strict';

// QA round 23, lane BILL23: a plan change converts remaining days by the share actually paid (amount / list_amount).
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_02 node --test --test-concurrency=1 test/qa-r23-billing.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* database.');

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const billing = require('../src/lib/billing');

const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
const addDays = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

let srv; let seq = 0;
test.before(async () => { srv = await startServer(); });
test.after(async () => { await srv.close(); });

// An org on `plan` paid until today+untilDays; rows are [amount, listAmount|null, startOffset, endOffset].
async function setup(plan, untilDays, rows) {
  const name = `R23 Bil ${++seq}`;
  await ownerAccount(srv.base, `r23-bil-${seq}@example.com`, name);
  const [{ organization_id: org }] = await sql('SELECT organization_id FROM organizations WHERE name = $1', [name]);
  await sql(`UPDATE organizations SET plan = $2, paid_until = $3, trial_ends_at = now() - interval '30 days' WHERE organization_id = $1`, [org, plan, day(untilDays)]);
  for (const [amount, list, s, e] of rows) {
    await sql(`INSERT INTO billing_payments (organization_id, plan, months, amount, list_amount, provider, status, period_start, period_end) VALUES ($1,$2,1,$3,$4,$7,'paid',$5,$6)`, [org, plan, amount, list, day(s), day(e), Number(amount) === 0 ? 'coupon' : 'paymongo']);
  }
  return org;
}
async function payPlan(org, plan, amount) {
  const [{ billing_id: id }] = await sql(`INSERT INTO billing_payments (organization_id, plan, months, amount) VALUES ($1,$2,1,$3) RETURNING billing_id`, [org, plan, amount]);
  assert.equal(await billing.markPaid(id), true);
  return (await sql('SELECT period_end::text FROM billing_payments WHERE billing_id = $1', [id]))[0].period_end;
}
const base = () => billing.periodEnd(day(0), 1);

test('convertDays accepts fractional paid-value days', () => {
  assert.equal(billing.convertDays({ paidDays: 182.5, freeDays: 182.5, oldPrice: 1799, newPrice: 499 }), Math.floor(182.5 * 1799 / 499) + Math.floor(182.5));
});

test('50% off Pro year then Starter: paid days count half', async () => {
  const org = await setup('pro', 364, [[10794, 21588, 0, 364]]); // 365 days left, half paid
  const end = await payPlan(org, 'starter', 499);
  const expected = Math.floor(182.5 * 1799 / 499) + Math.floor(182.5); // 658 + 182
  assert.equal(end, addDays(base(), expected));
  assert.ok(expected < Math.floor(365 * 1799 / 499));
});

test('full-price rows unchanged; null list_amount counts as fully paid', async () => {
  for (const list of [1799, null]) {
    const org = await setup('pro', 29, [[1799, list, 0, 29]]);
    assert.equal(await payPlan(org, 'starter', 499), addDays(base(), Math.floor(30 * 1799 / 499)));
  }
});

test('free rows (amount 0) unchanged: day for day', async () => {
  const org = await setup('pro', 29, [[0, 1799, 0, 29]]);
  assert.equal(await payPlan(org, 'starter', 499), addDays(base(), 30));
});

test('overlapping rows: the highest share covers the day', async () => {
  const org = await setup('pro', 29, [[899.5, 1799, 0, 29], [1799, 1799, 0, 29]]);
  assert.equal(await payPlan(org, 'starter', 499), addDays(base(), Math.floor(30 * 1799 / 499)));
});
