'use strict';

// Card on file, lane X (D-98): cross-lane stories over HTTP, with the in-process PayMongo fake.
//   Story 1 (Stage 2 on): sign up, verify, create the workspace (gated), a write is 402, start, 3-D Secure card,
//     approve at the fake, refresh (trial starts), property, the 3-day reminder, the subscription at trial end,
//     the invoice webhook, cancel automatic payment.
//   Story 2 (Stage 2 off): the saved card pays the plan in one tap at trial end; no /subscriptions call is made.
//   Story 3: a declined card answers 402 and the workspace stays gated.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_26 node --test --test-concurrency=1 test/qa-r17-cardcheck-flow.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';
process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, manilaToday } = require('./helpers');
const { install, TEST_CARDS } = require('./fakes/paymongo');
const config = require('../src/config');
const { outbox } = require('../src/lib/mailer');
const { sendTrialReminders } = require('../src/lib/trialreminder');
const subscriptions = require('../src/lib/subscriptions');

let srv; let fake;
test.before(async () => {
  fake = install({ realFetch: globalThis.fetch });
  srv = await startServer();
});
test.after(async () => {
  config.paymongoSubscriptions = false;
  fake.uninstall();
  await srv.close();
});

const PROPERTY = { property_name: 'Casa Reyes', property_type: 'condominium', address: 'Azure Ave', city: 'Taguig', province: 'Metro Manila' };
const cardOf = (number) => ({ card_number: number, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });
const attachUrl = (billingId) => `/api/billing/card-check/${billingId}/attach`;
const refreshUrl = (billingId) => `/api/billing/card-check/${billingId}/refresh`;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const orgOf = async (email) => (await sql(
  'SELECT o.* FROM organizations o JOIN users u ON u.organization_id = o.organization_id WHERE u.email = $1', [email]))[0];
const paidUntil = async (orgId) => (await sql(
  'SELECT paid_until::text AS p FROM organizations WHERE organization_id = $1', [orgId]))[0].p;
const reminderMails = (email) => outbox.filter((m) => String(m.to) === email
  && /^Your BalayHub (trial ends|plan starts) on /.test(m.subject));
const subscriptionCalls = () => fake.calls.filter((c) => c.path.startsWith('/subscriptions'));
const trialIsFourteenDays = (iso) => Math.abs(Date.parse(iso) - (Date.now() + 14 * 86400000)) < 60000;
// Days from `start` to a paid period's last day: a one-month plan period is 27 to 31 days.
const oneMonthSpan = (start, end) => { const d = daysBetween(start, end); return d >= 27 && d <= 31; };

// Sign up, as the sign-up form does. Returns the client (signed in).
async function signUp(email, name = 'Ana Reyes') {
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', {
    full_name: name, email, password: 'correct-horse-1', confirm_password: 'correct-horse-1', accept_privacy: true,
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

// Verify the email with the link from the verification mail, as the host would click it.
async function verifyFromInbox(c, email) {
  const mail = outbox.filter((m) => String(m.to) === email && m.subject === 'Verify your BalayHub email').at(-1);
  assert.ok(mail, `a verification email went to ${email}`);
  const token = decodeURIComponent(/token=([^\s]+)/.exec(mail.text)[1]);
  const r = await c.post('/api/auth/verify-email', { token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}

// Sign up, refuse a workspace before verifying, verify, then create the workspace.
async function ownerWorkspace(email, workspaceName) {
  const c = await signUp(email);
  const early = await c.post('/api/workspace', { name: workspaceName });
  assert.equal(early.status, 403, 'a workspace needs a verified email');
  assert.equal(early.data.code, 'EMAIL_UNVERIFIED');
  await verifyFromInbox(c, email);
  const w = await c.post('/api/workspace', { name: workspaceName });
  assert.equal(w.status, 201, JSON.stringify(w.data));
  return c;
}

test('story 1, Stage 2 on: gate, card check, trial, reminder, subscription at trial end, invoice, cancel', async () => {
  config.paymongoSubscriptions = true;
  const email = 'flow-stage2@example.com';
  const c = await ownerWorkspace(email, 'Reyes Stays');

  // Gated: the account says so, and a write is refused.
  let me = (await c.get('/api/auth/me')).data.user;
  assert.equal(me.plan.reason, 'card_check');
  assert.equal(me.plan.card_check_due, true);
  assert.equal(me.plan.trial_ends_at, null);
  assert.equal(me.card, null);
  const blocked = await c.post('/api/properties', PROPERTY);
  assert.equal(blocked.status, 402, JSON.stringify(blocked.data));
  assert.equal(blocked.data.code, 'CARD_CHECK_REQUIRED');

  // Stage 2 refuses a start without the consent tick (nothing is created).
  const noConsent = await c.post('/api/billing/card-check/start', { renewal_plan: 'growth' });
  assert.equal(noConsent.status, 400, JSON.stringify(noConsent.data));
  assert.equal(noConsent.data.code, 'VALIDATION');
  assert.equal(noConsent.data.fields.consent, 'Tick the box to agree to automatic payment.');

  // Start: Stage 2 needs the consent tick. The Payment Intent is ₱20, card only, and saves the card to the customer.
  const start = await c.post('/api/billing/card-check/start', { renewal_plan: 'growth', consent: true });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  assert.equal(start.data.amount, '20.00');
  const billingId = start.data.billing_id;
  const org = await orgOf(email);
  const [row] = await sql('SELECT payment_intent_id, kind, status FROM billing_payments WHERE billing_id = $1', [billingId]);
  assert.equal(row.kind, 'card_check');
  assert.equal(row.status, 'pending');
  const intent = fake.state.intents.get(row.payment_intent_id);
  assert.equal(intent.amount, 2000, 'the card check is exactly ₱20 in centavos');
  assert.deepEqual(intent.payment_method_allowed, ['card']);
  assert.equal(intent.setup_future_usage.customer_id, org.paymongo_customer_id);
  const pending = (await c.get('/api/billing/card-check')).data;
  assert.equal(pending.pending.billing_id, billingId);
  assert.equal(pending.subscriptions, true);

  // The browser sends the card straight to PayMongo; BalayHub only ever receives the payment method id.
  const pm = fake.createPaymentMethod(cardOf(TEST_CARDS.threeDS));
  const attach = await c.post(attachUrl(billingId), { payment_method_id: pm });
  assert.equal(attach.status, 200, JSON.stringify(attach.data));
  assert.equal(attach.data.status, 'action_required');
  assert.match(attach.data.redirect_url, /^https:\/\//);

  // The bank approves at the fake, then the browser comes back and refreshes: the trial starts.
  fake.markIntent(row.payment_intent_id, 'succeeded');
  const refreshed = await c.post(refreshUrl(billingId));
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.data));
  assert.equal(refreshed.data.status, 'passed');
  const trialEndsAt = refreshed.data.trial_ends_at;
  assert.ok(trialIsFourteenDays(trialEndsAt), `trial runs 14 days from now, got ${trialEndsAt}`);
  // A second refresh (or a webhook, or the reconcile job) changes nothing more.
  const again = await c.post(refreshUrl(billingId));
  assert.equal(again.data.status, 'passed');
  assert.equal(again.data.trial_ends_at, trialEndsAt);

  me = (await c.get('/api/auth/me')).data.user;
  assert.equal(me.plan.read_only, false);
  assert.equal(me.plan.reason, null);
  assert.deepEqual(me.card, { brand: 'visa', last4: '0007' });
  const passed = await orgOf(email);
  assert.equal(passed.card_check, 'passed');
  assert.equal(passed.renewal_plan, 'growth');
  assert.equal(passed.auto_renew, true);
  const passAudits = await sql(
    `SELECT 1 FROM audit_logs WHERE organization_id = $1 AND action = 'billing.card_check_passed'`, [passed.organization_id]);
  assert.equal(passAudits.length, 1, 'one audit row for the card check, however many refreshes ran');

  // Writes work now.
  const property = await c.post('/api/properties', PROPERTY);
  assert.equal(property.status, 201, JSON.stringify(property.data));

  // Trial end minus 3 days: the reminder job sends exactly one email (Stage 2 wording, because automatic payment is on).
  const at3 = new Date(Date.parse(trialEndsAt) - 3 * 86400000);
  const beforeReminder = reminderMails(email).length;
  await sendTrialReminders(at3);
  const sent = reminderMails(email);
  assert.equal(sent.length - beforeReminder, 1, 'exactly one reminder at 3 days before the trial ends');
  assert.match(sent.at(-1).subject, /^Your BalayHub plan starts on /);
  assert.match(sent.at(-1).text, /We'll charge ₱999\.00 for Growth to your Visa ending 0007/);
  await sendTrialReminders(at3);
  assert.equal(reminderMails(email).length - beforeReminder, 1, 'a second run the same day sends nothing more');

  // Trial end: the subscription job creates exactly one PayMongo subscription on the saved card.
  await sql('UPDATE organizations SET trial_ends_at = now() WHERE organization_id = $1', [passed.organization_id]);
  assert.equal(await subscriptions.startDue(), 1, 'one subscription created at trial end');
  assert.equal(await subscriptions.startDue(), 0, 'a second job run creates no second subscription');
  const subCreates = fake.calls.filter((x) => x.method === 'POST' && x.path === '/subscriptions'
    && x.body?.data?.attributes?.customer_id === passed.paymongo_customer_id);
  assert.equal(subCreates.length, 1, 'PayMongo saw one subscription create for this workspace');
  const subId = (await orgOf(email)).paymongo_subscription_id;
  assert.ok(subId, 'the subscription id is stored');
  const afterSub = await orgOf(email);
  assert.equal(afterSub.subscription_status, 'incomplete');
  assert.equal(await paidUntil(passed.organization_id), null, 'paid_until is still empty during the trial');

  // The first monthly invoice is paid: the webhook (body never trusted, re-read at PayMongo) extends paid_until one period.
  const { event } = fake.payInvoice(subId);
  const raw = JSON.stringify(event);
  const hook = (body) => fetch(`${srv.base}/api/public/paymongo/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Paymongo-Signature': fake.signedHeader(body, 'whsk_test') },
    body,
  });
  assert.equal((await hook(raw)).status, 200);
  const paid = await orgOf(email);
  assert.equal(paid.plan, 'growth');
  assert.equal(paid.subscription_status, 'active');
  const paidTo = await paidUntil(paid.organization_id);
  assert.ok(paidTo, 'paid_until is set after the invoice');
  assert.ok(oneMonthSpan(manilaToday(), paidTo), `one month from today, got ${paidTo}`);
  const invoiceId = event.data.attributes.data.id;
  const [inv] = await sql(
    `SELECT kind, plan, months, provider, status, period_start::text AS ps, period_end::text AS pe
       FROM billing_payments WHERE invoice_id = $1`, [invoiceId]);
  assert.deepEqual(
    { kind: inv.kind, plan: inv.plan, months: inv.months, provider: inv.provider, status: inv.status },
    { kind: 'plan', plan: 'growth', months: 1, provider: 'paymongo_subscription', status: 'paid' });
  assert.equal(inv.ps, manilaToday());
  assert.equal(inv.pe, paidTo);
  // Replayed webhook: no second month, one invoice row.
  assert.equal((await hook(raw)).status, 200);
  assert.equal(await paidUntil(paid.organization_id), paidTo, 'a replayed invoice adds no month');
  assert.equal((await sql('SELECT 1 FROM billing_payments WHERE invoice_id = $1', [invoiceId])).length, 1);
  const bill = (await c.get('/api/billing')).data;
  assert.equal(bill.auto_renew.on, true);
  assert.equal(bill.auto_renew.status, 'active');

  // Cancel automatic payment: the subscription stops, and paid_until does not move.
  const cancel = await c.patch('/api/billing/renewal', { auto_renew: false });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
  assert.equal(cancel.data.auto_renew.on, false);
  assert.equal(cancel.data.auto_renew.status, 'cancelled');
  assert.equal(fake.state.subscriptions.get(subId).attributes.status, 'cancelled', 'PayMongo cancelled the subscription');
  assert.equal(await paidUntil(paid.organization_id), paidTo, 'paid_until is unchanged by cancelling');
  assert.equal(await subscriptions.startDue(), 0, 'a cancelled workspace is not subscribed again');
});

test('story 2, Stage 2 off: the saved card pays the plan in one tap at trial end; no subscription call is made', async () => {
  config.paymongoSubscriptions = false;
  const subCallsAtStart = subscriptionCalls().length;
  const email = 'flow-stage1@example.com';
  const c = await ownerWorkspace(email, 'Dela Cruz Rentals');

  // Stage 2 off: no consent tick is needed.
  const start = await c.post('/api/billing/card-check/start', { renewal_plan: 'growth' });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const billingId = start.data.billing_id;
  const attach = await c.post(attachUrl(billingId), { payment_method_id: fake.createPaymentMethod(cardOf(TEST_CARDS.ok)) });
  assert.equal(attach.status, 200, JSON.stringify(attach.data));
  assert.equal(attach.data.status, 'passed');
  assert.ok(trialIsFourteenDays(attach.data.trial_ends_at), `trial runs 14 days from now, got ${attach.data.trial_ends_at}`);
  const org = await orgOf(email);
  assert.equal(org.auto_renew, false);

  // Reminder at trial end minus 3 days: the Stage 1 wording, and nothing says a charge will happen automatically.
  const at3 = new Date(Date.parse(attach.data.trial_ends_at) - 3 * 86400000);
  const beforeReminder = reminderMails(email).length;
  await sendTrialReminders(at3);
  const sent = reminderMails(email);
  assert.equal(sent.length - beforeReminder, 1, 'exactly one reminder at 3 days');
  assert.match(sent.at(-1).subject, /^Your BalayHub trial ends on /);
  assert.match(sent.at(-1).text, /pay for Growth \(₱999\.00 a month\)/);
  assert.match(sent.at(-1).text, /Your Visa ending 4345 is saved, so it takes one tap/);
  assert.doesNotMatch(sent.at(-1).text, /We'll charge/);

  // Trial end: the subscription job does nothing while Stage 2 is off.
  await sql('UPDATE organizations SET trial_ends_at = now() WHERE organization_id = $1', [org.organization_id]);
  assert.equal(await subscriptions.startDue(), 0);

  // One tap: the saved card pays Growth for one month, with the host present.
  const pay = await c.post('/api/billing/pay-saved', { plan: 'growth', months: '1' });
  assert.equal(pay.status, 200, JSON.stringify(pay.data));
  assert.equal(pay.data.status, 'paid');
  const paidTo = await paidUntil(org.organization_id);
  assert.equal(pay.data.paid_until, paidTo, 'the answer gives the same paid_until the database holds');
  assert.ok(oneMonthSpan(manilaToday(), paidTo), `one month from today, got ${paidTo}`);

  // The charge: one ₱999.00 Payment Intent for this payment, the saved card attached with the secret key, nothing new saved.
  const [pi] = await sql('SELECT payment_intent_id, status, period_start::text AS ps FROM billing_payments WHERE billing_id = $1', [pay.data.billing_id]);
  assert.equal(pi.status, 'paid');
  assert.equal(pi.ps, manilaToday());
  const intents = fake.calls.filter((x) => x.method === 'POST' && x.path === '/payment_intents'
    && x.body?.data?.attributes?.metadata?.billing_id === pay.data.billing_id);
  assert.equal(intents.length, 1, 'one Payment Intent for the one-tap payment');
  assert.equal(intents[0].body.data.attributes.amount, 99900);
  assert.equal(intents[0].body.data.attributes.setup_future_usage, undefined, 'a one-tap payment saves no new card');
  const attaches = fake.calls.filter((x) => x.method === 'POST' && x.path === `/payment_intents/${pi.payment_intent_id}/attach`);
  assert.equal(attaches.length, 1);
  assert.equal(attaches[0].auth, 'secret');

  // The plan is active, and this whole story made no call to /subscriptions.
  const me = (await c.get('/api/auth/me')).data.user;
  assert.equal(me.plan.plan, 'growth');
  assert.equal(me.plan.read_only, false);
  assert.equal(me.plan.paid_until, paidTo);
  const bill = (await c.get('/api/billing')).data;
  assert.equal(bill.subscriptions, false);
  assert.ok(bill.history.some((h) => h.billing_id === pay.data.billing_id && h.kind === 'plan'
    && h.status === 'paid' && h.provider === 'paymongo_intent'), 'the one-tap payment is in Plan & billing history');
  assert.equal(subscriptionCalls().length, subCallsAtStart, 'Stage 2 off: no request to any /subscriptions path');
});

test('story 3, declined card: attach is 402, the trial does not start, the workspace stays gated', async () => {
  config.paymongoSubscriptions = false;
  const email = 'flow-decline@example.com';
  const c = await ownerWorkspace(email, 'Declined Stays');
  const start = await c.post('/api/billing/card-check/start', { renewal_plan: 'starter' });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const billingId = start.data.billing_id;

  const declined = await c.post(attachUrl(billingId), { payment_method_id: fake.createPaymentMethod(cardOf(TEST_CARDS.declined)) });
  assert.equal(declined.status, 402, JSON.stringify(declined.data));
  assert.equal(declined.data.status, 'failed');
  assert.equal(declined.data.message, 'Your card was declined. Try another card, or ask your bank.');

  // Still gated: the check is still open on the same row, and no card or trial was saved.
  const check = (await c.get('/api/billing/card-check')).data;
  assert.equal(check.required, true);
  assert.equal(check.status, 'required');
  assert.equal(check.pending.billing_id, billingId);
  const me = (await c.get('/api/auth/me')).data.user;
  assert.equal(me.plan.reason, 'card_check');
  assert.equal(me.plan.card_check_due, true);
  assert.equal(me.plan.trial_ends_at, null);
  assert.equal(me.card, null);
  assert.equal((await c.get('/api/billing')).data.card, null);
  const blocked = await c.post('/api/properties', PROPERTY);
  assert.equal(blocked.status, 402);
  assert.equal(blocked.data.code, 'CARD_CHECK_REQUIRED');

  const org = await orgOf(email);
  assert.equal(org.card_check, 'required');
  assert.equal(org.trial_ends_at, null);
  assert.equal(org.card_payment_method_id, null);
  const [row] = await sql('SELECT status, failure_code FROM billing_payments WHERE billing_id = $1', [billingId]);
  assert.deepEqual(row, { status: 'pending', failure_code: 'card_declined' });
  // PayMongo saw exactly one Payment Intent for this check.
  const intents = fake.calls.filter((x) => x.method === 'POST' && x.path === '/payment_intents'
    && x.body?.data?.attributes?.metadata?.billing_id === billingId);
  assert.equal(intents.length, 1);
});
