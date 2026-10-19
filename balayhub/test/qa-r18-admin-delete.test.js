'use strict';

// Platform admin removes workspaces: schedule (14 days, undoable) or delete now.

process.env.PLATFORM_ADMIN_EMAILS = 'boss@example.com, Co-Admin@Example.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, ownerAccount, sql } = require('./helpers');
const account = require('../src/lib/account');

let srv; let boss; let host; let bossOrg; const ids = {};
const orgId = async (name) => (await sql('SELECT organization_id FROM organizations WHERE name = $1', [name]))[0]?.organization_id;
const url = (id, act = 'delete') => `/api/admin/workspaces/${id}/${act}`;
const MISSING = '00000000-0000-4000-8000-000000000000';

test.before(async () => {
  srv = await startServer();
  boss = await ownerAccount(srv.base, 'boss@example.com', 'BalayHub HQ');
  host = await ownerAccount(srv.base, 'host@example.com', 'Alpha Stays');
  await ownerAccount(srv.base, 'b@example.com', 'Beta Stays');
  await ownerAccount(srv.base, 'c@example.com', 'Gamma Stays');
  await ownerAccount(srv.base, 'd@example.com', 'Demo Stays');
  await ownerAccount(srv.base, 'co-admin@example.com', 'Epsilon Stays');
  await ownerAccount(srv.base, 'f@example.com', 'Zeta Stays');
  for (const n of ['BalayHub HQ', 'Alpha Stays', 'Beta Stays', 'Gamma Stays', 'Demo Stays', 'Epsilon Stays', 'Zeta Stays']) ids[n] = await orgId(n);
  bossOrg = ids['BalayHub HQ'];
  await sql('UPDATE organizations SET is_demo = true WHERE organization_id = $1', [ids['Demo Stays']]);
});
test.after(async () => { await srv.close(); });

test('only a platform admin can delete or restore', async () => {
  assert.equal((await host.post(url(ids['Beta Stays']), { mode: 'now', confirm_name: 'Beta Stays' })).status, 404);
  assert.equal((await client(srv.base).post(url(ids['Beta Stays']), { mode: 'now', confirm_name: 'Beta Stays' })).status, 401);
  assert.equal((await host.post(url(ids['Beta Stays'], 'restore'))).status, 404);
  assert.equal((await orgId('Beta Stays')), ids['Beta Stays']);
});

test('unknown id 404, bad mode 400, demo 409, own workspace 409', async () => {
  assert.equal((await boss.post(url(MISSING), { mode: 'now', confirm_name: 'x' })).status, 404);
  assert.equal((await boss.post(url('nope'), { mode: 'now', confirm_name: 'x' })).status, 404);
  const bad = await boss.post(url(ids['Beta Stays']), { mode: 'later', confirm_name: 'Beta Stays' });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.code, 'VALIDATION');
  const demo = await boss.post(url(ids['Demo Stays']), { mode: 'now', confirm_name: 'Demo Stays' });
  assert.equal(demo.status, 409);
  assert.equal(demo.data.code, 'DEMO');
  const own = await boss.post(url(bossOrg), { mode: 'now', confirm_name: 'BalayHub HQ' });
  assert.equal(own.status, 409);
  assert.equal(own.data.code, 'OWN_WORKSPACE');
});

test('the name must match exactly (case-sensitive, trimmed)', async () => {
  for (const confirm_name of ['', 'beta stays', 'Beta', undefined]) {
    const r = await boss.post(url(ids['Beta Stays']), { mode: 'now', confirm_name });
    assert.equal(r.status, 400);
    assert.equal(r.data.fields.confirm_name, 'Type the workspace name exactly to confirm.');
  }
  assert.equal(await orgId('Beta Stays'), ids['Beta Stays']);
});

test('schedule sets the date, locks the owner, audits; a second schedule is 409; restore undoes it', async () => {
  const id = ids['Alpha Stays'];
  const r = await boss.post(url(id), { mode: 'schedule', confirm_name: '  Alpha Stays ' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, true);
  const days = (Date.parse(r.data.deletion_scheduled_at) - Date.now()) / 86400000;
  assert.ok(days > account.GRACE_DAYS - 0.01 && days <= account.GRACE_DAYS, `grace was ${days}`);
  assert.equal((await sql(`SELECT 1 FROM audit_logs WHERE organization_id = $1 AND action = 'platform.workspace_deletion_scheduled'`, [id])).length, 1);

  const list = (await boss.get('/api/admin/workspaces')).data.workspaces.find((w) => w.organization_id === id);
  assert.equal(list.admin_status, 'deleting');
  assert.ok(list.deletion_scheduled_at);

  // The owner is now view-only: a write is refused.
  const write = await host.post('/api/properties', { name: 'Blocked', property_type: 'house' });
  assert.equal(write.status, 402, JSON.stringify(write.data));
  const me = await host.get('/api/auth/me');
  assert.equal(me.data.user.plan.reason, 'deleting');

  const again = await boss.post(url(id), { mode: 'schedule', confirm_name: 'Alpha Stays' });
  assert.equal(again.status, 409);
  assert.equal(again.data.code, 'ALREADY_SCHEDULED');

  const back = await boss.post(url(id, 'restore'));
  assert.equal(back.status, 200);
  assert.equal((await sql('SELECT deletion_scheduled_at FROM organizations WHERE organization_id = $1', [id]))[0].deletion_scheduled_at, null);
  assert.equal((await sql(`SELECT 1 FROM audit_logs WHERE organization_id = $1 AND action = 'platform.workspace_deletion_cancelled'`, [id])).length, 1);
  const none = await boss.post(url(id, 'restore'));
  assert.equal(none.status, 409);
  assert.equal(none.data.code, 'NOT_SCHEDULED');
  assert.equal((await boss.post(url(MISSING, 'restore'))).status, 404);
});

test('a purge failure answers 502 and changes nothing', async () => {
  const id = ids['Gamma Stays'];
  const real = account.purgeOrganization;
  account.purgeOrganization = async () => { throw new Error('paymongo down'); };
  try {
    const r = await boss.post(url(id), { mode: 'now', confirm_name: 'Gamma Stays' });
    assert.equal(r.status, 502);
    assert.equal(r.data.code, 'PURGE_FAILED');
    assert.ok(!/paymongo down/.test(JSON.stringify(r.data)));
  } finally { account.purgeOrganization = real; }
  assert.equal(await orgId('Gamma Stays'), id);
  assert.equal((await sql('SELECT count(*)::int AS n FROM users WHERE organization_id = $1', [id]))[0].n, 1);
});

test('now removes the organization and its people', async () => {
  const id = ids['Beta Stays'];
  const r = await boss.post(url(id), { mode: 'now', confirm_name: 'Beta Stays' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual({ ok: r.data.ok, deleted: r.data.deleted }, { ok: true, deleted: true });
  assert.equal(await orgId('Beta Stays'), undefined);
  assert.equal((await sql('SELECT count(*)::int AS n FROM users WHERE organization_id = $1', [id]))[0].n, 0);
  assert.equal((await boss.post(url(id), { mode: 'now', confirm_name: 'Beta Stays' })).status, 404);
});

test('a workspace with a platform-admin member cannot be deleted here', async () => {
  const id = ids['Epsilon Stays'];
  for (const mode of ['now', 'schedule']) {
    const r = await boss.post(url(id), { mode, confirm_name: 'Epsilon Stays' });
    assert.equal(r.status, 409, JSON.stringify(r.data));
    assert.equal(r.data.code, 'PLATFORM_ADMIN_WORKSPACE');
  }
  assert.equal(await orgId('Epsilon Stays'), id);
});

test('the platform audit row (no workspace) survives the purge; schedule and restore write one too', async () => {
  const id = ids['Zeta Stays'];
  const rows = (action) => sql(`SELECT details FROM audit_logs WHERE organization_id IS NULL AND action = $1 AND details->>'workspace_id' = $2`, [action, id]);
  assert.equal((await boss.post(url(id), { mode: 'schedule', confirm_name: 'Zeta Stays' })).status, 200);
  assert.equal((await boss.post(url(id, 'restore'))).status, 200);
  assert.equal((await rows('platform.workspace_deletion_scheduled')).length, 1);
  assert.equal((await rows('platform.workspace_deletion_cancelled')).length, 1);
  const r = await boss.post(url(id), { mode: 'now', confirm_name: 'Zeta Stays' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await orgId('Zeta Stays'), undefined);
  const del = await rows('platform.workspace_deleted');
  assert.equal(del.length, 1);
  assert.equal(del[0].details.workspace_name, 'Zeta Stays');
  assert.equal(del[0].details.mode, 'now');
});

test('a workspace that is already gone answers 200', async () => {
  const real = account.purgeOrganization;
  account.purgeOrganization = async () => ({ deleted: false, reason: 'gone' });
  try {
    const r = await boss.post(url(ids['Gamma Stays']), { mode: 'now', confirm_name: 'Gamma Stays' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual({ ok: r.data.ok, deleted: r.data.deleted }, { ok: true, deleted: true });
  } finally { account.purgeOrganization = real; }
});
