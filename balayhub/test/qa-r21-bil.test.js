'use strict';

// QA round 21, lane BIL: a payment intent PayMongo reports as 'canceled' (US spelling) counts as dead, like 'cancelled'.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_02 node --test --test-concurrency=1 test/qa-r21-bil.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const { install, TEST_CARDS } = require('./fakes/paymongo');

let srv; let fake; let c; let orgId;
const card = (number) => ({ card_number: number, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });

test.before(async () => {
  fake = install({ realFetch: globalThis.fetch });
  srv = await startServer();
  c = await ownerAccount(srv.base, 'r21-bil-1@example.com', 'R21 Bil 1');
  orgId = (await sql('SELECT organization_id FROM organizations WHERE name = $1', ['R21 Bil 1']))[0].organization_id;
  await sql(`UPDATE organizations SET card_check = 'passed', card_checked_at = now(), trial_ends_at = now() + interval '14 days',
    plan = 'trial', paid_until = NULL, card_payment_method_id = $2, card_brand = 'visa', card_last4 = '0007' WHERE organization_id = $1`,
  [orgId, fake.createPaymentMethod(card(TEST_CARDS.threeDS))]);
});
test.after(async () => { fake.uninstall(); await srv.close(); });

test('an intent PayMongo shows as "canceled" is dead: the old row ends and Pay another way starts a checkout', async () => {
  assert.equal((await c.post('/api/billing/pay-saved', { plan: 'growth', months: '1' })).data.status, 'action_required');
  const [row] = await sql(`SELECT * FROM billing_payments WHERE organization_id = $1 AND kind = 'plan'`, [orgId]);
  fake.state.intents.get(row.payment_intent_id).status = 'canceled';
  const r = await c.post('/api/billing/checkout', { plan: 'growth', months: '1' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const all = await sql(`SELECT status FROM billing_payments WHERE organization_id = $1 AND kind = 'plan' ORDER BY created_at`, [orgId]);
  assert.notEqual(all[0].status, 'pending');
});
