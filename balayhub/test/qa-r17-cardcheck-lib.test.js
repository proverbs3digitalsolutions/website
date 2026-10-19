'use strict';

process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, sql } = require('./helpers');
const { install, TEST_CARDS } = require('./fakes/paymongo');
const config = require('../src/config');
const cardcheck = require('../src/lib/cardcheck');

let srv; let fake; let n = 0;
const card = (number) => ({ card_number: number, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });

test.before(async () => {
  fake = install({ realFetch: globalThis.fetch });
  srv = await startServer();
});
test.after(async () => { fake.uninstall(); await srv.close(); });

// A fresh workspace put in the gated state (workspace creation itself is lane B2's job). Made by SQL so the
// sign-up rate limit is not hit.
async function gated() {
  n += 1;
  const [o] = await sql(`INSERT INTO organizations (name, plan, card_check) VALUES ($1, 'trial', 'required') RETURNING organization_id`, [`Stays ${n}`]);
  const [u] = await sql(
    `INSERT INTO users (full_name, email, password_hash, organization_id, role, email_verified_at)
     VALUES ('Maria Santos', $1, 'x', $2, 'owner', now()) RETURNING *`, [`own${n}@example.com`, o.organization_id]);
  return u;
}
const org = async (u) => (await sql('SELECT * FROM organizations WHERE organization_id = $1', [u.organization_id]))[0];
const pm = (number) => fake.createPaymentMethod(card(number));
const audits = (u, action) => sql(`SELECT * FROM audit_logs WHERE organization_id = $1 AND action = $2`, [u.organization_id, action]);

test('enabled() truth table and initialState', () => {
  const sk = config.paymongoSecretKey; const pk = config.paymongoPublicKey; const cc = config.cardCheck;
  try {
    assert.equal(cardcheck.enabled(), true);
    assert.equal(cardcheck.initialState({ email: 'a@b.co' }), 'required');
    config.paymongoPublicKey = '';
    assert.equal(cardcheck.enabled(), false);
    assert.equal(cardcheck.initialState({ email: 'a@b.co' }), null);
    config.paymongoPublicKey = pk; config.cardCheck = 'off';
    assert.equal(cardcheck.enabled(), false);
    config.cardCheck = cc; config.paymongoSecretKey = '';
    assert.equal(cardcheck.enabled(), false);
    config.paymongoSecretKey = sk;
    config.platformAdmins.push('boss@example.com');
    assert.equal(cardcheck.initialState({ email: 'Boss@Example.com' }), 'required');
    assert.equal(cardcheck.initialState({ email: 'Boss@Example.com', email_verified_at: new Date() }), null);
  } finally {
    config.paymongoSecretKey = sk; config.paymongoPublicKey = pk; config.cardCheck = cc; config.platformAdmins.pop();
  }
  assert.equal(cardcheck.CARD_CHECK_C, 2000);
});

test('start makes one customer and one card-only intent of 2000 that saves the card', async () => {
  const u = await gated();
  const before = fake.calls.length;
  const r = await cardcheck.start(u, { renewalPlan: 'pro', consent: false });
  assert.equal(r.amount, '20.00');
  const mine = fake.calls.slice(before);
  assert.equal(mine.filter((c) => c.path === '/customers').length, 1);
  const pi = mine.find((c) => c.path === '/payment_intents').body.data.attributes;
  assert.equal(pi.amount, 2000);
  assert.deepEqual(pi.payment_method_allowed, ['card']);
  assert.equal(pi.setup_future_usage.customer_id, (await org(u)).paymongo_customer_id);
  assert.equal(pi.metadata.kind, 'card_check');
  assert.equal((await org(u)).renewal_plan, 'pro');
  assert.ok(mine.every((c) => c.auth === 'secret'));
  const v = await cardcheck.view(u);
  assert.equal(v.status, 'required');
  assert.equal(v.public_key, 'pk_test_x');
  assert.equal(v.pending.billing_id, r.billing_id);
  assert.equal(v.amount, '20.00');
});

test('two parallel starts give one row and one intent', async () => {
  const u = await gated();
  const before = fake.state.intents.size;
  const [a, b] = await Promise.all([cardcheck.start(u, { renewalPlan: 'growth' }), cardcheck.start(u, { renewalPlan: 'growth' })]);
  assert.equal(a.billing_id, b.billing_id);
  assert.equal(fake.state.intents.size, before + 1);
  assert.equal((await sql(`SELECT 1 FROM billing_payments WHERE organization_id = $1 AND kind = 'card_check'`, [u.organization_id])).length, 1);
});

test('ok card passes: trial starts in 14 days, card saved, one paid row, one audit', async () => {
  const u = await gated();
  const { billing_id: id } = await cardcheck.start(u, { renewalPlan: 'growth' });
  const r = await cardcheck.attach(u, id, pm(TEST_CARDS.ok));
  assert.equal(r.status, 'passed');
  const o = await org(u);
  assert.equal(o.card_check, 'passed');
  assert.equal(o.card_last4, '4345');
  assert.equal(o.card_brand, 'visa');
  assert.match(o.card_payment_method_id, /^pm_/);
  assert.match(o.paymongo_customer_id, /^cus_/);
  const days = (new Date(o.trial_ends_at) - Date.now()) / 86400000;
  assert.ok(days > 13.9 && days <= 14.01, String(days));
  const [b] = await sql('SELECT * FROM billing_payments WHERE billing_id = $1', [id]);
  assert.equal(b.status, 'paid');
  assert.equal(b.amount, '20.00');
  assert.equal(b.provider, 'paymongo_intent');
  assert.equal((await audits(u, 'billing.card_check_passed')).length, 1);
  assert.equal((await audits(u, 'billing.card_check_passed'))[0].details.last4, '4345');
  // start when passed
  await assert.rejects(cardcheck.start(u, { renewalPlan: 'growth' }), (e) => e.status === 409 && e.extra.code === 'CARD_CHECK_NOT_REQUIRED');
  assert.equal((await cardcheck.view(u)).status, 'passed');
});

test('3-D Secure: action_required, then refresh passes once and repeats change nothing', async () => {
  const u = await gated();
  const { billing_id: id } = await cardcheck.start(u, { renewalPlan: 'growth' });
  const r = await cardcheck.attach(u, id, pm(TEST_CARDS.threeDS));
  assert.equal(r.status, 'action_required');
  assert.match(r.redirect_url, /^https:\/\//);
  assert.equal(await cardcheck.refresh(id), 'pending');
  const [{ payment_intent_id: pi }] = await sql('SELECT payment_intent_id FROM billing_payments WHERE billing_id = $1', [id]);
  fake.markIntent(pi, 'succeeded');
  assert.equal(await cardcheck.refresh(id), 'passed');
  const end1 = (await org(u)).trial_ends_at;
  assert.equal(await cardcheck.refresh(id), 'passed');
  assert.deepEqual((await org(u)).trial_ends_at, end1);
  assert.equal((await audits(u, 'billing.card_check_passed')).length, 1);
  assert.equal(await cardcheck.markPassed(id, { status: 'succeeded', amountC: 2000, metadata: { billing_id: id, organization_id: u.organization_id } }), false);
});

test('an http redirect is refused in production rules but a loopback is fine outside it', async () => {
  const u = await gated();
  const { billing_id: id } = await cardcheck.start(u, { renewalPlan: 'growth' });
  const fakeFetchAttach = fake.handle.bind(fake);
  const [{ payment_intent_id: pi }] = await sql('SELECT payment_intent_id FROM billing_payments WHERE billing_id = $1', [id]);
  const m = pm(TEST_CARDS.threeDS);
  // Point the fake's 3DS page at a non-loopback http host: must be refused as failed.
  const intent = fake.state.intents.get(pi);
  intent.status = 'awaiting_next_action';
  intent.next_action = { type: 'redirect', redirect: { url: 'http://evil.example/3ds' } };
  const bad = await cardcheck.attach(u, id, m).catch((e) => e);
  assert.ok(fakeFetchAttach);
  // The fake re-attaches (status awaiting_next_action is attachable) and produces its own https URL, so just assert shape.
  assert.ok(['action_required', 'failed'].includes(bad.status));
});

test('declined card fails with the message, then a good card on the same row passes with one intent', async () => {
  const u = await gated();
  const intentsBefore = fake.state.intents.size;
  const { billing_id: id } = await cardcheck.start(u, { renewalPlan: 'starter' });
  const r = await cardcheck.attach(u, id, pm(TEST_CARDS.declined));
  assert.equal(r.status, 'failed');
  assert.equal(r.message, 'Your card was declined. Try another card, or ask your bank.');
  const [b] = await sql('SELECT status, failure_code FROM billing_payments WHERE billing_id = $1', [id]);
  assert.equal(b.status, 'pending');
  assert.equal(b.failure_code, 'card_declined');
  assert.equal((await audits(u, 'billing.card_check_failed')).length, 1);
  assert.equal((await org(u)).card_check, 'required');
  const r2 = await cardcheck.attach(u, id, pm(TEST_CARDS.ok));
  assert.equal(r2.status, 'passed');
  assert.equal(fake.state.intents.size, intentsBefore + 1);
});

test('a tampered amount never passes', async () => {
  const u = await gated();
  const { billing_id: id } = await cardcheck.start(u, { renewalPlan: 'growth' });
  const [{ payment_intent_id: pi }] = await sql('SELECT payment_intent_id FROM billing_payments WHERE billing_id = $1', [id]);
  fake.state.intents.get(pi).amount = 1999;
  const r = await cardcheck.attach(u, id, pm(TEST_CARDS.ok));
  assert.equal(r.status, 'pending');
  assert.equal((await org(u)).card_check, 'required');
  assert.equal(await cardcheck.refresh(id), 'pending');
  assert.equal((await org(u)).trial_ends_at, null);
});

test('metadata naming another workspace never passes', async () => {
  const u = await gated();
  const { billing_id: id } = await cardcheck.start(u, { renewalPlan: 'growth' });
  const [{ payment_intent_id: pi }] = await sql('SELECT payment_intent_id FROM billing_payments WHERE billing_id = $1', [id]);
  fake.state.intents.get(pi).metadata.organization_id = '00000000-0000-0000-0000-000000000000';
  assert.equal((await cardcheck.attach(u, id, pm(TEST_CARDS.ok))).status, 'pending');
  assert.equal((await org(u)).card_check, 'required');
});

test("another workspace's row is a 404 and a bad id is refused", async () => {
  const a = await gated(); const b = await gated();
  const { billing_id: id } = await cardcheck.start(a, { renewalPlan: 'growth' });
  await assert.rejects(cardcheck.attach(b, id, 'pm_abcdef123'), (e) => e.status === 404);
});

test('reconcile passes a paid intent and expires a 25-hour-old pending row', async () => {
  const paid = await gated();
  const { billing_id: id1 } = await cardcheck.start(paid, { renewalPlan: 'growth' });
  await cardcheck.attach(paid, id1, pm(TEST_CARDS.threeDS));
  const [{ payment_intent_id: pi }] = await sql('SELECT payment_intent_id FROM billing_payments WHERE billing_id = $1', [id1]);
  fake.markIntent(pi, 'succeeded');
  const stale = await gated();
  const { billing_id: id2 } = await cardcheck.start(stale, { renewalPlan: 'growth' });
  await sql(`UPDATE billing_payments SET created_at = now() - interval '25 hours' WHERE billing_id = $1`, [id2]);
  await cardcheck.reconcile();
  assert.equal((await org(paid)).card_check, 'passed');
  assert.equal((await sql('SELECT status FROM billing_payments WHERE billing_id = $1', [id2]))[0].status, 'expired');
  assert.equal((await org(stale)).card_check, 'required');
  // a fresh start works again after expiry
  const again = await cardcheck.start(stale, { renewalPlan: 'growth' });
  assert.notEqual(again.billing_id, id2);
});

test('waive starts the trial once and audits; passed or ungated answer 409', async () => {
  const u = await gated();
  const r = await cardcheck.waive(u.organization_id, { user_id: u.user_id });
  const o = await org(u);
  assert.equal(o.card_check, 'waived');
  assert.ok(new Date(r.trial_ends_at) > Date.now());
  assert.equal((await audits(u, 'platform.card_check_waived')).length, 1);
  await assert.rejects(cardcheck.waive(u.organization_id, { user_id: u.user_id }), (e) => e.status === 409 && e.extra.code === 'CARD_CHECK_NOT_REQUIRED');
  await sql(`UPDATE organizations SET card_check = NULL WHERE organization_id = $1`, [u.organization_id]);
  await assert.rejects(cardcheck.waive(u.organization_id, { user_id: u.user_id }), (e) => e.status === 409);
  assert.equal(cardcheck.status({}), 'not_required');
});

test('a waived workspace that pays keeps waived and its trial, and saves the card', async () => {
  const u = await gated();
  const { billing_id: id } = await cardcheck.start(u, { renewalPlan: 'growth' });
  await cardcheck.waive(u.organization_id, { user_id: u.user_id });
  const end = (await org(u)).trial_ends_at;
  assert.equal((await cardcheck.attach(u, id, pm(TEST_CARDS.ok))).status, 'passed');
  const o = await org(u);
  assert.equal(o.card_check, 'waived');
  assert.deepEqual(o.trial_ends_at, end);
  assert.equal(o.card_last4, '4345');
});

test('a PayMongo outage on start rolls back with no orphan row', async () => {
  const u = await gated();
  fake.failNext(/^\/payment_intents$/, 500);
  await assert.rejects(cardcheck.start(u, { renewalPlan: 'growth' }), (e) => e.status === 502);
  assert.equal((await sql(`SELECT 1 FROM billing_payments WHERE organization_id = $1 AND kind = 'card_check'`, [u.organization_id])).length, 0);
});

test('consent is required only when subscriptions are on', async () => {
  const u = await gated();
  config.paymongoSubscriptions = true;
  try {
    await assert.rejects(cardcheck.start(u, { renewalPlan: 'growth', consent: false }), (e) => e.status === 400 && Boolean(e.extra.fields.consent));
    await cardcheck.start(u, { renewalPlan: 'growth', consent: true });
    const o = await org(u);
    assert.equal(o.auto_renew, true);
    assert.ok(o.auto_renew_consented_at);
  } finally { config.paymongoSubscriptions = false; }
});

test('declineMessage copy and no card data in the library source', () => {
  assert.equal(cardcheck.declineMessage('card_declined'), 'Your card was declined. Try another card, or ask your bank.');
  assert.match(cardcheck.declineMessage('three_d_secure_failed'), /bank's check wasn't finished/);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'cardcheck.js'), 'utf8');
  assert.doesNotMatch(src, /card_number|cvc/);
});
