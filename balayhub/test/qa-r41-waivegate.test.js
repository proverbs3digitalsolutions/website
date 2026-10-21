'use strict';

// QA round 41, lane WAIVEGATE: the platform admin's "Skip card check" is refused while a deletion is scheduled (D-116, D-123).
// Shape follows qa-r17-cardcheck-admin. The env var is set before ./helpers loads the app's config.

process.env.PLATFORM_ADMIN_EMAILS = 'boss@example.com';

const { startServer, ownerAccount, sql } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const DELETING = 'This workspace is scheduled for deletion, so the card check is turned off. Cancel the deletion first.';

let srv; let boss; let host; let hostId;
test.before(async () => {
  srv = await startServer();
  boss = await ownerAccount(srv.base, 'boss@example.com', 'BalayHub HQ');
  host = await ownerAccount(srv.base, 'host@example.com', 'Alpha Stays');
  hostId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Alpha Stays'`))[0].organization_id;
});
test.after(async () => { await srv.close(); });

const url = (id) => `/api/admin/workspaces/${id}/card-check`;

// Put the host workspace in a known state: its card check, and whether a deletion is scheduled for 14 days from now.
// A passed check needs card_checked_at (organizations_card_checked_shape).
const reset = (cardCheck, deleting) => sql(
  `UPDATE organizations SET card_check = $2, trial_ends_at = NULL, card_checked_at = CASE WHEN $2 = 'passed' THEN now() END,
     deletion_scheduled_at = $3 WHERE organization_id = $1`,
  [hostId, cardCheck, deleting ? new Date(Date.now() + 14 * 86400000) : null]);
const hostRow = async () => (await sql(
  'SELECT card_check, trial_ends_at, card_checked_at FROM organizations WHERE organization_id = $1', [hostId]))[0];
const waivedAudits = async () => (await sql(
  `SELECT 1 FROM audit_logs WHERE organization_id = $1 AND action = 'platform.card_check_waived'`, [hostId])).length;

test('a workspace scheduled for deletion is refused, and nothing is written', async () => {
  await reset('required', true);
  const before = await waivedAudits();
  const r = await boss.post(url(hostId), { action: 'waive' });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'DELETION_SCHEDULED');
  assert.equal(r.data.error, DELETING);
  const o = await hostRow();
  assert.equal(o.card_check, 'required');
  assert.equal(o.trial_ends_at, null);
  assert.equal(o.card_checked_at, null);
  assert.equal(await waivedAudits(), before);
});

test('a deleting workspace whose check already passed is refused as deleting, not as not-required', async () => {
  await reset('passed', true);
  const r = await boss.post(url(hostId), { action: 'waive' });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'DELETION_SCHEDULED');
  assert.equal((await hostRow()).card_check, 'passed');
});

test('the owner is still refused by the admin route while a deletion is scheduled (404, as before)', async () => {
  await reset('required', true);
  assert.equal((await host.post(url(hostId), { action: 'waive' })).status, 404);
  assert.equal((await hostRow()).card_check, 'required');
});

test('after the deletion is cancelled, the waive works and starts the trial', async () => {
  await reset('required', true);
  const before = await waivedAudits();
  assert.equal((await boss.post(`/api/admin/workspaces/${hostId}/restore`)).status, 200);
  const r = await boss.post(url(hostId), { action: 'waive' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(Date.parse(r.data.trial_ends_at) > Date.now());
  const o = await hostRow();
  assert.equal(o.card_check, 'waived');
  assert.ok(o.trial_ends_at);
  assert.equal(await waivedAudits(), before + 1);
});
