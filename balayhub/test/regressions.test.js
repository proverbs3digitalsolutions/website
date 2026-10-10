'use strict';

// Regressions for findings from the code-review stage.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday, addMonths } = require('./helpers');

let srv; let owner; let p1; let p2; let u1; let u2; let mgr; let staff;
const today = manilaToday();

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base);
  const mk = async (name) => (await owner.post('/api/properties', { property_name: name, property_type: 'apartment', address: name, city: 'Imus', province: 'Cavite' })).data.property;
  p1 = await mk('P1'); p2 = await mk('P2');
  u1 = (await owner.post(`/api/properties/${p1.property_id}/units`, { unit_name: 'A', unit_type: 'room', monthly_rent: '1000' })).data.unit;
  u2 = (await owner.post(`/api/properties/${p2.property_id}/units`, { unit_name: 'B', unit_type: 'room', monthly_rent: '4000' })).data.unit;
  async function invite(email, role) {
    const inv = await owner.post('/api/team/invitations', { email, role, property_ids: [p1.property_id] });
    const token = decodeURIComponent(inv.data.inviteLink.split('invite=')[1]);
    const c = client(srv.base);
    await c.post('/api/auth/signup', { full_name: role, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: token });
    return c;
  }
  mgr = await invite('m@example.com', 'manager');
  staff = await invite('s@example.com', 'staff');
});
test.after(async () => { await srv.close(); });

test('manager tenant list does not show leases in unassigned properties', async () => {
  const t = (await owner.post('/api/tenants', { full_name: 'Moving Tenant', phone: '09170000001' })).data.tenant;
  const l1 = (await owner.post('/api/leases', { tenant_id: t.tenant_id, unit_id: u1.unit_id, start_date: addMonths(today, -2), monthly_rent: '1000', due_day: 1 })).data.lease;
  await owner.post(`/api/leases/${l1.lease_id}/end`, { end_date: today, lease_status: 'ended' });
  await owner.post('/api/leases', { tenant_id: t.tenant_id, unit_id: u2.unit_id, start_date: today, monthly_rent: '4000', due_day: 1 });
  const r = await mgr.get('/api/tenants');
  const row = r.data.tenants.find((x) => x.tenant_id === t.tenant_id);
  assert.ok(row, 'tenant with history in P1 is visible');
  assert.equal(row.property_name, null);
  assert.equal(row.lease_id, null);
});

test('duplicate check does not leak tenants outside the manager scope', async () => {
  const hidden = (await owner.post('/api/tenants', { full_name: 'Hidden P2', email: 'hidden@example.com', phone: '09995550000' })).data.tenant;
  await owner.post('/api/leases', { tenant_id: hidden.tenant_id, unit_id: (await owner.post(`/api/properties/${p2.property_id}/units`, { unit_name: 'C', unit_type: 'room', monthly_rent: '1' })).data.unit.unit_id, start_date: today, monthly_rent: '1', due_day: 1 });
  const r = await mgr.post('/api/tenants', { full_name: 'Someone', email: 'hidden@example.com' });
  assert.equal(r.status, 201);
  assert.ok(!JSON.stringify(r.data).includes('09995550000'));
});

test('staff cannot search tenants by hidden contact fields', async () => {
  const t = (await owner.post('/api/tenants', { full_name: 'Secret Person', phone: '09998887777' })).data.tenant;
  assert.ok(t);
  const byPhone = await staff.get('/api/tenants?q=0999888');
  assert.equal(byPhone.data.tenants.length, 0);
  const byName = await staff.get('/api/tenants?q=Secret');
  assert.equal(byName.data.tenants.length, 1);
});

test('no rent is charged for a month that falls due after move-out', async () => {
  const unit = (await owner.post(`/api/properties/${p1.property_id}/units`, { unit_name: 'D', unit_type: 'room', monthly_rent: '1000' })).data.unit;
  const t = (await owner.post('/api/tenants', { full_name: 'Short Stay' })).data.tenant;
  const start = addMonths(today, -2); // first of month two months ago
  const l = (await owner.post('/api/leases', { tenant_id: t.tenant_id, unit_id: unit.unit_id, start_date: start, monthly_rent: '1000', due_day: 20 })).data.lease;
  const lastMonth = addMonths(today, -1);
  const moveOut = `${lastMonth.slice(0, 8)}05`; // 5th of last month, before the 20th due date
  assert.equal((await owner.post(`/api/leases/${l.lease_id}/end`, { end_date: moveOut, lease_status: 'ended' })).status, 200);
  await owner.get('/api/dashboard'); // triggers charge sync
  const rows = await sql('SELECT period FROM rent_charges WHERE lease_id = $1 ORDER BY period', [l.lease_id]);
  assert.deepEqual(rows.map((r) => r.period), [start]);
});

test('move-out date cannot be in the future (unit would be double-booked)', async () => {
  const unit = (await owner.post(`/api/properties/${p1.property_id}/units`, { unit_name: 'E', unit_type: 'room', monthly_rent: '1000' })).data.unit;
  const t = (await owner.post('/api/tenants', { full_name: 'Future Leaver' })).data.tenant;
  const l = (await owner.post('/api/leases', { tenant_id: t.tenant_id, unit_id: unit.unit_id, start_date: today, monthly_rent: '1000', due_day: 1 })).data.lease;
  const r = await owner.post(`/api/leases/${l.lease_id}/end`, { end_date: addMonths(today, 6), lease_status: 'ended' });
  assert.equal(r.status, 400);
  assert.ok(r.data.fields.end_date);
});

test('a malformed cookie does not break the API', async () => {
  const r = await fetch(`${srv.base}/api/health`, { headers: { Cookie: 'x=%E0%A4%A' } });
  assert.equal(r.status, 200);
  const me = await fetch(`${srv.base}/api/auth/me`, { headers: { Cookie: 'x=%E0%A4%A' } });
  assert.equal(me.status, 401);
});

test('invalid property_id on reports is ignored, not a 500', async () => {
  const r = await owner.get(`/api/reports?from=${today}&to=${today}&property_id=${'-'.repeat(36)}`);
  assert.equal(r.status, 200);
});

test('X-Forwarded-For is not trusted by default (rate limit cannot be bypassed)', async () => {
  const c = client(srv.base);
  let last;
  for (let i = 0; i < 22; i += 1) {
    last = await c.post('/api/auth/login', { email: 'owner@example.com', password: 'wrong-wrong' }, { 'X-Forwarded-For': `10.0.0.${i}` });
  }
  assert.equal(last.status, 429);
});
