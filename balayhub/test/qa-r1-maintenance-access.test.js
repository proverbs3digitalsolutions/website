'use strict';

// QA round 1, #73: staff must not read maintenance schedules (BACKEND-SCHEMA 6.1).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');

let srv; let owner; let manager; let staff; let prop;

async function teamMember(role, email, name) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: [prop.property_id] });
  const c = client(srv.base);
  const r = await c.post('/api/auth/signup', {
    full_name: name, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return c;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-l09@example.com', 'L09 Co');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  manager = await teamMember('manager', 'manager-l09@example.com', 'Ana Manager');
  staff = await teamMember('staff', 'staff-l09@example.com', 'Ben Staff');
});
test.after(async () => { await srv.close(); });

test('GET /api/maintenance-schedules: staff 403, manager and owner 200, anonymous 401', async () => {
  const s = await staff.get('/api/maintenance-schedules');
  assert.equal(s.status, 403, JSON.stringify(s.data));
  assert.equal((await manager.get('/api/maintenance-schedules')).status, 200);
  assert.equal((await owner.get('/api/maintenance-schedules')).status, 200);
  assert.equal((await client(srv.base).get('/api/maintenance-schedules')).status, 401);
});
