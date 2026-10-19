'use strict';
// Migration 037 (D-98): card on file before the free trial.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://balayhub:balayhub@localhost:5432/balayhub_test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');
const { migrate } = require('../scripts/migrate');
const account = require('../src/lib/account');

const sql = async (q, p) => (await pool.query(q, p)).rows;
const bad = (q, p) => assert.rejects(sql(q, p), /check|violates|unique|duplicate/i);
let oldOrg; let org; let org2;
const mkOrg = async (n) => (await sql('INSERT INTO organizations (name) VALUES ($1) RETURNING organization_id', [n]))[0].organization_id;
const card = (o, status = 'pending', amount = 20, extra = '') => sql(
  `INSERT INTO billing_payments (organization_id, kind, amount, provider, status ${extra ? ',' + extra.split('=')[0] : ''}) VALUES ($1,'card_check',$2,'paymongo_intent',$3 ${extra ? ',' + extra.split('=')[1] : ''}) RETURNING *`, [o, amount, status]);

test.before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  // Build the schema up to 036, add a workspace, then let the runner apply 037 on top.
  await pool.query('CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (f >= '037') break;
    await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
  }
  oldOrg = await mkOrg('Existing host');
  await sql(`INSERT INTO billing_payments (organization_id, plan, months, amount) VALUES ($1,'growth',1,999)`, [oldOrg]);
  await migrate({ quiet: true });
  org = await mkOrg('New host'); org2 = await mkOrg('Other host');
});
test.after(async () => { await pool.end(); });

test('037: applies once, re-running the runner is a no-op', async () => {
  await migrate({ quiet: true });
  assert.equal((await sql(`SELECT 1 FROM schema_migrations WHERE name = '037_card_on_file.sql'`)).length, 1);
});

test('037: existing workspaces are grandfathered (card check not required)', async () => {
  const [o] = await sql('SELECT card_check, card_checked_at, auto_renew, renewal_plan, paymongo_customer_id FROM organizations WHERE organization_id = $1', [oldOrg]);
  assert.equal(o.card_check, null);
  assert.equal(o.auto_renew, false);
  assert.equal(o.card_checked_at, null);
  assert.equal(o.renewal_plan, null);
  const [p] = await sql(`SELECT kind, payment_intent_id FROM billing_payments WHERE organization_id = $1`, [oldOrg]);
  assert.equal(p.kind, 'plan');
  assert.equal(p.payment_intent_id, null);
  assert.equal((await sql('SELECT 1 FROM organizations WHERE card_check IS NOT NULL')).length, 0);
});

test('037: organisation card constraints', async () => {
  await bad(`UPDATE organizations SET card_last4 = '42a2' WHERE organization_id = $1`, [org]);
  await bad(`UPDATE organizations SET card_last4 = '424' WHERE organization_id = $1`, [org]);
  await bad(`UPDATE organizations SET card_check = 'maybe' WHERE organization_id = $1`, [org]);
  await bad(`UPDATE organizations SET card_check = 'passed' WHERE organization_id = $1`, [org]);          // needs card_checked_at
  await bad(`UPDATE organizations SET auto_renew = true WHERE organization_id = $1`, [org]);               // needs consent time
  await bad(`UPDATE organizations SET renewal_plan = 'gold' WHERE organization_id = $1`, [org]);
  await bad(`UPDATE organizations SET subscription_status = 'weird' WHERE organization_id = $1`, [org]);
  await bad(`UPDATE organizations SET card_brand = repeat('x', 21) WHERE organization_id = $1`, [org]);
  await sql(`UPDATE organizations SET card_check = 'passed', card_checked_at = now(), card_brand = 'visa', card_last4 = '4242', renewal_plan = 'growth',
    auto_renew = true, auto_renew_consented_at = now(), paymongo_subscription_id = 'sub_1', subscription_status = 'active' WHERE organization_id = $1`, [org]);
  await bad(`UPDATE organizations SET paymongo_subscription_id = 'sub_1' WHERE organization_id = $1`, [org2]);   // unique
  await sql(`UPDATE organizations SET card_check = 'required' WHERE organization_id = $1`, [org2]);
  await sql(`UPDATE organizations SET card_check = 'waived' WHERE organization_id = $1`, [org2]);
});

test('037: card check payment rows', async () => {
  await bad(`INSERT INTO billing_payments (organization_id, kind, plan, months, amount, provider) VALUES ($1,'card_check','growth',1,20,'paymongo_intent')`, [org]); // plan set
  await bad(`INSERT INTO billing_payments (organization_id, kind, amount, provider) VALUES ($1,'card_check',19,'paymongo_intent')`, [org]);                         // amount 19
  await bad(`INSERT INTO billing_payments (organization_id, kind, amount, provider) VALUES ($1,'card_check',20,'paymongo')`, [org]);                                // wrong provider
  await bad(`INSERT INTO billing_payments (organization_id, kind, amount, provider) VALUES ($1,'plan',999,'paymongo')`, [org]);                                     // plan row needs plan
  await bad(`INSERT INTO billing_payments (organization_id, kind, plan, months, amount) VALUES ($1,'refund','growth',1,999)`, [org]);
  await bad(`INSERT INTO billing_payments (organization_id, plan, months, amount, failure_code) VALUES ($1,'growth',1,999,repeat('x',65))`, [org]);
  await sql(`INSERT INTO billing_payments (organization_id, plan, months, amount, provider) VALUES ($1,'growth',1,999,'paymongo_subscription')`, [org]);        // provider accepted
  await sql(`INSERT INTO billing_payments (organization_id, plan, months, amount, provider) VALUES ($1,'growth',1,999,'paymongo_intent')`, [org]);
  await bad(`INSERT INTO billing_payments (organization_id, plan, months, amount, provider) VALUES ($1,'growth',1,999,'stripe')`, [org]);
  // A coupon row still needs provider coupon to be free (035 rule kept).
  await bad(`INSERT INTO billing_payments (organization_id, plan, months, amount) VALUES ($1,'growth',1,0)`, [org]);
});

test('037: one live card check per workspace; a paid one does not block a new pending one', async () => {
  const [a] = await card(org, 'pending');
  assert.equal(a.kind, 'card_check');
  assert.equal(a.plan, null);
  await bad(`INSERT INTO billing_payments (organization_id, kind, amount, provider) VALUES ($1,'card_check',20,'paymongo_intent')`, [org]);
  await card(org2, 'pending');                                   // another workspace is independent
  await sql(`UPDATE billing_payments SET status = 'paid', paid_at = now() WHERE billing_id = $1`, [a.billing_id]);
  await card(org, 'pending');
  await sql(`UPDATE billing_payments SET status = 'expired' WHERE organization_id = $1 AND status = 'pending'`, [org]);
  await card(org, 'pending');
});

test('037: payment intent and invoice ids are unique', async () => {
  await sql(`UPDATE billing_payments SET payment_intent_id = 'pi_one' WHERE organization_id = $1 AND kind = 'card_check' AND status = 'paid'`, [org]);
  await bad(`UPDATE billing_payments SET payment_intent_id = 'pi_one' WHERE organization_id = $1 AND status = 'pending'`, [org2]);
  await sql(`UPDATE billing_payments SET invoice_id = 'inv_one' WHERE organization_id = $1 AND provider = 'paymongo_subscription'`, [org]);
  await bad(`UPDATE billing_payments SET invoice_id = 'inv_one' WHERE organization_id = $1 AND provider = 'paymongo_intent' AND kind = 'plan'`, [org]);
});

test('037: paymongo_plans is platform-level, not purged; billing_payments is', async () => {
  await sql(`INSERT INTO paymongo_plans (plan_key, amount_c, paymongo_plan_id) VALUES ('growth', 99900, 'plan_1')`);
  await bad(`INSERT INTO paymongo_plans (plan_key, amount_c, paymongo_plan_id) VALUES ('growth', 99900, 'plan_2')`);   // pk
  await bad(`INSERT INTO paymongo_plans (plan_key, amount_c, paymongo_plan_id) VALUES ('pro', 99, 'plan_3')`);         // amount floor
  await bad(`INSERT INTO paymongo_plans (plan_key, amount_c, paymongo_plan_id) VALUES ('gold', 5000, 'plan_4')`);
  await bad(`INSERT INTO paymongo_plans (plan_key, amount_c, paymongo_plan_id) VALUES ('pro', 5000, 'plan_1')`);       // unique id
  assert.ok(!account.PURGED_TABLES.includes('paymongo_plans'));
  assert.ok(account.PURGED_TABLES.includes('billing_payments'));
  const cols = (await sql(`SELECT column_name FROM information_schema.columns WHERE table_name = 'paymongo_plans'`)).map((r) => r.column_name);
  assert.ok(!cols.includes('organization_id'));
});

test('037: pending card-check index backs the stale-check lookup', async () => {
  const [i] = await sql(`SELECT indexdef FROM pg_indexes WHERE indexname = 'organizations_card_check_pending_idx'`);
  assert.match(i.indexdef, /card_check = 'required'/);
  const [j] = await sql(`SELECT indexdef FROM pg_indexes WHERE indexname = 'billing_payments_one_live_card_check'`);
  assert.match(j.indexdef, /UNIQUE/);
});
