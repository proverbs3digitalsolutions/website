'use strict';

// R27 COPY27: a pay request refused because another payment is open says "payment received" when a plan payment was just marked paid.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_27_copy node --test --test-concurrency=1 test/qa-r27-billing-copy.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* or r2_27_* database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const { install, TEST_CARDS } = require('./fakes/paymongo');

let srv; let fake; let c; let orgId;
const SENTENCE = 'That payment was just received. Check your plan before paying again.';
const card = { card_number: TEST_CARDS.ok, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' };

test.before(async () => {
  fake = install({ realFetch: globalThis.fetch });
  srv = await startServer();
  c = await ownerAccount(srv.base, 'r27-copy@example.com', 'R27 Copy');
  orgId = (await sql('SELECT organization_id FROM organizations WHERE name = $1', ['R27 Copy']))[0].organization_id;
  await sql(`UPDATE organizations SET card_check = 'passed', card_checked_at = now(), trial_ends_at = now() + interval '14 days' WHERE organization_id = $1`, [orgId]);
});
test.after(async () => { fake.uninstall(); await srv.close(); });
test.beforeEach(async () => {
  await sql(`DELETE FROM billing_payments WHERE organization_id = $1`, [orgId]);
  await sql(`UPDATE organizations SET plan = 'trial', paid_until = NULL, card_payment_method_id = $2, card_brand = 'visa', card_last4 = '4345' WHERE organization_id = $1`,
    [orgId, fake.createPaymentMethod(card)]);
});
const insert = (status, provider, paidAgoMin) => sql(
  `INSERT INTO billing_payments (organization_id, plan, months, amount, list_amount, discount_amount, provider, status, kind, created_at, paid_at)
   VALUES ($1, 'growth', 1, $4::numeric, 999, 999 - $4::numeric, $2, $3, 'plan', now(), ${paidAgoMin === null ? 'NULL' : `now() - interval '${paidAgoMin} minutes'`})`, [orgId, provider, status, status === 'paid' ? 499 : 0]);
const pay = () => c.post('/api/billing/pay-saved', { plan: 'growth', months: '1', seen_paid_until: null });

test('refused because another is open, but a plan payment was paid a moment ago: PAYMENT_RECEIVED with the received sentence', async () => {
  await insert('pending', 'coupon', null);
  await insert('paid', 'paymongo_intent', 0);
  const r = await pay();
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'PAYMENT_RECEIVED');
  assert.equal(r.data.error ?? r.data.message, SENTENCE);
});

test('same refusal, nothing paid recently: still PAYMENT_IN_PROGRESS', async () => {
  await insert('pending', 'coupon', null);
  await insert('paid', 'paymongo_intent', 10);
  const r = await pay();
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'PAYMENT_IN_PROGRESS');
});
