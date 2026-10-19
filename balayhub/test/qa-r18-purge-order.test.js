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
let srv; let n = 100;
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
const exists = async (id) => (await sql('SELECT 1 FROM organizations WHERE organization_id = $1', [id])).length === 1;

test('a failed delete leaves the card attached and the customer present', async () => {
  const w = await newOrg();
  await sql(`CREATE OR REPLACE FUNCTION r18_block_delete() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'r18 blocked'; END $$ LANGUAGE plpgsql`);
  await sql(`CREATE TRIGGER r18_block BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION r18_block_delete()`);
  try {
    await assert.rejects(account.purgeOrganization(w.id), /r18 blocked/);
  } finally { await sql('DROP TRIGGER r18_block ON users'); }
  assert.equal(await exists(w.id), true);
  assert.equal(savedMethods(w.cus).includes(w.pm), true);
  assert.equal(fake.state.customers.has(w.cus), true);
});

test('a second purge of an already deleted workspace returns gone', async () => {
  const w = await newOrg();
  assert.deepEqual(await account.purgeOrganization(w.id), { deleted: true });
  assert.equal(fake.state.customers.has(w.cus), false);
  assert.deepEqual(await account.purgeOrganization(w.id), { deleted: false, reason: 'gone' });
});

test('scheduledOnly skips a workspace whose deletion was cancelled after selection', async () => {
  const w = await newOrg();
  await sql('UPDATE organizations SET deletion_scheduled_at = now() - interval \'1 minute\' WHERE organization_id = $1', [w.id]);
  await sql('UPDATE organizations SET deletion_scheduled_at = NULL WHERE organization_id = $1', [w.id]); // restored
  assert.deepEqual(await account.purgeOrganization(w.id, { scheduledOnly: true }), { deleted: false, reason: 'not_due' });
  await sql('UPDATE organizations SET deletion_scheduled_at = now() + interval \'1 day\' WHERE organization_id = $1', [w.id]);
  assert.deepEqual(await account.purgeOrganization(w.id, { scheduledOnly: true }), { deleted: false, reason: 'not_due' });
  assert.equal(await exists(w.id), true);
  assert.equal(savedMethods(w.cus).includes(w.pm), true);
  await sql('UPDATE organizations SET deletion_scheduled_at = now() - interval \'1 minute\' WHERE organization_id = $1', [w.id]);
  assert.deepEqual(await account.purgeOrganization(w.id, { scheduledOnly: true }), { deleted: true });
});
