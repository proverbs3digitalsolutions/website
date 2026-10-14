'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

// QA round 11, lane C12. #32: a daily close can be reopened (owner any, manager only a close that
// covers just their properties). K3: a past day's checklist shows what was true at the end of that day.
// #30, #21, K14: maintenance list status, resolved/in-progress buttons (source scans).
// Runs on its own database (TEST_DATABASE_URL) because the test resets the schema.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');

const addDays = (s, n) => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);
const section = (body, key) => body.sections.find((s) => s.key === key);
const PASSWORD = 'longenough1';

let srv; let owner; let manager; let staff; let orgId; let today; let yesterday; let twoAgo; let unit;

async function accept(email, role, propertyIds, fullName) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', {
    full_name: fullName, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'c12-owner@example.com', 'Lane C12 Stays');
  orgId = (await sql('SELECT organization_id FROM organizations WHERE name = $1', ['Lane C12 Stays']))[0].organization_id;
  today = manilaToday(); yesterday = addDays(today, -1); twoAgo = addDays(today, -2);
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'house', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1A', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  manager = await accept('c12-manager@example.com', 'manager', [prop.property_id], 'Manager Azure');
  staff = await accept('c12-staff@example.com', 'staff', [prop.property_id], 'Staff Azure');
});
test.after(async () => { await srv.close(); });

test('reopen: owner removes a close and it is audited', async () => {
  const d = twoAgo;
  assert.equal((await owner.post('/api/daily-close', { date: d, note: 'x' })).status, 200);
  const r = await owner.post('/api/daily-close/reopen', { date: d });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { closed: null });
  assert.equal((await sql('SELECT 1 FROM daily_closes WHERE organization_id = $1 AND close_date = $2::date', [orgId, d])).length, 0);
  const a = await sql("SELECT details FROM audit_logs WHERE organization_id = $1 AND action = 'daily_close.reopened'", [orgId]);
  assert.equal(a.length, 1);
  assert.equal(a[0].details.date, d);
  assert.ok(a[0].details.counts);
  assert.equal((await owner.get(`/api/daily-close?date=${d}`)).data.closed, null);
});

test('reopen: manager on own-property close ok, whole-workspace close 409, none 404, staff 403', async () => {
  assert.equal((await manager.post('/api/daily-close', { date: yesterday })).status, 200);
  assert.equal((await manager.post('/api/daily-close/reopen', { date: yesterday })).status, 200);
  assert.equal((await manager.post('/api/daily-close/reopen', { date: yesterday })).status, 404);

  assert.equal((await owner.post('/api/daily-close', { date: yesterday })).status, 200);
  const r = await manager.post('/api/daily-close/reopen', { date: yesterday });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'ALREADY_CLOSED');
  assert.equal((await sql('SELECT 1 FROM daily_closes WHERE organization_id = $1 AND close_date = $2::date', [orgId, yesterday])).length, 1);

  assert.equal((await staff.post('/api/daily-close/reopen', { date: yesterday })).status, 403);
  assert.equal((await client(srv.base).post('/api/daily-close/reopen', { date: yesterday })).status, 401);
  assert.equal((await owner.post('/api/daily-close/reopen', {})).status, 400);
});

test('past day: arrivals and cleanings use what was true at the end of that day', async () => {
  const r = await owner.post('/api/reservations', {
    unit_id: unit.unit_id, check_in: yesterday, check_out: today, guest_name: 'Late Checkin', accommodation_total: '2000.00', channel: 'direct',
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal((await owner.post(`/api/reservations/${r.data.reservation.booking_id}/stay-status`, { action: 'check_in' })).status, 200);
  await sql(`INSERT INTO cleaning_tasks (organization_id, unit_id, due_date, status, completed_at)
             VALUES ($1, $2, $3::date, 'done', now())`, [orgId, unit.unit_id, yesterday]);

  const past = (await owner.get(`/api/daily-close?date=${yesterday}`)).data;
  assert.deepEqual(section(past, 'arrivals_pending').items.map((i) => i.text), ['Late · 1A']);
  assert.equal(section(past, 'cleanings_open').count, 1);

  const now = (await owner.get(`/api/daily-close?date=${today}`)).data;
  assert.equal(section(now, 'arrivals_pending').count, 0);
  assert.equal(section(now, 'cleanings_open').count, 0);
});

test('views: maintenance status, buttons; daily close reopen button', () => {
  const dir = path.join(__dirname, '..', 'public', 'js', 'views');
  const m = fs.readFileSync(path.join(dir, 'maintenance.js'), 'utf8');
  assert.match(m, /status: filters\.status/);
  assert.match(m, /resolved: \['open'\]/);
  assert.doesNotMatch(m, /resolved: \['open', 'cancelled'\]/);
  assert.match(m, /Back to open/);
  const d = fs.readFileSync(path.join(dir, 'dailyclose.js'), 'utf8');
  assert.match(d, /\/daily-close\/reopen/);
  assert.match(d, /Reopen day/);
  assert.match(d, /Day reopened\./);
  assert.match(d, /You can reopen it later\./);
});
