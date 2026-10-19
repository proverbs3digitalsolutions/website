'use strict';

process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { install, TEST_CARDS } = require('./fakes/paymongo');
const billing = require('../src/lib/billing');

const API = 'https://api.paymongo.com/v1';
const basic = (k) => `Basic ${Buffer.from(`${k}:`).toString('base64')}`;
const SK = { Authorization: basic('sk_test_x'), 'Content-Type': 'application/json' };
const PK = { Authorization: basic('pk_test_x'), 'Content-Type': 'application/json' };
const call = async (method, path, headers, body) => {
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const card = (number) => ({ card_number: number, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });

let fake;
test.before(() => { fake = install({ realFetch: globalThis.fetch }); });
test.after(() => fake.uninstall());

async function setup(number) {
  const cus = (await call('POST', '/customers', SK, { data: { attributes: { first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com', phone: '09170000000' } } })).body.data.id;
  const pm = fake.createPaymentMethod(card(number));
  const pi = (await call('POST', '/payment_intents', SK, { data: { attributes: {
    amount: 2000, currency: 'PHP', payment_method_allowed: ['card'], metadata: { kind: 'card_check' },
    setup_future_usage: { session_type: 'on_session', customer_id: cus } } } })).body.data;
  return { cus, pm, pi };
}
const attach = (pi, pm) => call('POST', `/payment_intents/${pi}/attach`, SK, { data: { attributes: { payment_method: pm, return_url: 'https://app.test/#/confirm-card' } } });

test('ok card: attach succeeds and the customer lists the saved method', async () => {
  const { cus, pm, pi } = await setup(TEST_CARDS.ok);
  assert.equal(pi.attributes.status, 'awaiting_payment_method');
  assert.deepEqual(pi.attributes.payment_method_allowed, ['card']);
  const r = await attach(pi.id, pm);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.attributes.status, 'succeeded');
  assert.equal(r.body.data.attributes.payments[0].attributes.amount, 2000);
  assert.equal(r.body.data.attributes.payments[0].attributes.source.last4, '4345');
  const list = await call('GET', `/customers/${cus}/payment_methods`, SK);
  assert.deepEqual(list.body.data.map((m) => m.id), [pm]);
  assert.equal(list.body.data[0].attributes.details.last4, '4345');
  // second attach after success is a 400
  assert.equal((await attach(pi.id, pm)).status, 400);
});

test('3-D Secure card waits for the bank until marked succeeded', async () => {
  const { cus, pm, pi } = await setup(TEST_CARDS.threeDS);
  const r = await attach(pi.id, pm);
  assert.equal(r.body.data.attributes.status, 'awaiting_next_action');
  assert.match(r.body.data.attributes.next_action.redirect.url, /^https:\/\//);
  assert.deepEqual((await call('GET', `/customers/${cus}/payment_methods`, SK)).body.data, []);
  fake.markIntent(pi.id, 'succeeded');
  const g = await call('GET', `/payment_intents/${pi.id}`, SK);
  assert.equal(g.body.data.attributes.status, 'succeeded');
  assert.equal((await call('GET', `/customers/${cus}/payment_methods`, SK)).body.data.length, 1);
});

test('declined card keeps the intent open; a good card then passes on the same intent', async () => {
  const { pm, pi } = await setup(TEST_CARDS.declined);
  const r = await attach(pi.id, pm);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.attributes.status, 'awaiting_payment_method');
  assert.equal(r.body.data.attributes.last_payment_error.code, 'card_declined');
  const good = fake.createPaymentMethod(card(TEST_CARDS.ok));
  assert.equal((await attach(pi.id, good)).body.data.attributes.status, 'succeeded');
});

test('payment method validation answers 400 with a field', async () => {
  const r = await call('POST', '/payment_methods', PK, { data: { attributes: { type: 'card', details: { ...card('4242'), card_number: '4242' } } } });
  assert.equal(r.status, 400);
  assert.equal(r.body.errors[0].source.attribute, 'details.card_number');
  assert.throws(() => fake.createPaymentMethod({ ...card(TEST_CARDS.ok), exp_year: 2001 }), /expired/);
});

test('calls record the key kind; a public key cannot create customers', async () => {
  fake.calls.length = 0;
  fake.createPaymentMethod(card(TEST_CARDS.ok));
  await call('POST', '/payment_methods', PK, { data: { attributes: { type: 'card', details: card(TEST_CARDS.ok) } } });
  const denied = await call('POST', '/customers', PK, { data: { attributes: {} } });
  const none = await call('GET', '/payment_intents/pi_x', {});
  assert.equal(denied.status, 401);
  assert.equal(none.status, 401);
  assert.deepEqual(fake.calls.map((c) => [c.path, c.auth]), [['/payment_methods', 'public'], ['/payment_methods', 'public'], ['/customers', 'public'], ['/payment_intents/pi_x', 'none']]);
});

test('failNext answers once with the given status, then recovers', async () => {
  const { cus } = await setup(TEST_CARDS.ok);
  const body = { data: { attributes: { amount: 2000, currency: 'PHP', setup_future_usage: { session_type: 'on_session', customer_id: cus } } } };
  fake.failNext(/payment_intents$/, 500);
  assert.equal((await call('POST', '/payment_intents', SK, body)).status, 500);
  assert.equal((await call('POST', '/payment_intents', SK, body)).status, 200);
  fake.failNext(/payment_intents$/, 0);
  await assert.rejects(call('POST', '/payment_intents', SK, body), /fetch failed/);
});

test('intent and key errors: amount floor, unknown ids, key check', async () => {
  assert.equal((await call('POST', '/payment_intents', SK, { data: { attributes: { amount: 1999 } } })).status, 400);
  assert.equal((await call('GET', '/payment_intents/pi_nope', SK)).status, 404);
  assert.equal((await call('GET', '/payments?limit=1', SK)).status, 200);
  fake.flags.rejectKey = true;
  assert.equal((await call('GET', '/payments?limit=1', SK)).status, 401);
  fake.flags.rejectKey = false;
});

test('checkout sessions still work and can be marked paid', async () => {
  const body = { data: { attributes: { line_items: [{ currency: 'PHP', amount: 49900, name: 'x', quantity: 1 }] } } };
  const s = (await call('POST', '/checkout_sessions', SK, body)).body.data;
  assert.equal((await call('GET', `/checkout_sessions/${s.id}`, SK)).body.data.attributes.payments.length, 0);
  fake.markCheckout(s.id, 'paid');
  assert.equal((await call('GET', `/checkout_sessions/${s.id}`, SK)).body.data.attributes.payments[0].attributes.amount, 49900);
});

test('detach removes a saved method; second detach is 404', async () => {
  const { cus, pm, pi } = await setup(TEST_CARDS.ok);
  await attach(pi.id, pm);
  assert.equal((await call('DELETE', `/customers/${cus}/payment_methods/${pm}`, SK)).status, 200);
  assert.equal((await call('DELETE', `/customers/${cus}/payment_methods/${pm}`, SK)).status, 404);
});

test('subscriptions: plan, subscribe, invoice paid event verifies, cancel', async () => {
  const { cus, pm, pi } = await setup(TEST_CARDS.ok);
  const plan = (await call('POST', '/subscriptions/plans', SK, { data: { attributes: { amount: 99900, currency: 'PHP', interval: 'monthly', name: 'Growth' } } })).body.data.id;
  assert.equal((await call('POST', '/subscriptions', SK, { data: { attributes: { plan_id: plan, customer_id: cus } } })).status, 400, 'no saved card yet');
  await attach(pi.id, pm);
  const sub = (await call('POST', '/subscriptions', SK, { data: { attributes: { plan_id: plan, customer_id: cus } } })).body.data;
  assert.equal(sub.attributes.status, 'active');

  const { invoiceId, event } = fake.payInvoice(sub.id);
  assert.equal(event.data.attributes.type, 'subscription.invoice.paid');
  assert.equal(event.data.attributes.data.id, invoiceId);
  const inv = await call('GET', `/subscriptions/invoices/${invoiceId}`, SK);
  assert.equal(inv.body.data.attributes.status, 'paid');
  const raw = JSON.stringify(event);
  assert.ok(billing.verifySignature(fake.signedHeader(raw, 'whsk_test'), raw, false));
  assert.ok(!billing.verifySignature(fake.signedHeader(raw, 'wrong'), raw, false));
  assert.equal(fake.payInvoice(sub.id, { failed: true }).event.data.attributes.type, 'subscription.invoice.payment_failed');

  assert.equal((await call('POST', `/subscriptions/${sub.id}/cancel`, SK)).body.data.attributes.status, 'cancelled');
  assert.equal((await call('GET', `/subscriptions/${sub.id}`, SK)).body.data.attributes.status, 'cancelled');
});

test('paymentEvent builds a signed payment.paid body naming the intent', async () => {
  const { pi } = await setup(TEST_CARDS.ok);
  const ev = fake.paymentEvent(pi.id);
  assert.equal(ev.data.attributes.type, 'payment.paid');
  assert.equal(ev.data.attributes.data.attributes.payment_intent_id, pi.id);
});

test('non-PayMongo URLs go to the real fetch', async () => {
  const seen = [];
  fake.uninstall();
  const f2 = install({ realFetch: async (u) => { seen.push(String(u)); return new Response('ok'); } });
  assert.equal(await (await fetch('http://localhost:1/x')).text(), 'ok');
  assert.deepEqual(seen, ['http://localhost:1/x']);
  f2.uninstall();
  fake = install({ realFetch: globalThis.fetch });
});
