'use strict';

process.env.PAYMONGO_SECRET_KEY = 'sk_test_fake';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_fake';
process.env.PAYMONGO_SUBSCRIPTIONS = 'on';
process.env.SMTP_URL = 'test://';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql } = require('./helpers');
const fakes = require('./fakes/paymongo');
const config = require('../src/config');
const subs = require('../src/lib/subscriptions');
const { outbox } = require('../src/lib/mailer');

config.paymongoSubscriptions = true; // in case the config lane has not added the switch yet
const realFetch = globalThis.fetch;
const fake = fakes.install({ realFetch });
let srv; let n = 0;
test.before(async () => { srv = await startServer(); });
test.after(async () => { fake.uninstall(); await srv.close(); });

const subCalls = (re = /^\/subscriptions/) => fake.calls.filter((c) => re.test(c.path) && c.method === 'POST');
const secret = (method, path, body) => fake.handle(method, path, body, 'secret').body.data;

// A workspace whose trial ends in 30 minutes, with a card saved at the (fake) PayMongo.
async function newOrg({ consent = true, plan = 'trial', extra = '' } = {}) {
  n += 1;
  const cus = secret('POST', '/customers', { data: { attributes: { first_name: 'Ana', last_name: 'Reyes', email: `sub${n}@example.com` } } });
  const pm = fake.createPaymentMethod({ card_number: fakes.TEST_CARDS.ok, exp_month: 12, exp_year: 2031, cvc: '123' });
  const pi = secret('POST', '/payment_intents', { data: { attributes: { amount: 2000, setup_future_usage: { session_type: 'on_session', customer_id: cus.id } } } });
  secret('POST', `/payment_intents/${pi.id}/attach`, { data: { attributes: { payment_method: pm } } });
  const [o] = await sql(
    `INSERT INTO organizations (name, business_type, plan, trial_ends_at, card_check, card_checked_at, paymongo_customer_id, card_payment_method_id,
        card_brand, card_last4, renewal_plan, auto_renew, auto_renew_consented_at)
     VALUES ($1, 'short_term', $2, now() + interval '30 minutes', 'passed', now(), $3, $4, 'visa', '0345', 'growth', $5, CASE WHEN $5 THEN now() END)
     RETURNING organization_id`, [`Sub Stays ${n}`, plan, cus.id, pm, consent]);
  await sql(`INSERT INTO users (full_name, email, password_hash, organization_id, role, email_verified_at)
             VALUES ('Sub Host', $1, 'x', $2, 'owner', now())`, [`sub-host-${n}@example.com`, o.organization_id]);
  return o.organization_id;
}
const orgRow = async (id) => (await sql('SELECT paymongo_subscription_id AS sid, subscription_status AS st, paid_until::text, plan FROM organizations WHERE organization_id = $1', [id]))[0];
// Only this file's workspaces exist in its database, so the job's count is for the one just made.
const reset = async () => { await sql(`UPDATE organizations SET auto_renew = false, subscription_status = 'cancelled' WHERE paymongo_subscription_id IS NOT NULL`); await sql(`UPDATE organizations SET auto_renew = false`); };

test('flag off: startDue returns 0 and calls PayMongo not at all', async () => {
  await newOrg();
  config.paymongoSubscriptions = false;
  const before = fake.calls.length;
  assert.equal(await subs.startDue(), 0);
  assert.equal(fake.calls.length, before);
  config.paymongoSubscriptions = true;
  await reset();
});

test('a due workspace gets exactly one subscription; the PayMongo plan is made once and cached', async () => {
  const id = await newOrg();
  const plans0 = subCalls(/^\/subscriptions\/plans$/).length;
  const subs0 = subCalls(/^\/subscriptions$/).length;
  assert.equal(await subs.startDue(), 1);
  assert.equal(await subs.startDue(), 0);
  assert.equal(subCalls(/^\/subscriptions$/).length - subs0, 1);
  assert.equal(subCalls(/^\/subscriptions\/plans$/).length - plans0, 1);
  const body = subCalls(/^\/subscriptions$/).at(-1).body.data.attributes;
  const o = await orgRow(id);
  assert.match(o.sid, /^sub_/);
  assert.equal(o.st, 'incomplete');
  assert.equal(fake.state.plans.get(body.plan_id).amount, 99900);
  // ensurePlan again for the same price: cached, no call
  const calls0 = fake.calls.length;
  assert.equal(await subs.ensurePlan('growth', 99900), body.plan_id);
  assert.equal(fake.calls.length, calls0);
  await reset();
});

test('a workspace that did not consent gets none', async () => {
  const id = await newOrg({ consent: false });
  const subs0 = subCalls(/^\/subscriptions$/).length;
  assert.equal(await subs.startDue(), 0);
  assert.equal(subCalls(/^\/subscriptions$/).length, subs0);
  assert.equal((await orgRow(id)).sid, null);
});

test('a free coupon month is activated with a coupon row and no subscription', async () => {
  const id = await newOrg();
  await sql(`INSERT INTO platform_coupons (code, name, kind, duration, starts_at) VALUES ('FREEMONTH1', 'Free', 'free', 'once', now() - interval '1 day')`);
  const [cp] = await sql(`SELECT coupon_id FROM platform_coupons WHERE code = 'FREEMONTH1'`);
  await sql(`INSERT INTO platform_coupon_redemptions (coupon_id, organization_id, months_total) VALUES ($1, $2, 1)`, [cp.coupon_id, id]);
  const subs0 = subCalls(/^\/subscriptions$/).length;
  assert.equal(await subs.startDue(), 0);
  assert.equal(subCalls(/^\/subscriptions$/).length, subs0);
  assert.equal((await orgRow(id)).sid, null);
  const rows = await sql(`SELECT provider, status FROM billing_payments WHERE organization_id = $1`, [id]);
  assert.deepEqual(rows, [{ provider: 'coupon', status: 'paid' }]);
  await reset();
});

test('invoice.paid adds one month once; a replay changes nothing; the invoice is re-read from PayMongo', async () => {
  const id = await newOrg();
  await subs.startDue();
  const { sid } = await orgRow(id);
  const { invoiceId, event } = fake.payInvoice(sid);
  await subs.handleEvent(event);
  const first = await orgRow(id);
  assert.equal(first.plan, 'growth');
  assert.equal(first.st, 'active');
  assert.ok(first.paid_until);
  assert.ok(fake.calls.some((c) => c.method === 'GET' && c.path === `/subscriptions/invoices/${invoiceId}`));
  await subs.handleEvent(event);
  assert.deepEqual(await orgRow(id), first);
  const rows = await sql(`SELECT provider, amount::text, status FROM billing_payments WHERE invoice_id = $1`, [invoiceId]);
  assert.deepEqual(rows, [{ provider: 'paymongo_subscription', amount: '999.00', status: 'paid' }]);
  await reset();
});

test('an invoice whose amount is not the plan price is ignored', async () => {
  const id = await newOrg();
  await subs.startDue();
  const { sid } = await orgRow(id);
  const { invoiceId, event } = fake.payInvoice(sid);
  fake.state.invoices.get(invoiceId).attributes.amount = 100;
  const before = await orgRow(id);
  await subs.handleEvent(event);
  assert.deepEqual(await orgRow(id), before);
  assert.equal((await sql('SELECT 1 FROM billing_payments WHERE invoice_id = $1', [invoiceId])).length, 0);
  await reset();
});

test('payment_failed sets past_due and emails the owner once', async () => {
  const id = await newOrg();
  await subs.startDue();
  const { sid } = await orgRow(id);
  const { event } = fake.payInvoice(sid, { failed: true });
  const mails = outbox.length;
  await subs.handleEvent(event);
  assert.equal((await orgRow(id)).st, 'past_due');
  assert.equal(outbox.length, mails + 1);
  assert.match(outbox.at(-1).text, /didn't go through\. Pay now to keep making changes/);
  await subs.handleEvent(event);
  assert.equal(outbox.length, mails + 1);
  await reset();
});

test('cancelForOrg cancels at PayMongo, keeps paid_until, and is a no-op the second time', async () => {
  const id = await newOrg();
  await subs.startDue();
  const { sid } = await orgRow(id);
  const { event } = fake.payInvoice(sid);
  await subs.handleEvent(event);
  const before = await orgRow(id);
  assert.equal(await subs.cancelForOrg(id, null, 'owner turned it off'), true);
  assert.equal(fake.state.subscriptions.get(sid).attributes.status, 'cancelled');
  const after = await orgRow(id);
  assert.equal(after.st, 'cancelled');
  assert.equal(after.paid_until, before.paid_until);
  assert.equal(await subs.cancelForOrg(id, null), false);
  await reset();
});

test('a workspace being deleted has its subscription cancelled by the job', async () => {
  const id = await newOrg();
  await subs.startDue();
  const { sid } = await orgRow(id);
  await sql(`UPDATE organizations SET deletion_scheduled_at = now() WHERE organization_id = $1`, [id]);
  await subs.startDue();
  assert.equal(fake.state.subscriptions.get(sid).attributes.status, 'cancelled');
  await reset();
});
