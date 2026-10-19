'use strict';

// Round 19 SEC lane: (1) purge locks billing_payments before the workspace, (2) startOne re-checks auto_renew, the saved
// card and deletion under its lock, (3) 3-D Secure attach scenarios.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_06 node --test --test-concurrency=1 test/qa-r19-sec.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* database.');
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
const { pool } = require('../src/db');
const subs = require('../src/lib/subscriptions');
const account = require('../src/lib/account');
const cardcheck = require('../src/lib/cardcheck');

config.paymongoSubscriptions = true;
const fake = fakes.install({ realFetch: globalThis.fetch });
let srv; let n = 200;
test.before(async () => { srv = await startServer(); });
test.after(async () => { config.paymongoSubscriptions = true; fake.uninstall(); await srv.close(); });

const secret = (method, path, body) => fake.handle(method, path, body, 'secret').body.data;
const card = (number) => ({ card_number: number, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });

// A workspace with a card saved at the fake and an owner (same shape as qa-r18-purge-order).
async function newOrg() {
  n += 1;
  const cus = secret('POST', '/customers', { data: { attributes: { first_name: 'Ana', last_name: 'Reyes', email: `r19sec${n}@example.com` } } });
  const pm = fake.createPaymentMethod(card(fakes.TEST_CARDS.ok));
  const pi = secret('POST', '/payment_intents', { data: { attributes: { amount: 2000, setup_future_usage: { session_type: 'on_session', customer_id: cus.id } } } });
  secret('POST', `/payment_intents/${pi.id}/attach`, { data: { attributes: { payment_method: pm } } });
  const [o] = await sql(
    `INSERT INTO organizations (name, business_type, plan, trial_ends_at, card_check, card_checked_at, paymongo_customer_id, card_payment_method_id,
        card_brand, card_last4, renewal_plan, auto_renew, auto_renew_consented_at)
     VALUES ($1, 'short_term', 'trial', now() + interval '30 minutes', 'passed', now(), $2, $3, 'visa', '0345', 'growth', true, now())
     RETURNING organization_id`, [`R19 Sec ${n}`, cus.id, pm]);
  await sql(`INSERT INTO users (full_name, email, password_hash, organization_id, role, email_verified_at)
             VALUES ('Sec Host', $1, 'x', $2, 'owner', now())`, [`r19-host-${n}@example.com`, o.organization_id]);
  return { id: o.organization_id, cus: cus.id, pm };
}
const subPosts = () => fake.calls.filter((c) => c.method === 'POST' && c.path === '/subscriptions').length;

// ---- (1) purge lock order ----------------------------------------------------------------
test('purge waits for a payment row lock before taking the workspace lock (no deadlock with markPaid)', async () => {
  const w = await newOrg();
  const [b] = await sql(`INSERT INTO billing_payments (organization_id, kind, plan, months, amount, list_amount, discount_amount, provider)
                         VALUES ($1, 'plan', 'growth', 1, 999, 999, 0, 'paymongo_intent') RETURNING billing_id`, [w.id]);
  const a = await pool.connect();
  try {
    // Same order as markPaid: payment row first, then the workspace.
    await a.query('BEGIN');
    await a.query('SELECT 1 FROM billing_payments WHERE billing_id = $1 FOR UPDATE', [b.billing_id]);
    const purging = account.purgeOrganization(w.id);
    purging.catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    await a.query('SELECT 1 FROM organizations WHERE organization_id = $1 FOR UPDATE', [w.id]); // deadlocks if purge already holds the workspace
    await a.query('COMMIT');
    assert.deepEqual(await purging, { deleted: true });
  } finally { await a.query('ROLLBACK').catch(() => {}); a.release(); }
  assert.equal((await sql('SELECT 1 FROM organizations WHERE organization_id = $1', [w.id])).length, 0);
});

// ---- (2) startOne re-checks under its lock ------------------------------------------------
test('startOne starts a subscription for a workspace that is eligible (control)', async () => {
  const w = await newOrg();
  const before = subPosts();
  assert.equal(await subs.startOne(w.id), true);
  assert.equal(subPosts() - before, 1);
});

for (const [name, set] of [
  ['automatic payment was switched off', 'auto_renew = false'],
  ['the saved card was removed', 'card_payment_method_id = NULL, card_brand = NULL, card_last4 = NULL'],
  ['deletion was scheduled', `deletion_scheduled_at = now() + interval '14 days'`],
]) {
  test(`startOne refuses when ${name}`, async () => {
    const w = await newOrg();
    await sql(`UPDATE organizations SET ${set} WHERE organization_id = $1`, [w.id]);
    const before = subPosts();
    assert.equal(await subs.startOne(w.id), false);
    assert.equal(subPosts(), before);
    assert.equal((await sql('SELECT paymongo_subscription_id AS s FROM organizations WHERE organization_id = $1', [w.id]))[0].s, null);
  });
}

// ---- (3) 3-D Secure attach scenarios -----------------------------------------------------
async function gatedWithCheck() {
  n += 1;
  const [o] = await sql(`INSERT INTO organizations (name, plan, card_check) VALUES ($1, 'trial', 'required') RETURNING organization_id`, [`R19 Gate ${n}`]);
  const [u] = await sql(
    `INSERT INTO users (full_name, email, password_hash, organization_id, role, email_verified_at)
     VALUES ('Maria Santos', $1, 'x', $2, 'owner', now()) RETURNING *`, [`r19-gate-${n}@example.com`, o.organization_id]);
  const { billing_id: billingId } = await cardcheck.start(u, { renewalPlan: 'growth', consent: true });
  const [row] = await sql('SELECT payment_intent_id, payment_method FROM billing_payments WHERE billing_id = $1', [billingId]);
  return { u, billingId, piId: row.payment_intent_id };
}
const attachPosts = (piId) => fake.calls.filter((c) => c.method === 'POST' && c.path === `/payment_intents/${piId}/attach`).length;

test('a failed 3-D Secure check lets a new card be attached and the check passes', async () => {
  const g = await gatedWithCheck();
  const first = await cardcheck.attach(g.u, g.billingId, fake.createPaymentMethod(card(fakes.TEST_CARDS.threeDS)));
  assert.equal(first.status, 'action_required');
  assert.equal((await sql('SELECT payment_method AS m FROM billing_payments WHERE billing_id = $1', [g.billingId]))[0].m, 'attached');
  fake.markIntent(g.piId, 'failed'); // the bank gave the intent back
  const second = await cardcheck.attach(g.u, g.billingId, fake.createPaymentMethod(card(fakes.TEST_CARDS.ok)));
  assert.equal(second.status, 'passed');
  assert.equal(attachPosts(g.piId), 2);
  const [o] = await sql('SELECT card_check, card_last4 FROM organizations WHERE organization_id = $1', [g.u.organization_id]);
  assert.equal(o.card_check, 'passed');
  assert.equal(o.card_last4, '4345');
});

test('a succeeded 3-D Secure check answers a second attach as passed without attaching a second card', async () => {
  const g = await gatedWithCheck();
  const first = await cardcheck.attach(g.u, g.billingId, fake.createPaymentMethod(card(fakes.TEST_CARDS.threeDS)));
  assert.equal(first.status, 'action_required');
  fake.markIntent(g.piId, 'succeeded'); // approved at the bank, the browser has not refreshed yet
  const second = await cardcheck.attach(g.u, g.billingId, fake.createPaymentMethod(card(fakes.TEST_CARDS.ok)));
  assert.equal(second.status, 'passed');
  assert.equal(attachPosts(g.piId), 1);
  assert.equal((await sql('SELECT card_check FROM organizations WHERE organization_id = $1', [g.u.organization_id]))[0].card_check, 'passed');
});
