'use strict';

// QA round 22, lane BILLING (CARD-2): free days (coupon or trial) never grow on a plan change; paid days still convert.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_02 node --test --test-concurrency=1 test/qa-r22-billing.test.js

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

// An org on `plan` paid until today+untilDays; `rows` are earlier paid plan rows [amount, startOffset, endOffset].
async function setup(plan, untilDays, rows = []) {
  const name = `R22 Bil ${++seq}`;
  await ownerAccount(srv.base, `r22-bil-${seq}@example.com`, name);
  const [{ organization_id: org }] = await sql('SELECT organization_id FROM organizations WHERE name = $1', [name]);
  await sql(`UPDATE organizations SET plan = $2, paid_until = $3, trial_ends_at = now() - interval '30 days' WHERE organization_id = $1`, [org, plan, day(untilDays)]);
  for (const [amount, s, e] of rows) {
    await sql(`INSERT INTO billing_payments (organization_id, plan, months, amount, status, period_start, period_end) VALUES ($1,$2,1,$3,'paid',$4,$5)`, [org, plan, amount, day(s), day(e)]);
  }
  return org;
}
async function payPlan(org, plan, amount) {
  const [{ billing_id: id }] = await sql(`INSERT INTO billing_payments (organization_id, plan, months, amount) VALUES ($1,$2,1,$3) RETURNING billing_id`, [org, plan, amount]);
  assert.equal(await billing.markPaid(id), true);
  return (await sql('SELECT period_start::text, period_end::text FROM billing_payments WHERE billing_id = $1', [id]))[0];
}

test('convertDays: paid days at the ratio, free days never grow', () => {
  const f = (paidDays, freeDays, oldPrice, newPrice) => billing.convertDays({ paidDays, freeDays, oldPrice, newPrice });
  assert.equal(f(30, 0, 999, 499), 60); // paid, cheaper plan: ratio as before
  assert.equal(f(30, 0, 499, 999), 14); // paid, dearer plan
  assert.equal(f(0, 44, 999, 499), 44); // free to cheaper: day for day
  assert.equal(f(0, 44, 499, 999), 21); // free to dearer: shrinks
  assert.equal(f(10, 44, 999, 499), 20 + 44); // mixed
});

test('card-c: a free coupon month then Starter: free days do not double', async () => {
  const org = await setup('growth', 44); // 45 days left counting today, no money paid
  const p = await payPlan(org, 'starter', 499);
  assert.equal(p.period_start, day(0));
  assert.equal(p.period_end, addDays(billing.periodEnd(day(0), 1), 45), 'free days carry over day for day');
});

test('a paid Growth period switched to Starter still converts at the ratio', async () => {
  const org = await setup('growth', 29, [[999, 0, 29]]); // 30 paid days left
  const p = await payPlan(org, 'starter', 499);
  assert.equal(p.period_end, addDays(billing.periodEnd(day(0), 1), 60));
});

test('mixed: paid days convert, the free days after them do not grow; a card check never counts', async () => {
  const org = await setup('growth', 39, [[999, 0, 9]]); // 10 paid days, then 30 free
  await sql(`INSERT INTO billing_payments (organization_id, amount, status, kind, provider, period_start, period_end) VALUES ($1,20,'paid','card_check','paymongo_intent',$2,$3)`, [org, day(10), day(39)]);
  const p = await payPlan(org, 'starter', 499);
  assert.equal(p.period_end, addDays(billing.periodEnd(day(0), 1), 20 + 30));
});

test('period_end is inclusive: a period covers both its first and last day', () => {
  assert.equal(billing.periodEnd('2026-10-20', 1), '2026-11-19');
});
