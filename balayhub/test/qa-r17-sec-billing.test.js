'use strict';

// Card on file, security-review fixes (attach limiters, refresh limiters, redirect check, double pay-saved, admin exemption).
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_23 node --test --test-concurrency=1 test/qa-r17-sec-billing.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const { install, TEST_CARDS } = require('./fakes/paymongo');
const config = require('../src/config');
const cardcheck = require('../src/lib/cardcheck');

let srv; let fake; let A; let B; let orgB;
const card = (number) => ({ card_number: number, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });
const pm = (number) => fake.createPaymentMethod(card(number));
const intents = () => fake.calls.filter((x) => x.method === 'POST' && x.path === '/payment_intents');

test.before(async () => {
  fake = install({ realFetch: globalThis.fetch });
  srv = await startServer();
  A = await ownerAccount(srv.base, 'sec-a@example.com', 'Sec Stays A');
  B = await ownerAccount(srv.base, 'sec-b@example.com', 'Sec Stays B');
  orgB = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Sec Stays B'`))[0].organization_id;
});
test.after(async () => { fake.uninstall(); await srv.close(); });

test('the 21st attach in a day is 429 even when every attempt answered action_required', async () => {
  const id = (await A.post('/api/billing/card-check/start', { renewal_plan: 'growth' })).data.billing_id;
  const url = `/api/billing/card-check/${id}/attach`;
  for (let i = 1; i <= 20; i++) {
    const r = await A.post(url, { payment_method_id: pm(TEST_CARDS.threeDS) });
    assert.equal(r.status, 200, `attempt ${i}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.status, 'action_required');
  }
  const r = await A.post(url, { payment_method_id: pm(TEST_CARDS.threeDS) });
  assert.equal(r.status, 429);
  assert.equal(r.data.code, 'RATE_LIMITED');
});

test('refresh routes are rate limited per workspace (60 per 10 min), each route on its own key', async () => {
  const id = (await B.post('/api/billing/card-check/start', { renewal_plan: 'growth' })).data.billing_id;
  await sql("UPDATE organizations SET card_check = 'passed', card_checked_at = now(), trial_ends_at = now() + interval '14 days' WHERE organization_id = $1", [orgB]);
  for (let i = 1; i <= 60; i++) {
    const r = await B.post(`/api/billing/card-check/${id}/refresh`, {});
    assert.equal(r.status, 200, `refresh ${i}: ${JSON.stringify(r.data)}`);
  }
  assert.equal((await B.post(`/api/billing/card-check/${id}/refresh`, {})).status, 429);
  // the other route still has its own budget (404 for a row that is not in the workspace, not 429)
  const other = await B.post('/api/billing/00000000-0000-4000-8000-000000000000/refresh', {});
  assert.equal(other.status, 404);
  const [row] = await sql(`INSERT INTO billing_payments (organization_id, plan, months, amount, list_amount, discount_amount, provider)
    VALUES ($1,'growth',1,999,999,0,'paymongo_intent') RETURNING billing_id`, [orgB]);
  for (let i = 1; i <= 59; i++) {
    const r = await B.post(`/api/billing/${row.billing_id}/refresh`, {});
    assert.equal(r.status, 200, `plan refresh ${i}: ${JSON.stringify(r.data)}`);
  }
  assert.equal((await B.post(`/api/billing/${row.billing_id}/refresh`, {})).status, 429);
  await sql('DELETE FROM billing_payments WHERE billing_id = $1', [row.billing_id]);
});

test('pay-saved: a second call while a payment is pending is 409 and only one intent exists', async () => {
  const C = await ownerAccount(srv.base, 'sec-c@example.com', 'Sec Stays C');
  const orgC = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Sec Stays C'`))[0].organization_id;
  await sql(`UPDATE organizations SET card_check = 'passed', card_checked_at = now(), trial_ends_at = now() + interval '14 days', card_payment_method_id = $2, card_brand = $3, card_last4 = $4 WHERE organization_id = $1`,
    [orgC, pm(TEST_CARDS.threeDS), 'visa', '0007']);
  const before = intents().length;
  const first = await C.post('/api/billing/pay-saved', { plan: 'starter', months: '1' });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.status, 'action_required');
  const second = await C.post('/api/billing/pay-saved', { plan: 'starter', months: '1' });
  assert.equal(second.status, 409, JSON.stringify(second.data));
  assert.equal(second.data.code, 'PAYMENT_IN_PROGRESS');
  assert.equal(second.data.error ?? second.data.message, 'A payment is already in progress. Wait a minute, then check Plan & billing.');
  assert.equal(intents().length - before, 1);
  // an old pending row no longer blocks
  await sql(`UPDATE billing_payments SET created_at = now() - interval '16 minutes' WHERE organization_id = $1 AND kind = 'plan'`, [orgC]);
  assert.equal((await C.post('/api/billing/pay-saved', { plan: 'starter', months: '1' })).status, 200);
});

test('pay-saved: an unsafe redirect URL fails the checkout and releases the coupon slot', async () => {
  const D = await ownerAccount(srv.base, 'sec-d@example.com', 'Sec Stays D');
  const orgD = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Sec Stays D'`))[0].organization_id;
  const [cp] = await sql(`INSERT INTO platform_coupons (code, name, kind, percent_off, duration, duration_months, require_card, active, starts_at, max_redemptions)
    VALUES ('SECR17', 'Sec', 'percent', 50, 'months', 3, false, true, now() - interval '1 day', 1) RETURNING *`);
  fake.uninstall();
  fake = install({ realFetch: globalThis.fetch, threeDsBase: 'http://evil.example.com' });
  try {
    await sql(`UPDATE organizations SET card_check = 'passed', card_checked_at = now(), trial_ends_at = now() + interval '14 days', card_payment_method_id = $2, card_brand = $3, card_last4 = $4 WHERE organization_id = $1`,
      [orgD, pm(TEST_CARDS.threeDS), 'visa', '0007']);
    const r = await D.post('/api/billing/pay-saved', { plan: 'starter', months: '1', coupon_code: 'SECR17' });
    assert.equal(r.status, 402, JSON.stringify(r.data));
    assert.equal(r.data.code, 'SAVED_CARD_FAILED');
    assert.equal(JSON.stringify(r.data).includes('evil.example.com'), false);
    const [b] = await sql(`SELECT status FROM billing_payments WHERE organization_id = $1 AND kind = 'plan'`, [orgD]);
    assert.equal(b.status, 'failed');
    // The reserved slot exists and was released, so no live redemption blocks the code.
    const redemptions = await sql(`SELECT status FROM platform_coupon_redemptions WHERE organization_id = $1`, [orgD]);
    assert.deepEqual(redemptions.map((x) => x.status), ['released']);
  } finally {
    fake.uninstall();
    fake = install({ realFetch: globalThis.fetch });
    void cp;
  }
});

test('initialState: a platform admin is exempt only with a verified email', () => {
  config.platformAdmins.push('boss-sec@example.com');
  try {
    assert.equal(cardcheck.initialState({ email: 'Boss-Sec@Example.com', email_verified_at: null }), 'required');
    assert.equal(cardcheck.initialState({ email: 'Boss-Sec@Example.com' }), 'required');
    assert.equal(cardcheck.initialState({ email: 'Boss-Sec@Example.com', email_verified_at: new Date() }), null);
  } finally { config.platformAdmins.pop(); }
});
