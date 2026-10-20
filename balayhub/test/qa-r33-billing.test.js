'use strict';

// R33 BIL-L: a free activation (a paid 0-peso coupon row) is not a payment received, so a refusal because a real charge is waiting at the bank must say "in progress".
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_33_billing node --test --test-concurrency=1 test/qa-r33-billing.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* or r2_33_* database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const { install, TEST_CARDS } = require('./fakes/paymongo');

let srv; let fake; let c; let orgId;
const card = { card_number: TEST_CARDS.ok, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' };

test.before(async () => {
  fake = install({ realFetch: globalThis.fetch });
  srv = await startServer();
  c = await ownerAccount(srv.base, 'r33-bil@example.com', 'R33 Bil');
  orgId = (await sql('SELECT organization_id FROM organizations WHERE name = $1', ['R33 Bil']))[0].organization_id;
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
   VALUES ($1, 'growth', 1, $4::numeric, 999, 999 - $4::numeric, $2, $3, 'plan', now(), ${paidAgoMin === null ? 'NULL' : `now() - interval '${paidAgoMin} minutes'`})`, [orgId, provider, status, provider === 'coupon' ? 0 : 499]);
const pay = () => c.post('/api/billing/pay-saved', { plan: 'growth', months: '1', seen_paid_until: null });

test('a free activation just now plus a charge waiting at the bank: PAYMENT_IN_PROGRESS, not "received"', async () => {
  await insert('paid', 'coupon', 0);
  await insert('pending', 'paymongo_intent', null);
  const r = await pay();
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'PAYMENT_IN_PROGRESS');
  assert.match(r.data.error ?? r.data.message, /^A payment is already in progress\. Try again in /);
});

test('a real payment paid a moment ago plus a charge waiting: still PAYMENT_RECEIVED', async () => {
  await insert('paid', 'paymongo_intent', 0);
  await insert('pending', 'coupon', null);
  const r = await pay();
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'PAYMENT_RECEIVED');
});
