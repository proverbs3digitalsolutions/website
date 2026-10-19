'use strict';

// Card on file, lane B4: platform admin card-check routes (plan sections 3.11 and 5.6).

process.env.PLATFORM_ADMIN_EMAILS = 'boss@example.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, ownerAccount, sql } = require('./helpers');

let srv; let boss; let host; let hostId; let other;
test.before(async () => {
  srv = await startServer();
  boss = await ownerAccount(srv.base, 'boss@example.com', 'BalayHub HQ');
  host = await ownerAccount(srv.base, 'host@example.com', 'Alpha Stays');
  other = await ownerAccount(srv.base, 'other@example.com', 'Beta Stays');
  hostId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Alpha Stays'`))[0].organization_id;
  await sql(`UPDATE organizations SET card_check = 'required', trial_ends_at = NULL, card_brand = 'visa', card_last4 = '4345',
             card_payment_method_id = 'pm_secret', paymongo_customer_id = 'cus_secret' WHERE organization_id = $1`, [hostId]);
});
test.after(async () => { await srv.close(); });

const url = (id) => `/api/admin/workspaces/${id}/card-check`;

test('public plans reports whether the card check is on', async () => {
  const r = await client(srv.base).get('/api/public/plans');
  assert.equal(r.status, 200);
  assert.equal(typeof r.data.card_check, 'boolean');
});

test('list rows carry the card fields, never the ids, and card_pending filters', async () => {
  const all = await boss.get('/api/admin/workspaces');
  const row = all.data.workspaces.find((w) => w.organization_id === hostId);
  assert.equal(row.card_check, 'required');
  assert.equal(row.card_last4, '4345');
  assert.equal(row.card_brand, 'visa');
  assert.equal(row.admin_status, 'card_pending');
  assert.ok(!('card_payment_method_id' in row) && !('paymongo_customer_id' in row));
  assert.equal(all.data.summary.card_pending, 1);
  const f = await boss.get('/api/admin/workspaces?status=card_pending');
  assert.deepEqual(f.data.workspaces.map((w) => w.organization_id), [hostId]);
});

test('only a platform admin can waive', async () => {
  assert.equal((await host.post(url(hostId), { action: 'waive' })).status, 404);
  assert.equal((await client(srv.base).post(url(hostId), { action: 'waive' })).status, 401);
});

test('bad action and unknown workspace', async () => {
  assert.equal((await boss.post(url(hostId), { action: 'nope' })).status, 400);
  assert.equal((await boss.post(url(hostId), {})).status, 400);
  assert.equal((await boss.post(url('00000000-0000-4000-8000-000000000000'), { action: 'waive' })).status, 404);
});

test('waive starts the trial, audits, and a second waive is 409', async () => {
  const r = await boss.post(url(hostId), { action: 'waive' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(Date.parse(r.data.trial_ends_at) > Date.now());
  const o = (await sql('SELECT card_check, trial_ends_at FROM organizations WHERE organization_id = $1', [hostId]))[0];
  assert.equal(o.card_check, 'waived');
  assert.ok(o.trial_ends_at);
  const a = await sql(`SELECT 1 FROM audit_logs WHERE organization_id = $1 AND action = 'platform.card_check_waived'`, [hostId]);
  assert.equal(a.length, 1);
  const again = await boss.post(url(hostId), { action: 'waive' });
  assert.equal(again.status, 409);
  assert.equal(again.data.code, 'CARD_CHECK_NOT_REQUIRED');
  assert.equal((await boss.get('/api/admin/workspaces?status=card_pending')).data.workspaces.length, 0);
});

test('a workspace that never needed the check is 409', async () => {
  const id = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Beta Stays'`))[0].organization_id;
  assert.equal((await boss.post(url(id), { action: 'waive' })).data.code, 'CARD_CHECK_NOT_REQUIRED');
});

test('the demo workspace is 409 DEMO', async () => {
  const id = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Beta Stays'`))[0].organization_id;
  await sql('UPDATE organizations SET is_demo = true WHERE organization_id = $1', [id]);
  const r = await boss.post(url(id), { action: 'waive' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'DEMO');
});
