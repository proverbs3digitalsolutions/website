'use strict';

// R34 CARD-1: a workspace scheduled for deletion takes no plan payment, free coupon activation or card check start (C2).
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_34_deletepay node --test --test-concurrency=1 test/qa-r34-deletepay.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* or r2_34_* database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const { install, TEST_CARDS } = require('./fakes/paymongo');
const billing = require('../src/lib/billing');

const PAY_SENTENCE = 'This workspace is scheduled for deletion, so plan payments are turned off. Cancel the deletion first, then pay.';
const CARD_SENTENCE = 'This workspace is scheduled for deletion, so the card check is turned off. Cancel the deletion first.';
let srv; let fake; let c; let orgId; let userId;
const card = { card_number: TEST_CARDS.ok, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' };

test.before(async () => {
  fake = install({ realFetch: globalThis.fetch });
  srv = await startServer();
  c = await ownerAccount(srv.base, 'r34-del@example.com', 'R34 Del');
  const [o] = await sql('SELECT organization_id FROM organizations WHERE name = $1', ['R34 Del']);
  orgId = o.organization_id;
  userId = (await sql('SELECT user_id FROM users WHERE organization_id = $1 LIMIT 1', [orgId]))[0].user_id;
});
test.after(async () => { fake.uninstall(); await srv.close(); });
test.beforeEach(async () => {
  await sql('DELETE FROM billing_payments WHERE organization_id = $1', [orgId]);
  await sql(`UPDATE organizations SET plan = 'trial', paid_until = NULL, card_check = 'passed', card_checked_at = now(),
    trial_ends_at = now() + interval '14 days', deletion_scheduled_at = now() + interval '14 days',
    card_payment_method_id = $2, card_brand = 'visa', card_last4 = '4345' WHERE organization_id = $1`,
  [orgId, fake.createPaymentMethod(card)]);
});
const rows = async () => Number((await sql('SELECT count(*)::int AS n FROM billing_payments WHERE organization_id = $1', [orgId]))[0].n);
const body = { plan: 'growth', months: '1', seen_paid_until: null };
const refused = (r, sentence) => {
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'DELETION_SCHEDULED');
  assert.equal(r.data.error, sentence);
};

test('pay-saved is refused while a deletion is scheduled: no row, no PayMongo call', async () => {
  const calls = fake.calls.length; const n = await rows();
  refused(await c.post('/api/billing/pay-saved', body), PAY_SENTENCE);
  assert.equal(await rows(), n);
  assert.equal(fake.calls.length, calls);
});

test('checkout is refused the same way', async () => {
  const calls = fake.calls.length; const n = await rows();
  refused(await c.post('/api/billing/checkout', body), PAY_SENTENCE);
  assert.equal(await rows(), n);
  assert.equal(fake.calls.length, calls);
});

test('a free coupon activation is refused too: no redemption row', async () => {
  await sql(`INSERT INTO platform_coupons (code, name, kind, duration, active, starts_at)
    VALUES ('R34FREE', 'Free', 'free', 'once', true, now() - interval '1 day')`);
  const before = (await sql('SELECT count(*)::int AS n FROM platform_coupon_redemptions'))[0].n;
  refused(await c.post('/api/billing/checkout', { ...body, coupon_code: 'R34FREE' }), PAY_SENTENCE);
  assert.equal((await sql('SELECT count(*)::int AS n FROM platform_coupon_redemptions'))[0].n, before);
  assert.equal(await rows(), 0);
});

test('card-check/start is refused with the card sentence and no PayMongo call', async () => {
  await sql(`UPDATE organizations SET card_check = 'required' WHERE organization_id = $1`, [orgId]);
  const calls = fake.calls.length;
  refused(await c.post('/api/billing/card-check/start', { renewal_plan: 'growth', consent: true }), CARD_SENTENCE);
  assert.equal(fake.calls.length, calls);
});

test('under the lock: a stale user object still cannot start a charge', async () => {
  const user = { user_id: userId, organization_id: orgId, organization_name: 'R34 Del', deletion_scheduled_at: null };
  await assert.rejects(() => billing.paySaved(user, 'growth', 1, {}), (e) => e.extra.code === 'DELETION_SCHEDULED' && e.status === 409);
  assert.equal(await rows(), 0);
});

test('once the deletion is cancelled, pay-saved goes through as before', async () => {
  await sql('UPDATE organizations SET deletion_scheduled_at = NULL WHERE organization_id = $1', [orgId]);
  const r = await c.post('/api/billing/pay-saved', body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await rows(), 1);
});

test('eleven refused presses never hit a rate limit', async () => {
  for (let i = 0; i < 11; i++) refused(await c.post('/api/billing/pay-saved', body), PAY_SENTENCE);
});
