'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const account = require('../src/lib/account');
const { createStaysWorkspace } = require('../src/lib/demo');
const { hashPassword } = require('../src/lib/auth');

let srv; let owner;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Keep Me Co');
});
test.after(async () => { await srv.close(); });

test('sign-up records both Privacy Notice and Terms consent; health checks the database', async () => {
  const rows = await sql(`SELECT consent_type FROM consent_records c JOIN users u USING (user_id) WHERE u.email = 'host@example.com' ORDER BY 1`);
  assert.deepEqual(rows.map((r) => r.consent_type), ['privacy_notice', 'terms_of_service']);
  const h = await client(srv.base).get('/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.data.ok, true);
});

test('change password: checks current password, signs out other devices', async () => {
  const other = client(srv.base);
  await other.post('/api/auth/login', { email: 'host@example.com', password: 'correct-horse-1' });
  assert.equal((await other.get('/api/auth/me')).status, 200);
  const wrong = await owner.post('/api/auth/change-password', { current_password: 'nope-nope-1', new_password: 'brand-new-pass-1', confirm_password: 'brand-new-pass-1' });
  assert.equal(wrong.status, 400);
  assert.ok(wrong.data.fields.current_password);
  const mismatch = await owner.post('/api/auth/change-password', { current_password: 'correct-horse-1', new_password: 'brand-new-pass-1', confirm_password: 'different-1' });
  assert.equal(mismatch.status, 400);
  const ok = await owner.post('/api/auth/change-password', { current_password: 'correct-horse-1', new_password: 'brand-new-pass-1', confirm_password: 'brand-new-pass-1' });
  assert.equal(ok.status, 200);
  assert.equal((await owner.get('/api/auth/me')).status, 200, 'this device stays signed in');
  assert.equal((await other.get('/api/auth/me')).status, 401, 'other devices are signed out');
  const relog = client(srv.base);
  assert.equal((await relog.post('/api/auth/login', { email: 'host@example.com', password: 'brand-new-pass-1' })).status, 200);
});

test('export includes the workspace data but no secrets', async () => {
  const p = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const u = (await owner.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const today = manilaToday();
  const plus2 = new Date(Date.parse(`${today}T00:00:00Z`) + 2 * 86400000).toISOString().slice(0, 10);
  const made = await owner.post('/api/reservations', { unit_id: u.unit_id, check_in: today, check_out: plus2, guest_name: 'Export Guest', guest_email: 'g@example.com' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const res = await owner.raw('GET', '/api/workspace/export');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="balayhub-export-/);
  const data = res.data;
  assert.equal(data.organization.name, 'Keep Me Co');
  assert.equal(data.bookings.length, 1);
  assert.equal(data.guests[0].full_name, 'Export Guest');
  const text = JSON.stringify(data);
  for (const secret of ['password_hash', 'token_hash', 'checkin_token', 'google_sub', 'storage_key']) assert.ok(!text.includes(`"${secret}"`), secret);
  const staffless = await ownerAccount(srv.base, 'other@example.com', 'Other Co');
  const theirs = (await staffless.raw('GET', '/api/workspace/export')).data;
  assert.equal(theirs.bookings.length, 0, 'only your own workspace');
});

test('every table is covered by workspace deletion', async () => {
  const rows = await sql(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  const ignored = ['schema_migrations', 'mail_sync_state'];
  const missing = rows.map((r) => r.table_name).filter((t) => !ignored.includes(t) && !account.PURGED_TABLES.includes(t));
  assert.deepEqual(missing, [], 'add new tables to purgeOrganization() and PURGED_TABLES');
});

test('delete workspace: confirm by name, 14-day grace, view-only, cancel, then everything is gone', async () => {
  // A busy workspace (sample data: stays, guests, messages, payments, cleaning tasks, expenses).
  const orgId = await createStaysWorkspace({ email: 'bye@example.com', passwordHash: await hashPassword('goodbye-pass-1') });
  await sql(`UPDATE organizations SET name = 'Bye Stays', plan = 'trial', trial_ends_at = now() + interval '10 days' WHERE organization_id = $1`, [orgId]);
  const bye = client(srv.base);
  assert.equal((await bye.post('/api/auth/login', { email: 'bye@example.com', password: 'goodbye-pass-1' })).status, 200);
  // A long-term tenant and lease too.
  const p = (await bye.post('/api/properties', { property_name: 'Dorm', property_type: 'dormitory', address: 'Dorm Street 5', city: 'Manila', province: 'Metro Manila' })).data.property;
  const room = (await bye.post(`/api/properties/${p.property_id}/units`, { unit_name: 'R1', unit_type: 'room', monthly_rent: '4000' })).data.unit;
  const t = (await bye.post('/api/tenants', { full_name: 'Tenant T', phone: '09171234567' })).data.tenant;
  assert.equal((await bye.post('/api/leases', { tenant_id: t.tenant_id, unit_id: room.unit_id, start_date: manilaToday(), monthly_rent: '4000', due_day: 5 })).status, 201);
  const keepBookings = (await sql(`SELECT COUNT(*)::int AS n FROM bookings b JOIN organizations o USING (organization_id) WHERE o.name = 'Keep Me Co'`))[0].n;

  assert.equal((await bye.post('/api/workspace/delete', { confirm_name: 'wrong name' })).status, 400);
  const d = await bye.post('/api/workspace/delete', { confirm_name: 'bye stays' });
  assert.equal(d.status, 200);
  const me = (await bye.get('/api/auth/me')).data.user;
  assert.equal(me.plan.reason, 'deleting');
  assert.equal((await bye.post('/api/properties', { property_name: 'X', property_type: 'condominium', address: 'Another St 1', city: 'Manila', province: 'Metro Manila' })).status, 402);
  assert.equal((await bye.get('/api/listings')).status, 200, 'still viewable');
  assert.equal((await bye.post('/api/workspace/delete/cancel')).status, 200);
  assert.equal((await bye.get('/api/auth/me')).data.user.plan.reason, null);

  await bye.post('/api/workspace/delete', { confirm_name: 'Bye Stays' });
  assert.equal(await account.purgeDue(), 0, 'not before the grace period');
  await sql(`UPDATE organizations SET deletion_scheduled_at = now() - interval '1 minute' WHERE organization_id = $1`, [orgId]);
  assert.equal(await account.purgeDue(), 1);

  for (const tbl of ['organizations', 'users', 'bookings', 'guests', 'messages', 'conversations', 'booking_payments', 'cleaning_tasks', 'expenses', 'tenants', 'leases', 'payments', 'files', 'audit_logs']) {
    const n = (await sql(`SELECT COUNT(*)::int AS n FROM ${tbl} WHERE organization_id = $1`, [orgId]))[0].n;
    assert.equal(n, 0, tbl);
  }
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM users WHERE email = 'bye@example.com'`))[0].n, 0);
  assert.equal((await bye.get('/api/auth/me')).status, 401, 'sessions are gone');
  const keepNow = (await sql(`SELECT COUNT(*)::int AS n FROM bookings b JOIN organizations o USING (organization_id) WHERE o.name = 'Keep Me Co'`))[0].n;
  assert.equal(keepNow, keepBookings, 'other workspaces untouched');
});

test('the demo and non-owners cannot delete', async () => {
  const demo = client(srv.base);
  await demo.post('/api/auth/demo');
  assert.equal((await demo.post('/api/workspace/delete', { confirm_name: 'Reyes Staycations' })).status, 403);
});
