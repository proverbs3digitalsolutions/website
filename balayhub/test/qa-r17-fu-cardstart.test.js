'use strict';

// Money safety: start() must never make a second Payment Intent while the first one may already be paid.

process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql } = require('./helpers');
const { install, TEST_CARDS } = require('./fakes/paymongo');
const cardcheck = require('../src/lib/cardcheck');

let srv; let fake; let n = 0;
test.before(async () => { fake = install({ realFetch: globalThis.fetch }); srv = await startServer(); });
test.after(async () => { fake.uninstall(); await srv.close(); });

async function gated() {
  n += 1;
  const [o] = await sql(`INSERT INTO organizations (name, plan, card_check) VALUES ($1, 'trial', 'required') RETURNING organization_id`, [`FuStart ${n}`]);
  const [u] = await sql(
    `INSERT INTO users (full_name, email, password_hash, organization_id, role, email_verified_at)
     VALUES ('Maria Santos', $1, 'x', $2, 'owner', now()) RETURNING *`, [`fustart${n}@example.com`, o.organization_id]);
  return u;
}
const org = async (u) => (await sql('SELECT * FROM organizations WHERE organization_id = $1', [u.organization_id]))[0];
const intents = () => fake.calls.filter((c) => c.method === 'POST' && c.path === '/payment_intents').length;
const piOf = async (id) => (await sql('SELECT payment_intent_id FROM billing_payments WHERE billing_id = $1', [id]))[0].payment_intent_id;

test('succeeded at PayMongo but still pending here: start marks it passed, no new intent', async () => {
  const u = await gated();
  const { billing_id } = await cardcheck.start(u, { renewalPlan: 'growth' });
  fake.markIntent(await piOf(billing_id), 'succeeded');
  const before = intents();
  const r = await cardcheck.start(u, { renewalPlan: 'growth' });
  assert.equal(r.status, 'passed');
  assert.equal(r.billing_id, billing_id);
  assert.ok(r.trial_ends_at);
  assert.equal(intents(), before);
  assert.equal((await org(u)).card_check, 'passed');
  assert.equal((await sql('SELECT status FROM billing_payments WHERE billing_id = $1', [billing_id]))[0].status, 'paid');
});

test('awaiting the bank: start returns the same check, no new intent', async () => {
  const u = await gated();
  const { billing_id } = await cardcheck.start(u, { renewalPlan: 'growth' });
  fake.markIntent(await piOf(billing_id), 'processing');
  const before = intents();
  const r = await cardcheck.start(u, { renewalPlan: 'growth' });
  assert.equal(r.billing_id, billing_id);
  assert.notEqual(r.status, 'passed');
  assert.equal(intents(), before);
  assert.equal((await org(u)).card_check, 'required');
});

test('failed at PayMongo: start retires the old row and makes exactly one new intent', async () => {
  const u = await gated();
  const { billing_id } = await cardcheck.start(u, { renewalPlan: 'growth' });
  fake.markIntent(await piOf(billing_id), 'failed');
  const before = intents();
  const r = await cardcheck.start(u, { renewalPlan: 'growth' });
  assert.notEqual(r.billing_id, billing_id);
  assert.equal(intents(), before + 1);
  assert.equal((await sql('SELECT status FROM billing_payments WHERE billing_id = $1', [billing_id]))[0].status, 'expired');
});

test('PayMongo unreachable while checking: 503 and no new intent', async () => {
  const u = await gated();
  const { billing_id } = await cardcheck.start(u, { renewalPlan: 'growth' });
  const before = intents();
  fake.failNext(/^\/payment_intents\/pi_/, 0);
  await assert.rejects(cardcheck.start(u, { renewalPlan: 'growth' }), (e) => e.status === 503 && e.extra.code === 'PAYMENT_PROVIDER_UNAVAILABLE');
  assert.equal(intents(), before);
  assert.equal((await sql('SELECT status FROM billing_payments WHERE billing_id = $1', [billing_id]))[0].status, 'pending');
});

test('view() on reload settles a succeeded-but-pending check', async () => {
  const u = await gated();
  const { billing_id } = await cardcheck.start(u, { renewalPlan: 'growth' });
  fake.markIntent(await piOf(billing_id), 'succeeded');
  const v = await cardcheck.view(u);
  assert.equal(v.status, 'passed');
  assert.equal(v.pending, null);
});

test('reconcile marks a succeeded pending row passed', async () => {
  const u = await gated();
  const { billing_id } = await cardcheck.start(u, { renewalPlan: 'growth' });
  fake.markIntent(await piOf(billing_id), 'succeeded');
  assert.ok((await cardcheck.reconcile()) >= 1);
  const o = await org(u);
  assert.equal(o.card_check, 'passed');
  assert.ok(o.trial_ends_at);
});

const statusOf = async (id) => (await sql('SELECT status FROM billing_payments WHERE billing_id = $1', [id]))[0].status;
const gets = () => fake.calls.filter((c) => c.method === 'GET' && /^\/payment_intents\/pi_/.test(c.path)).length;

test('earlier intent 404s at PayMongo (keys switched): start expires it and makes exactly one new intent', async () => {
  const u = await gated();
  const { billing_id } = await cardcheck.start(u, { renewalPlan: 'growth' });
  const before = intents();
  fake.failNext(/^\/payment_intents\/pi_/, 404);
  const r = await cardcheck.start(u, { renewalPlan: 'growth' });
  assert.notEqual(r.billing_id, billing_id);
  assert.equal(intents(), before + 1);
  assert.equal(await statusOf(billing_id), 'expired');
});

test('earlier intent answers 5xx: 503 and no new intent', async () => {
  const u = await gated();
  const { billing_id } = await cardcheck.start(u, { renewalPlan: 'growth' });
  const before = intents();
  fake.failNext(/^\/payment_intents\/pi_/, 500);
  await assert.rejects(cardcheck.start(u, { renewalPlan: 'growth' }), (e) => e.status === 503);
  assert.equal(intents(), before);
  assert.equal(await statusOf(billing_id), 'pending');
});

test('reconcile expires a stale pending row whose intent 404s', async () => {
  const u = await gated();
  const { billing_id } = await cardcheck.start(u, { renewalPlan: 'growth' });
  await sql(`UPDATE billing_payments SET status = 'expired' WHERE kind = 'card_check' AND status = 'pending' AND billing_id <> $1`, [billing_id]);
  await sql(`UPDATE billing_payments SET created_at = now() - interval '25 hours' WHERE billing_id = $1`, [billing_id]);
  fake.failNext(/^\/payment_intents\/pi_/, 404);
  fake.failNext(/^\/payment_intents\/pi_/, 404);
  await cardcheck.reconcile();
  assert.equal(await statusOf(billing_id), 'expired');
});

test('view() does not re-read PayMongo again within 5 seconds', async () => {
  const u = await gated();
  await cardcheck.start(u, { renewalPlan: 'growth' });
  const before = gets();
  await cardcheck.view(u);
  await cardcheck.view(u);
  await cardcheck.view(u);
  assert.equal(gets() - before, 1);
});
