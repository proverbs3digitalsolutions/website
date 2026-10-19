'use strict';

// Card on file, lane B3: one-tap pay with the saved card (Stage 1).
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_23 node --test --test-concurrency=1 test/qa-r17-cardcheck-savedcard.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const { install, TEST_CARDS } = require('./fakes/paymongo');
const billing = require('../src/lib/billing');

let srv; let fake; let c; let orgId;
const card = (number) => ({ card_number: number, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });
const pm = (number) => fake.createPaymentMethod(card(number));
const org = async () => (await sql('SELECT * FROM organizations WHERE organization_id = $1', [orgId]))[0];
const intents = () => fake.calls.filter((x) => x.method === 'POST' && x.path === '/payment_intents');
const saveCard = (number) => sql('UPDATE organizations SET card_payment_method_id = $2, card_brand = $3, card_last4 = $4 WHERE organization_id = $1', [orgId, pm(number), 'visa', '4345']);
const resetPlan = () => sql(`DELETE FROM billing_payments WHERE kind = 'plan' AND organization_id = $1`, [orgId])
  .then(() => sql(`UPDATE organizations SET plan = 'trial', paid_until = NULL WHERE organization_id = $1`, [orgId]));

async function addCoupon(code, fields = {}) {
  const f = { kind: 'percent', percent_off: 50, duration: 'months', duration_months: 3, ...fields };
  const [row] = await sql(
    `INSERT INTO platform_coupons (code, name, kind, percent_off, duration, duration_months, require_card, active, starts_at)
     VALUES ($1, 'Test coupon', $2, $3, $4, $5, false, true, now() - interval '1 day') RETURNING *`,
    [code, f.kind, f.kind === 'percent' ? f.percent_off : null, f.duration, f.duration_months]);
  return row;
}

test.before(async () => {
  fake = install({ realFetch: globalThis.fetch });
  srv = await startServer();
  c = await ownerAccount(srv.base, 'cc-saved@example.com', 'Saved Stays');
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Saved Stays'`))[0].organization_id;
  const id = (await c.post('/api/billing/card-check/start', { renewal_plan: 'growth' })).data.billing_id;
  const r = await c.post(`/api/billing/card-check/${id}/attach`, { payment_method_id: pm(TEST_CARDS.ok) });
  assert.equal(r.data.status, 'passed');
});
test.after(async () => { fake.uninstall(); await srv.close(); });

test('no saved card: 409 SAVED_CARD_NONE and no intent', async () => {
  await sql('UPDATE organizations SET card_payment_method_id = NULL WHERE organization_id = $1', [orgId]);
  const before = intents().length;
  const r = await c.post('/api/billing/pay-saved', { plan: 'growth', months: '1' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'SAVED_CARD_NONE');
  assert.equal(intents().length, before);
});

test('pay Growth for 1 month with the saved card: paid, and paid_until is what a hosted checkout would give', async () => {
  await saveCard(TEST_CARDS.ok);
  const o = await org();
  const trialEndDay = new Date(new Date(o.trial_ends_at).getTime() + 8 * 3600e3).toISOString().slice(0, 10);
  const r = await c.post('/api/billing/pay-saved', { plan: 'growth', months: '1' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'paid');
  const expected = billing.periodEnd(trialEndDay, 1);
  assert.equal(String(r.data.paid_until).slice(0, 10), expected);
  const after = await org();
  assert.equal(after.plan, 'growth');
  assert.equal(String(after.paid_until).slice(0, 10), expected);
  const pi = intents().at(-1).body.data.attributes;
  assert.equal(pi.amount, 99900);
  assert.equal(pi.setup_future_usage, undefined);
  assert.equal(pi.metadata.kind, 'plan');
  const [b] = await sql(`SELECT * FROM billing_payments WHERE kind = 'plan' AND organization_id = $1`, [orgId]);
  assert.equal(b.provider, 'paymongo_intent');
  assert.equal(b.status, 'paid');
});

test('3-D Secure saved card: action_required, then /billing/:id/refresh says paid', async () => {
  await resetPlan();
  await saveCard(TEST_CARDS.threeDS);
  const r = await c.post('/api/billing/pay-saved', { plan: 'starter', months: '1' });
  assert.equal(r.data.status, 'action_required', JSON.stringify(r.data));
  assert.match(r.data.redirect_url, /^https:\/\//);
  assert.equal((await c.post(`/api/billing/${r.data.billing_id}/refresh`)).data.status, 'pending');
  const [{ payment_intent_id: pi }] = await sql('SELECT payment_intent_id FROM billing_payments WHERE billing_id = $1', [r.data.billing_id]);
  fake.markIntent(pi, 'succeeded');
  assert.equal((await c.post(`/api/billing/${r.data.billing_id}/refresh`)).data.status, 'paid');
  assert.equal((await org()).plan, 'starter');
});

test('a declined saved card is 402 SAVED_CARD_FAILED and the coupon slot is released', async () => {
  await resetPlan();
  await addCoupon('HALF50');
  await saveCard(TEST_CARDS.declined);
  const r = await c.post('/api/billing/pay-saved', { plan: 'growth', months: '1', coupon_code: 'HALF50' });
  assert.equal(r.status, 402, JSON.stringify(r.data));
  assert.equal(r.data.code, 'SAVED_CARD_FAILED');
  const [b] = await sql(`SELECT status FROM billing_payments WHERE kind = 'plan' AND organization_id = $1`, [orgId]);
  assert.equal(b.status, 'failed');
  assert.equal((await sql(`SELECT status FROM platform_coupon_redemptions WHERE organization_id = $1`, [orgId])).filter((x) => x.status !== 'released').length, 0);
});

test('a 50% coupon charges half in centavos; a free coupon activates with no intent', async () => {
  await resetPlan();
  await sql('DELETE FROM platform_coupon_redemptions WHERE organization_id = $1', [orgId]);
  await saveCard(TEST_CARDS.ok);
  const r = await c.post('/api/billing/pay-saved', { plan: 'growth', months: '1', coupon_code: 'HALF50' });
  assert.equal(r.data.status, 'paid', JSON.stringify(r.data));
  assert.equal(intents().at(-1).body.data.attributes.amount, 49950);
  await resetPlan();
  await sql('DELETE FROM platform_coupon_redemptions WHERE organization_id = $1', [orgId]);
  await addCoupon('FREE100', { kind: 'free' });
  const before = intents().length;
  const f = await c.post('/api/billing/pay-saved', { plan: 'growth', months: '1', coupon_code: 'FREE100' });
  assert.equal(f.status, 200, JSON.stringify(f.data));
  assert.equal(f.data.activated, true);
  assert.equal(intents().length, before);
});

test('COUPON_AHEAD still applies to a discounted one-tap payment', async () => {
  await resetPlan();
  await sql('DELETE FROM platform_coupon_redemptions WHERE organization_id = $1', [orgId]);
  await sql(`UPDATE organizations SET plan = 'growth', paid_until = current_date + 200 WHERE organization_id = $1`, [orgId]);
  const r = await c.post('/api/billing/pay-saved', { plan: 'growth', months: '1', coupon_code: 'HALF50' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'COUPON_AHEAD');
});

test('remove the card, then pay-saved is 409; turning automatic payment on with Stage 2 off is 409 SUBSCRIPTIONS_OFF', async () => {
  await resetPlan();
  assert.equal((await c.raw('DELETE', '/api/billing/card')).status, 200);
  const r = await c.post('/api/billing/pay-saved', { plan: 'growth', months: '1' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'SAVED_CARD_NONE');
  const on = await c.patch('/api/billing/renewal', { auto_renew: true, consent: true });
  assert.equal(on.status, 409);
  assert.equal(on.data.code, 'SUBSCRIPTIONS_OFF');
});
