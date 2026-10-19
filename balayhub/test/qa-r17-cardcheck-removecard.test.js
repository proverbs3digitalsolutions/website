'use strict';

// Card on file, QA round 17: removing the saved card and automatic payment (contract sections 3.9 and 3.10).
//   Case 1  owner removes the saved card: fields cleared, automatic payment off, audit row, one-tap pay answers SAVED_CARD_NONE.
//   Case 2  Stage 2 on with a live subscription: removal cancels it at PayMongo and paid_until does not move.
//   Case 3  a manager and a staff member of the same workspace get 403 and nothing changes.
//   Case 4  an owner of another workspace cannot remove or change the shared workspace's card.
//   Case 5  removal with no card saved: an unconfirmed workspace is refused by the gate first; a repeat removal answers 200 and writes no second audit row.
//   Case 7  PayMongo fails to cancel the subscription: the removal fails but automatic payment is already off in the database.
//   Case 6  PATCH /billing/renewal {auto_renew:true}: SAVED_CARD_NONE with Stage 2 on and no card; SUBSCRIPTIONS_OFF with Stage 2 off.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_27 node --test --test-concurrency=1 test/qa-r17-cardcheck-removecard.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';
process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const { install, TEST_CARDS } = require('./fakes/paymongo');
const config = require('../src/config');
const subscriptions = require('../src/lib/subscriptions');

// The sign-up limit is 10 an hour per IP and every test here comes from one IP, so this file makes 8 accounts in all.
// One shared workspace (with a saved card and automatic payment on) is only read in cases 3, 4 and 6. Each case that
// removes a card or a subscription gets its own owner.
const SHARED_EMAIL = 'shared-owner@example.com';

let srv; let fake; let shared; let sharedOrg;
test.before(async () => {
  fake = install({ realFetch: globalThis.fetch });
  srv = await startServer();
  config.paymongoSubscriptions = true;
  shared = await cardedOwner(SHARED_EMAIL, 'Shared Stays');
  sharedOrg = await orgIdOf(SHARED_EMAIL);
});
test.after(async () => {
  config.paymongoSubscriptions = false;
  fake.uninstall();
  await srv.close();
});

const PROPERTY = { property_name: 'Casa Reyes', property_type: 'condominium', address: 'Azure Ave', city: 'Taguig', province: 'Metro Manila' };
const cardOf = (number) => ({ card_number: number, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });
const orgRow = async (orgId) => (await sql('SELECT * FROM organizations WHERE organization_id = $1', [orgId]))[0];
const orgIdOf = async (email) => (await sql('SELECT organization_id FROM users WHERE email = $1', [email]))[0].organization_id;
const paidUntil = async (orgId) => (await sql('SELECT paid_until::text AS p FROM organizations WHERE organization_id = $1', [orgId]))[0].p;
const auditRows = (orgId, action) => sql(
  'SELECT record_type, record_id, details FROM audit_logs WHERE organization_id = $1 AND action = $2', [orgId, action]);

// The fields a card removal may change, read from the database. Used to prove a refused request changed nothing.
async function cardState(orgId) {
  const o = await orgRow(orgId);
  return {
    card_payment_method_id: o.card_payment_method_id,
    card_brand: o.card_brand,
    card_last4: o.card_last4,
    auto_renew: o.auto_renew,
    card_check: o.card_check,
    renewal_plan: o.renewal_plan,
    subscription_status: o.subscription_status,
    paid_until: String(o.paid_until),
    trial_ends_at: String(o.trial_ends_at),
  };
}
// PayMongo calls seen by the fake, scoped by what they touch.
const detachCalls = (customerId) => fake.calls.filter((x) => x.method === 'DELETE' && x.path.startsWith(`/customers/${customerId}/payment_methods/`));
const cancelCalls = () => fake.calls.filter((x) => x.method === 'POST' && /^\/subscriptions\/[^/]+\/cancel$/.test(x.path));
const subscriptionCreates = (customerId) => fake.calls.filter((x) => x.method === 'POST' && x.path === '/subscriptions'
  && x.body?.data?.attributes?.customer_id === customerId).length;
const intentCount = () => fake.calls.filter((x) => x.method === 'POST' && x.path === '/payment_intents').length;

// Passes the card check for a signed-in owner: a ₱20 card payment with a Visa ending 4345 (the fake's ok card).
// Consent is always ticked: with Stage 2 on that turns automatic payment on; with Stage 2 off it is ignored.
async function confirmCard(c, email) {
  const start = await c.post('/api/billing/card-check/start', { renewal_plan: 'growth', consent: true });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const attach = await c.post(`/api/billing/card-check/${start.data.billing_id}/attach`,
    { payment_method_id: fake.createPaymentMethod(cardOf(TEST_CARDS.ok)) });
  assert.equal(attach.status, 200, JSON.stringify(attach.data));
  assert.equal(attach.data.status, 'passed');
  const o = await orgRow(await orgIdOf(email));
  assert.equal(o.card_last4, '4345');
  assert.equal(o.card_brand, 'visa');
}

// An owner whose card check has passed, so the card gate is open.
async function cardedOwner(email, workspace) {
  const c = await ownerAccount(srv.base, email, workspace);
  assert.equal((await orgRow(await orgIdOf(email))).card_check, 'required', 'a new workspace must confirm its card first');
  await confirmCard(c, email);
  return c;
}

// A team member joins through the invitation link, the way the invite email asks.
async function joinAs(owner, email, role, propertyIds = []) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const token = decodeURIComponent(inv.data.inviteLink.split('invite=')[1]);
  const s = await c.post('/api/auth/signup', {
    full_name: `${role} member`, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: token,
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

// Stage 2: the trial ends, PayMongo gets one subscription on the saved card, and its first invoice is paid through the
// webhook (the body is never trusted; billing re-reads the invoice). Returns the subscription id.
async function liveSubscription(orgId) {
  await sql('UPDATE organizations SET trial_ends_at = now() WHERE organization_id = $1', [orgId]);
  await subscriptions.startDue();
  const subId = (await orgRow(orgId)).paymongo_subscription_id;
  assert.ok(subId, 'a PayMongo subscription was created at trial end');
  const { event } = fake.payInvoice(subId);
  const raw = JSON.stringify(event);
  const hook = await fetch(`${srv.base}/api/public/paymongo/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Paymongo-Signature': fake.signedHeader(raw, 'whsk_test') },
    body: raw,
  });
  assert.equal(hook.status, 200);
  const o = await orgRow(orgId);
  assert.equal(o.subscription_status, 'active', 'the paid invoice made the subscription active');
  assert.ok(await paidUntil(orgId), 'the paid invoice set paid_until');
  return subId;
}

test('case 1: owner removes the saved card: fields cleared, automatic payment off, audit row, nothing left to pay with', async () => {
  config.paymongoSubscriptions = true;
  const email = 'remove-owner@example.com';
  const c = await cardedOwner(email, 'Remove Card Stays');
  const orgId = await orgIdOf(email);
  const before = await orgRow(orgId);
  assert.equal(before.auto_renew, true, 'precondition: automatic payment is on');
  assert.ok(fake.state.customers.get(before.paymongo_customer_id).methods.includes(before.card_payment_method_id),
    'precondition: PayMongo holds the card');
  const cancelsBefore = cancelCalls().length;

  const del = await c.raw('DELETE', '/api/billing/card');
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.deepEqual(del.data, { ok: true });

  const after = await orgRow(orgId);
  assert.equal(after.card_payment_method_id, null, 'payment method id cleared');
  assert.equal(after.card_brand, null, 'card brand cleared');
  assert.equal(after.card_last4, null, 'card last 4 cleared');
  assert.equal(after.auto_renew, false, 'automatic payment off');
  assert.equal(after.card_check, 'passed', 'the card check stays passed');
  assert.equal(String(after.trial_ends_at), String(before.trial_ends_at), 'the trial is unchanged');

  // PayMongo: the card is detached from this workspace's customer, and there was no subscription to cancel.
  assert.equal(detachCalls(before.paymongo_customer_id).length, 1, 'one detach call for the card');
  assert.ok(!fake.state.customers.get(before.paymongo_customer_id).methods.includes(before.card_payment_method_id),
    'PayMongo no longer holds the card');
  assert.equal(cancelCalls().length, cancelsBefore, 'no subscription cancel when there is no subscription');

  // Audit: one card_removed row, for this workspace.
  const rows = await auditRows(orgId, 'billing.card_removed');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].record_type, 'organization');
  assert.equal(rows[0].record_id, orgId);

  // Plan & billing shows no card and no automatic payment.
  const bill = (await c.get('/api/billing')).data;
  assert.equal(bill.card, null);
  assert.equal(bill.saved_card_pay, false);
  assert.equal(bill.auto_renew.on, false);

  // One-tap pay answers SAVED_CARD_NONE and starts no PayMongo payment.
  const intentsBefore = intentCount();
  const pay = await c.post('/api/billing/pay-saved', { plan: 'growth', months: '1' });
  assert.equal(pay.status, 409, JSON.stringify(pay.data));
  assert.equal(pay.data.code, 'SAVED_CARD_NONE');
  assert.equal(intentCount(), intentsBefore, 'no payment intent was created');

  // The workspace is still open: the card check stayed passed, so writes still work.
  const prop = await c.post('/api/properties', PROPERTY);
  assert.equal(prop.status, 201, JSON.stringify(prop.data));
});

test('case 2: removing the card with a live subscription cancels it at PayMongo and leaves paid_until where it was', async () => {
  config.paymongoSubscriptions = true;
  const email = 'remove-live@example.com';
  const c = await cardedOwner(email, 'Live Sub Stays');
  const orgId = await orgIdOf(email);
  const subId = await liveSubscription(orgId);
  const live = await orgRow(orgId);
  assert.equal(live.auto_renew, true, 'precondition: automatic payment is on');
  const paidTo = await paidUntil(orgId);
  const cancelsBefore = cancelCalls().length;

  const del = await c.raw('DELETE', '/api/billing/card');
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.deepEqual(del.data, { ok: true });

  // PayMongo cancelled exactly this subscription, once.
  assert.equal(fake.state.subscriptions.get(subId).attributes.status, 'cancelled', 'PayMongo cancelled the subscription');
  assert.equal(cancelCalls().length - cancelsBefore, 1, 'one cancel call');
  assert.equal(cancelCalls().filter((x) => x.path === `/subscriptions/${subId}/cancel`).length, 1, 'the cancel was for this subscription');

  const after = await orgRow(orgId);
  assert.equal(after.subscription_status, 'cancelled');
  assert.equal(after.auto_renew, false);
  assert.equal(after.card_payment_method_id, null);
  assert.equal(await paidUntil(orgId), paidTo, 'paid_until is unchanged by removing the card');

  const cancelAudit = await auditRows(orgId, 'billing.subscription_cancelled');
  assert.equal(cancelAudit.length, 1);
  assert.equal(cancelAudit[0].details.reason, 'card removed');
  assert.equal((await auditRows(orgId, 'billing.card_removed')).length, 1);

  const bill = (await c.get('/api/billing')).data;
  assert.equal(bill.card, null);
  assert.equal(bill.auto_renew.on, false);
  assert.equal(bill.auto_renew.status, 'cancelled');

  // Nothing is subscribed again: with no card and automatic payment off, the subscription job creates nothing for this workspace.
  const createsBefore = subscriptionCreates(live.paymongo_customer_id);
  await subscriptions.startDue();
  assert.equal(subscriptionCreates(live.paymongo_customer_id), createsBefore, 'no new subscription after removal');
  assert.equal(await paidUntil(orgId), paidTo, 'paid_until still unchanged');
});

test('case 3: a manager and a staff member of the same workspace get 403 and nothing changes', async () => {
  config.paymongoSubscriptions = true;
  const prop = (await shared.post('/api/properties', PROPERTY)).data.property;
  const manager = await joinAs(shared, 'rbac-manager@example.com', 'manager', [prop.property_id]);
  const staff = await joinAs(shared, 'rbac-staff@example.com', 'staff', []);
  const before = await cardState(sharedOrg);
  const cus = (await orgRow(sharedOrg)).paymongo_customer_id;
  const cancelsBefore = cancelCalls().length;

  for (const [label, member] of [['manager', manager], ['staff', staff]]) {
    // Signed in, so the 403 comes from the owner-only rule and not from a broken session.
    assert.equal((await member.get('/api/auth/me')).status, 200, `${label} is signed in`);

    const del = await member.raw('DELETE', '/api/billing/card');
    assert.equal(del.status, 403, `${label} DELETE /billing/card: ${JSON.stringify(del.data)}`);
    assert.equal(del.data.code, 'FORBIDDEN', `${label} DELETE code`);

    const ren = await member.patch('/api/billing/renewal', { auto_renew: false });
    assert.equal(ren.status, 403, `${label} PATCH /billing/renewal: ${JSON.stringify(ren.data)}`);
    assert.equal(ren.data.code, 'FORBIDDEN', `${label} PATCH code`);
  }

  assert.deepEqual(await cardState(sharedOrg), before, 'the refused requests changed nothing');
  assert.equal(detachCalls(cus).length, 0, 'no PayMongo detach');
  assert.equal(cancelCalls().length, cancelsBefore, 'no PayMongo cancel');
  assert.equal((await auditRows(sharedOrg, 'billing.card_removed')).length, 0, 'no card_removed audit row');
  assert.equal((await auditRows(sharedOrg, 'billing.renewal_changed')).length, 0, 'no renewal_changed audit row');
  const bill = (await shared.get('/api/billing')).data;
  assert.equal(bill.card.last4, '4345', 'the owner still sees the card');
  assert.equal(bill.auto_renew.on, true, 'the owner still sees automatic payment on');
});

test('case 4: an owner of another workspace cannot remove or change the shared workspace\'s card', async () => {
  config.paymongoSubscriptions = true;
  const bEmail = 'cross-b@example.com';
  const b = await cardedOwner(bEmail, 'Cross B Stays');
  const bOrg = await orgIdOf(bEmail);
  const aBefore = await cardState(sharedOrg);
  const aCus = (await orgRow(sharedOrg)).paymongo_customer_id;
  const aPm = aBefore.card_payment_method_id;
  assert.ok(aPm, 'precondition: the shared workspace has a saved card');
  assert.equal(aBefore.auto_renew, true, 'precondition: the shared workspace has automatic payment on');

  // Owner B removes B's card, then switches automatic payment off, both from B's own session.
  const del = await b.raw('DELETE', '/api/billing/card');
  assert.equal(del.status, 200, JSON.stringify(del.data));
  const ren = await b.patch('/api/billing/renewal', { auto_renew: false });
  assert.equal(ren.status, 200, JSON.stringify(ren.data));

  // The shared workspace is untouched in the database, at PayMongo, and in the audit log.
  assert.deepEqual(await cardState(sharedOrg), aBefore, 'the shared workspace row is unchanged');
  assert.ok(fake.state.customers.get(aCus).methods.includes(aPm), 'PayMongo still holds the shared workspace\'s card');
  assert.equal(detachCalls(aCus).length, 0, 'no PayMongo detach for the shared workspace');
  assert.equal((await auditRows(sharedOrg, 'billing.card_removed')).length, 0, 'no card_removed row for the shared workspace');
  assert.equal((await auditRows(sharedOrg, 'billing.renewal_changed')).length, 0, 'no renewal_changed row for the shared workspace');

  // The removal was for B's workspace only.
  assert.equal((await orgRow(bOrg)).card_payment_method_id, null, 'workspace B\'s card is removed');
  assert.equal((await auditRows(bOrg, 'billing.card_removed')).length, 1, 'one card_removed row for workspace B');

  // The shared owner still sees its own card and automatic payment.
  const aBill = (await shared.get('/api/billing')).data;
  assert.equal(aBill.card.last4, '4345');
  assert.equal(aBill.auto_renew.on, true);
});

test('case 5: removing with no card saved does not crash; an unconfirmed workspace is refused by the gate first', async () => {
  config.paymongoSubscriptions = true;
  const email = 'nocard-owner@example.com';
  const c = await ownerAccount(srv.base, email, 'No Card Stays');
  const orgId = await orgIdOf(email);

  // Never confirmed a card: the card gate answers before the route runs, and nothing is written.
  const unconfirmed = await cardState(orgId);
  assert.equal(unconfirmed.card_check, 'required', 'precondition: the card is not confirmed');
  const gated = await c.raw('DELETE', '/api/billing/card');
  assert.equal(gated.status, 402, JSON.stringify(gated.data));
  assert.equal(gated.data.code, 'CARD_CHECK_REQUIRED');
  assert.deepEqual(await cardState(orgId), unconfirmed, 'the gated workspace changed nothing');
  assert.equal((await auditRows(orgId, 'billing.card_removed')).length, 0);

  // Confirm the card, then remove it: a second removal has no card to forget.
  await confirmCard(c, email);
  const cus = (await orgRow(orgId)).paymongo_customer_id;
  const first = await c.raw('DELETE', '/api/billing/card');
  assert.equal(first.status, 200, JSON.stringify(first.data));

  const detachesBefore = detachCalls(cus).length;
  const again = await c.raw('DELETE', '/api/billing/card');
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.deepEqual(again.data, { ok: true });
  assert.equal(detachCalls(cus).length, detachesBefore, 'no PayMongo detach when there is no card');

  const row = await orgRow(orgId);
  assert.equal(row.card_payment_method_id, null);
  assert.equal(row.card_brand, null);
  assert.equal(row.card_last4, null);
  assert.equal(row.auto_renew, false);
  assert.equal(row.card_check, 'passed', 'the card check stays passed');

  // Round 18: a repeat removal forgets nothing, so it writes no second card_removed audit row.
  assert.equal((await auditRows(orgId, 'billing.card_removed')).length, 1);
});

test('case 6: automatic payment with no saved card answers SAVED_CARD_NONE (Stage 2 on) and SUBSCRIPTIONS_OFF (Stage 2 off)', async () => {
  // Stage 2 on, card removed: the saved card is checked before consent.
  config.paymongoSubscriptions = true;
  const email = 'renew-owner@example.com';
  const c = await cardedOwner(email, 'Renew Stays');
  const orgId = await orgIdOf(email);
  assert.equal((await c.raw('DELETE', '/api/billing/card')).status, 200);
  const before = await cardState(orgId);
  assert.equal(before.card_payment_method_id, null, 'precondition: no card');
  assert.equal(before.auto_renew, false, 'precondition: automatic payment off');

  const withConsent = await c.patch('/api/billing/renewal', { auto_renew: true, consent: true });
  assert.equal(withConsent.status, 409, JSON.stringify(withConsent.data));
  assert.equal(withConsent.data.code, 'SAVED_CARD_NONE');
  assert.equal(withConsent.data.error, 'There is no saved card. Pay another way.');

  const withoutConsent = await c.patch('/api/billing/renewal', { auto_renew: true });
  assert.equal(withoutConsent.status, 409, JSON.stringify(withoutConsent.data));
  assert.equal(withoutConsent.data.code, 'SAVED_CARD_NONE', 'the saved card is checked before consent');

  assert.deepEqual(await cardState(orgId), before, 'both refusals changed nothing');
  assert.equal((await auditRows(orgId, 'billing.renewal_changed')).length, 0, 'no renewal_changed row');

  // Stage 2 off: automatic payment is not available, with no card (the refusal is the same whether or not a card is saved).
  config.paymongoSubscriptions = false;
  const offNoCard = await c.patch('/api/billing/renewal', { auto_renew: true, consent: true });
  assert.equal(offNoCard.status, 409, JSON.stringify(offNoCard.data));
  assert.equal(offNoCard.data.code, 'SUBSCRIPTIONS_OFF');
  assert.equal(offNoCard.data.error, 'Automatic payment is not available yet.');

  // Stage 2 off with a card still saved (the shared workspace): still SUBSCRIPTIONS_OFF, and nothing changes.
  const sharedBefore = await cardState(sharedOrg);
  assert.ok(sharedBefore.card_payment_method_id, 'precondition: the shared workspace has a saved card');
  const offCard = await shared.patch('/api/billing/renewal', { auto_renew: true, consent: true });
  assert.equal(offCard.status, 409, JSON.stringify(offCard.data));
  assert.equal(offCard.data.code, 'SUBSCRIPTIONS_OFF');
  assert.deepEqual(await cardState(sharedOrg), sharedBefore, 'the refusal changed nothing');
});

test('case 7: a failed PayMongo cancel still leaves automatic payment off in the database', async () => {
  config.paymongoSubscriptions = true;
  const email = 'cancelfail-owner@example.com';
  const c = await cardedOwner(email, 'Cancel Fail Stays');
  const orgId = await orgIdOf(email);
  await liveSubscription(orgId);
  assert.equal((await orgRow(orgId)).auto_renew, true, 'precondition: automatic payment is on');

  fake.failNext(/^\/subscriptions\/[^/]+\/cancel$/, 500);
  const del = await c.raw('DELETE', '/api/billing/card');
  assert.notEqual(del.status, 200, JSON.stringify(del.data));
  assert.equal((await orgRow(orgId)).auto_renew, false, 'automatic payment is off even though the cancel failed');
  assert.equal((await auditRows(orgId, 'billing.card_removed')).length, 0, 'no card_removed row: the card was not removed');
});
