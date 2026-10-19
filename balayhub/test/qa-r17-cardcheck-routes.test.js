'use strict';

// Card on file, lane B3: the owner card-check routes and the PayMongo webhook.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_23 node --test --test-concurrency=1 test/qa-r17-cardcheck-routes.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const { install, TEST_CARDS } = require('./fakes/paymongo');

let srv; let fake; let A; let B;
const card = (number) => ({ card_number: number, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });
const pm = (number) => fake.createPaymentMethod(card(number));
const orgOf = async (name) => (await sql('SELECT * FROM organizations WHERE name = $1', [name]))[0];

test.before(async () => {
  fake = install({ realFetch: globalThis.fetch });
  srv = await startServer();
  A = await ownerAccount(srv.base, 'cc-a@example.com', 'CC Stays A');
  B = await ownerAccount(srv.base, 'cc-b@example.com', 'CC Stays B');
});
test.after(async () => { fake.uninstall(); await srv.close(); });

test('GET card-check shows the plans with listing limits, the amount and no card data', async () => {
  const r = await A.get('/api/billing/card-check');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'required');
  assert.equal(r.data.amount, '20.00');
  assert.equal(r.data.public_key, 'pk_test_x');
  assert.deepEqual(r.data.plans.map((p) => [p.key, p.price, p.listings]), [['starter', 499, 2], ['growth', 999, 5], ['pro', 1799, 10]]);
});

test('start validates the plan, then one start gives a pending row', async () => {
  assert.equal((await A.post('/api/billing/card-check/start', { renewal_plan: 'gold' })).status, 400);
  assert.equal((await A.post('/api/billing/card-check/start', {})).status, 400);
  const r = await A.post('/api/billing/card-check/start', { renewal_plan: 'growth' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.amount, '20.00');
  assert.equal((await A.get('/api/billing/card-check')).data.pending.billing_id, r.data.billing_id);
});

test('attach: a card number is refused, a declined card is 402, a good card passes and shows in /billing', async () => {
  const id = (await A.post('/api/billing/card-check/start', { renewal_plan: 'growth' })).data.billing_id;
  const url = `/api/billing/card-check/${id}/attach`;
  const bad = await A.post(url, { payment_method_id: '4242424242424242' });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.code, 'VALIDATION');
  const declined = await A.post(url, { payment_method_id: pm(TEST_CARDS.declined) });
  assert.equal(declined.status, 402);
  assert.equal(declined.data.status, 'failed');
  const ok = await A.post(url, { payment_method_id: pm(TEST_CARDS.ok) });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.status, 'passed');
  const bill = await A.get('/api/billing');
  assert.equal(bill.status, 200);
  assert.deepEqual(bill.data.card, { brand: 'visa', last4: '4345' });
  assert.equal(bill.data.saved_card_pay, true);
  assert.equal(bill.data.renewal_plan, 'growth');
  assert.equal(bill.data.subscriptions, false);
  assert.equal(bill.data.auto_renew.on, false);
  const row = bill.data.history.find((h) => h.kind === 'card_check');
  assert.equal(row.amount, '20.00');
  assert.equal(row.plan, null);
  assert.equal(row.card_last4, '4345');
  // a second attach on a passed check
  const again = await A.post(url, { payment_method_id: pm(TEST_CARDS.ok) });
  assert.equal(again.status, 409);
  assert.equal(again.data.code, 'CARD_CHECK_NOT_REQUIRED');
});

test('refresh: another workspace gets 404, own row answers the status', async () => {
  const id = (await B.post('/api/billing/card-check/start', { renewal_plan: 'pro' })).data.billing_id;
  assert.equal((await A.post(`/api/billing/card-check/${id}/refresh`)).status, 404);
  assert.equal((await A.post(`/api/billing/card-check/${id}/attach`, { payment_method_id: 'pm_abcdef123' })).status, 404);
  assert.deepEqual((await B.post(`/api/billing/card-check/${id}/refresh`)).data, { status: 'pending' });
  // a plan row is not a card check
  const [plan] = await sql(`INSERT INTO billing_payments (organization_id, plan, months, amount, provider) VALUES ($1,'growth',1,999,'paymongo') RETURNING billing_id`, [(await orgOf('CC Stays B')).organization_id]);
  assert.equal((await B.post(`/api/billing/card-check/${plan.billing_id}/refresh`)).status, 404);
});

test('3-D Secure then webhook payment.paid passes once; a replay changes nothing; a bad signature is 401', async () => {
  const id = (await B.post('/api/billing/card-check/start', { renewal_plan: 'pro' })).data.billing_id;
  const r = await B.post(`/api/billing/card-check/${id}/attach`, { payment_method_id: pm(TEST_CARDS.threeDS) });
  assert.equal(r.data.status, 'action_required');
  const [{ payment_intent_id: pi }] = await sql('SELECT payment_intent_id FROM billing_payments WHERE billing_id = $1', [id]);
  fake.markIntent(pi, 'succeeded');
  const raw = JSON.stringify(fake.paymentEvent(pi, 'payment.paid'));
  const send = (sig) => fetch(`${srv.base}/api/public/paymongo/webhook`, { method: 'POST', headers: { 'Paymongo-Signature': sig, 'Content-Type': 'application/json' }, body: raw });
  assert.equal((await send('t=1,te=bad,li=bad')).status, 401);
  assert.equal((await send(fake.signedHeader(raw, 'whsk_test'))).status, 200);
  const o1 = await orgOf('CC Stays B');
  assert.equal(o1.card_check, 'passed');
  assert.equal((await send(fake.signedHeader(raw, 'whsk_test'))).status, 200);
  const o2 = await orgOf('CC Stays B');
  assert.deepEqual(o2.trial_ends_at, o1.trial_ends_at);
  assert.equal((await sql(`SELECT 1 FROM audit_logs WHERE organization_id = $1 AND action = 'billing.card_check_passed'`, [o1.organization_id])).length, 1);
});

test('nine declined attaches: the ninth is 429', async () => {
  const c = await ownerAccount(srv.base, 'cc-c@example.com', 'CC Stays C');
  const id = (await c.post('/api/billing/card-check/start', { renewal_plan: 'growth' })).data.billing_id;
  const codes = [];
  for (let i = 0; i < 9; i += 1) codes.push((await c.post(`/api/billing/card-check/${id}/attach`, { payment_method_id: pm(TEST_CARDS.declined) })).status);
  assert.deepEqual(codes, [402, 402, 402, 402, 402, 402, 402, 402, 429]);
});

test('managers and staff get 403 on every card check route and billing', async () => {
  const property = (await A.post('/api/properties', {
    property_name: 'Azure', property_type: 'condominium', address: 'Azure Ave', city: 'Taguig', province: 'Metro Manila',
  })).data.property;
  const inv = await A.post('/api/team/invitations', { email: 'cc-mgr@example.com', role: 'manager', property_ids: [property.property_id] });
  const token = decodeURIComponent(inv.data.inviteLink.split('invite=')[1]);
  const m = client(srv.base);
  const s = await m.post('/api/auth/signup', { full_name: 'Mgr', email: 'cc-mgr@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: token });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  const fakeId = '11111111-1111-4111-8111-111111111111';
  assert.equal((await m.get('/api/billing/card-check')).status, 403);
  assert.equal((await m.post('/api/billing/card-check/start', { renewal_plan: 'growth' })).status, 403);
  assert.equal((await m.post(`/api/billing/card-check/${fakeId}/attach`, { payment_method_id: 'pm_abcdef123' })).status, 403);
  assert.equal((await m.post(`/api/billing/card-check/${fakeId}/refresh`)).status, 403);
  assert.equal((await m.post('/api/billing/pay-saved', { plan: 'growth', months: '1' })).status, 403);
  assert.equal((await m.patch('/api/billing/renewal', { renewal_plan: 'pro' })).status, 403);
  assert.equal((await m.raw('DELETE', '/api/billing/card')).status, 403);
});

test('subscription events with Stage 2 off answer 200 and call no /subscriptions path', async () => {
  const raw = JSON.stringify({ data: { id: 'evt_1', type: 'event', attributes: { type: 'subscription.invoice.paid', livemode: false, data: { id: 'inv_1', attributes: {} } } } });
  const r = await fetch(`${srv.base}/api/public/paymongo/webhook`, { method: 'POST', headers: { 'Paymongo-Signature': fake.signedHeader(raw, 'whsk_test') }, body: raw });
  assert.equal(r.status, 200);
  assert.equal(fake.calls.filter((c) => c.path.startsWith('/subscriptions')).length, 0);
});

test('renewal and card removal: turning off cancels the subscription, removal forgets the card', async () => {
  const o = await orgOf('CC Stays A');
  const subs = require('../src/lib/subscriptions');
  const calls = [];
  const orig = subs.cancelForOrg;
  subs.cancelForOrg = async (...a) => { calls.push(a); return orig(...a); };
  try {
    await sql(`UPDATE organizations SET auto_renew = true, auto_renew_consented_at = now() WHERE organization_id = $1`, [o.organization_id]);
    const r = await A.patch('/api/billing/renewal', { auto_renew: false, renewal_plan: 'pro' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.auto_renew.on, false);
    assert.equal(r.data.renewal_plan, 'pro');
    assert.equal((await orgOf('CC Stays A')).auto_renew, false);
    assert.equal(calls.length, 1);
    const on = await A.patch('/api/billing/renewal', { auto_renew: true, consent: true });
    assert.equal(on.status, 409);
    assert.equal(on.data.code, 'SUBSCRIPTIONS_OFF');
    assert.equal((await A.patch('/api/billing/renewal', { renewal_plan: 'gold' })).status, 400);
    const del = await A.raw('DELETE', '/api/billing/card');
    assert.deepEqual(del.data, { ok: true });
    assert.equal(calls.length, 2);
    const after = await orgOf('CC Stays A');
    assert.equal(after.card_payment_method_id, null);
    assert.equal(after.card_last4, null);
    assert.equal(after.card_check, 'passed');
    assert.equal((await A.get('/api/billing')).data.card, null);
  } finally { subs.cancelForOrg = orig; }
});
