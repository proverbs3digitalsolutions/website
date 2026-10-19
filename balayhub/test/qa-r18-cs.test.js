'use strict';

// attach() locks the billing row and re-checks 'pending' under the lock (two tabs must not pay ₱20 twice).
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_27 node --test --test-concurrency=1 test/qa-r18-cs.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql } = require('./helpers');
const { install, TEST_CARDS } = require('./fakes/paymongo');
const cardcheck = require('../src/lib/cardcheck');
const { pool } = require('../src/db');

let srv; let fake;
test.before(async () => { fake = install({ realFetch: globalThis.fetch }); srv = await startServer(); });
test.after(async () => { fake.uninstall(); await srv.close(); });

test('attach waits for the billing row lock and refuses once the row is no longer pending', async () => {
  const [o] = await sql(`INSERT INTO organizations (name, plan, card_check) VALUES ('Lock Stays', 'trial', 'required') RETURNING organization_id`);
  const [usr] = await sql(`INSERT INTO users (full_name, email, password_hash, organization_id, role, email_verified_at) VALUES ('Lock Owner', 'lock@example.com', 'x', $1, 'owner', now()) RETURNING *`, [o.organization_id]);
  const { billing_id: id } = await cardcheck.start(usr, { renewalPlan: 'growth' });
  const m = fake.createPaymentMethod({ card_number: TEST_CARDS.ok, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });
  const before = fake.calls.filter((x) => /\/attach$/.test(x.path)).length;

  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT 1 FROM billing_payments WHERE billing_id = $1 FOR UPDATE', [id]);
    const pending = cardcheck.attach(usr, id, m).catch((e) => e);
    await new Promise((r) => setTimeout(r, 300)); // attach is now parked on the row lock
    await holder.query(`UPDATE billing_payments SET status = 'expired' WHERE billing_id = $1`, [id]);
    await holder.query('COMMIT');
    const err = await pending;
    assert.equal(err.status, 409);
    assert.equal(err.extra?.code ?? err.code, 'CARD_CHECK_NOT_REQUIRED');
  } finally { holder.release(); }
  assert.equal(fake.calls.filter((x) => /\/attach$/.test(x.path)).length, before, 'no attach call reached PayMongo');
});

async function setup(name, email) {
  const [o] = await sql(`INSERT INTO organizations (name, plan, card_check) VALUES ($1, 'trial', 'required') RETURNING organization_id`, [name]);
  const [usr] = await sql(`INSERT INTO users (full_name, email, password_hash, organization_id, role, email_verified_at) VALUES ($1, $2, 'x', $3, 'owner', now()) RETURNING *`, [name, email, o.organization_id]);
  const { billing_id: id } = await cardcheck.start(usr, { renewalPlan: 'growth' });
  return { usr, id, o };
}
const mkCard = (number) => fake.createPaymentMethod({ card_number: number, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });
const attachCalls = () => fake.calls.filter((x) => /\/attach$/.test(x.path)).length;

test('two parallel attaches on one pending check send exactly one attach to PayMongo', async () => {
  const { usr, id, o } = await setup('Twin Tabs', 'twin@example.com');
  const m1 = mkCard(TEST_CARDS.ok); const m2 = mkCard(TEST_CARDS.ok);
  const before = attachCalls();
  const holder = await pool.connect();
  let results;
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT 1 FROM billing_payments WHERE billing_id = $1 FOR UPDATE', [id]);
    const a = cardcheck.attach(usr, id, m1).catch((e) => e);
    const b = cardcheck.attach(usr, id, m2).catch((e) => e);
    await new Promise((r) => setTimeout(r, 300)); // both parked on the row lock
    await holder.query('COMMIT');
    results = await Promise.all([a, b]);
  } finally { holder.release(); }
  assert.equal(attachCalls() - before, 1, 'only one attach reached PayMongo');
  assert.equal(results.filter((r) => r.status === 'passed').length, 1);
  for (const r of results) assert.ok(r.status === 'passed' || r.status === 409, JSON.stringify(r));
  assert.equal((await sql(`SELECT count(*)::int AS n FROM billing_payments WHERE billing_id = $1 AND status = 'paid'`, [id]))[0].n, 1);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'billing.card_check_passed' AND record_id = $1`, [id]))[0].n, 1);
  assert.equal((await sql('SELECT card_check FROM organizations WHERE organization_id = $1', [o.organization_id]))[0].card_check, 'passed');
});

test('a second attach while the intent awaits the bank (3-D Secure) does not attach again', async () => {
  const { usr, id } = await setup('Bank Wait', 'bankwait@example.com');
  const m1 = mkCard(TEST_CARDS.threeDS); const m2 = mkCard(TEST_CARDS.ok);
  const before = attachCalls();
  const first = await cardcheck.attach(usr, id, m1);
  assert.equal(first.status, 'action_required');
  const second = await cardcheck.attach(usr, id, m2);
  assert.equal(second.status, 'action_required');
  assert.equal(attachCalls() - before, 1, 'second attach never reached PayMongo');
});
