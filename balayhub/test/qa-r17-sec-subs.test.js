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
const account = require('../src/lib/account');

config.paymongoSubscriptions = true;
const fake = fakes.install({ realFetch: globalThis.fetch });
let srv; let n = 0;
test.before(async () => { srv = await startServer(); });
test.after(async () => { config.paymongoSubscriptions = true; fake.uninstall(); await srv.close(); });

const secret = (method, path, body) => fake.handle(method, path, body, 'secret').body.data;
const savedMethods = (cus) => fake.state.customers.get(cus)?.methods || [];

// A workspace with a card saved at the fake and an owner.
async function newOrg() {
  n += 1;
  const cus = secret('POST', '/customers', { data: { attributes: { first_name: 'Ana', last_name: 'Reyes', email: `sec${n}@example.com` } } });
  const pm = fake.createPaymentMethod({ card_number: fakes.TEST_CARDS.ok, exp_month: 12, exp_year: 2031, cvc: '123' });
  const pi = secret('POST', '/payment_intents', { data: { attributes: { amount: 2000, setup_future_usage: { session_type: 'on_session', customer_id: cus.id } } } });
  secret('POST', `/payment_intents/${pi.id}/attach`, { data: { attributes: { payment_method: pm } } });
  const [o] = await sql(
    `INSERT INTO organizations (name, business_type, plan, trial_ends_at, card_check, card_checked_at, paymongo_customer_id, card_payment_method_id,
        card_brand, card_last4, renewal_plan, auto_renew, auto_renew_consented_at)
     VALUES ($1, 'short_term', 'trial', now() + interval '30 minutes', 'passed', now(), $2, $3, 'visa', '0345', 'growth', true, now())
     RETURNING organization_id`, [`Sec Stays ${n}`, cus.id, pm]);
  await sql(`INSERT INTO users (full_name, email, password_hash, organization_id, role, email_verified_at)
             VALUES ('Sec Host', $1, 'x', $2, 'owner', now())`, [`sec-host-${n}@example.com`, o.organization_id]);
  return { id: o.organization_id, cus: cus.id, pm };
}
const sidOf = async (id) => (await sql('SELECT paymongo_subscription_id AS sid FROM organizations WHERE organization_id = $1', [id]))[0].sid;
const exists = async (id) => (await sql('SELECT 1 FROM organizations WHERE organization_id = $1', [id])).length === 1;

test('Subscriptions switch off: the job still cancels a deleted workspace\'s subscription', async () => {
  const w = await newOrg();
  assert.equal(await subs.startDue(), 1);
  const sid = await sidOf(w.id);
  await sql('UPDATE organizations SET deletion_scheduled_at = now() WHERE organization_id = $1', [w.id]);
  config.paymongoSubscriptions = false;
  try {
    assert.equal(await subs.startDue(), 0);
  } finally { config.paymongoSubscriptions = true; }
  assert.equal(fake.state.subscriptions.get(sid).attributes.status, 'cancelled');
});

test('purging a workspace cancels its live subscription and detaches the saved card', async () => {
  const w = await newOrg();
  assert.equal(await subs.startDue(), 1);
  const sid = await sidOf(w.id);
  assert.equal(savedMethods(w.cus).includes(w.pm), true);
  await account.purgeOrganization(w.id);
  assert.equal(await exists(w.id), false);
  assert.equal(fake.state.subscriptions.get(sid).attributes.status, 'cancelled');
  assert.equal(savedMethods(w.cus).includes(w.pm), false);
});

test('purge is skipped while PayMongo errors on cancel, and a later healthy run purges it', async () => {
  const w = await newOrg();
  assert.equal(await subs.startDue(), 1);
  const sid = await sidOf(w.id);
  fake.failNext(/\/subscriptions\/sub_\w+\/cancel$/, 500);
  await assert.rejects(account.purgeOrganization(w.id));
  assert.equal(await exists(w.id), true);
  assert.equal(await sidOf(w.id), sid);
  await sql('UPDATE organizations SET deletion_scheduled_at = now() WHERE organization_id = $1', [w.id]);
  fake.failNext(/\/subscriptions\/sub_\w+\/cancel$/, 500);
  await account.purgeDue(); // purgeDue swallows the failure per workspace
  assert.equal(await exists(w.id), true);
  await account.purgeDue();
  assert.equal(await exists(w.id), false);
  assert.equal(fake.state.subscriptions.get(sid).attributes.status, 'cancelled');
});

test('purge still finishes when PayMongo errors on card detach', async () => {
  const w = await newOrg();
  fake.failNext(/\/payment_methods\/pm_\w+$/, 500);
  await account.purgeOrganization(w.id);
  assert.equal(await exists(w.id), false);
});

test('purge deletes the PayMongo customer', async () => {
  const w = await newOrg();
  await account.purgeOrganization(w.id);
  assert.equal(fake.state.customers.has(w.cus), false);
});

test('purge still finishes when PayMongo errors on customer delete', async () => {
  const w = await newOrg();
  fake.failNext(/\/customers\/cus_\w+$/, 500);
  await account.purgeOrganization(w.id);
  assert.equal(await exists(w.id), false);
});
