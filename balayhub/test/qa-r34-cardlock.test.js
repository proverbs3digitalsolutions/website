'use strict';

process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql } = require('./helpers');
const { install } = require('./fakes/paymongo');
const cardcheck = require('../src/lib/cardcheck');

let srv; let fake; let n = 0;
test.before(async () => { fake = install({ realFetch: globalThis.fetch }); srv = await startServer(); });
test.after(async () => { fake.uninstall(); await srv.close(); });

async function gated(deleting) {
  n += 1;
  const [o] = await sql(
    `INSERT INTO organizations (name, plan, card_check, deletion_scheduled_at)
     VALUES ($1, 'trial', 'required', ${deleting ? "now() + interval '7 days'" : 'NULL'}) RETURNING organization_id`, [`Lock ${n}`]);
  const [u] = await sql(
    `INSERT INTO users (full_name, email, password_hash, organization_id, role, email_verified_at)
     VALUES ('Maria Santos', $1, 'x', $2, 'owner', now()) RETURNING *`, [`lock${n}@example.com`, o.organization_id]);
  return u;
}

test('start refuses a workspace scheduled for deletion (stale session): no row, no PayMongo call', async () => {
  const u = await gated(true);
  const before = fake.calls.length;
  await assert.rejects(cardcheck.start(u, { renewalPlan: 'growth' }), (e) => {
    assert.equal(e.status, 409);
    assert.equal(e.extra.code, 'DELETION_SCHEDULED');
    assert.match(e.message, /scheduled for deletion, so the card check is turned off/);
    return true;
  });
  assert.equal(fake.calls.length, before);
  assert.equal((await sql(`SELECT 1 FROM billing_payments WHERE organization_id = $1`, [u.organization_id])).length, 0);
});

test('control: start still works when no deletion is scheduled', async () => {
  const u = await gated(false);
  const r = await cardcheck.start(u, { renewalPlan: 'growth' });
  assert.ok(r.billing_id);
});
