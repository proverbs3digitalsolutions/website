'use strict';

// QA round 7, member data. Non-owners see the plan's status (trial days, payment dates, read-only
// reason) but not what the plan costs or its listing limit (BACKEND-SCHEMA 6, D-83). Staff and
// cleaners never receive a lease's document id; owners and managers still do.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startServer, client, sql, ownerAccount, manilaToday, addMonths } = require('./helpers');

const PASSWORD = 'longenough1';
const today = manilaToday();
let srv; let owner; let manager; let staff; let cleaner;
const ids = {};
const documentId = crypto.randomUUID();

async function ok(res, status = 200) {
  assert.equal(res.status, status, JSON.stringify(res.data));
  return res.data;
}

// Invites a member to the given properties, then accepts through the sign-up form, which signs them in.
async function accept(email, role, propertyIds, fullName) {
  const inv = await ok(await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds }), 201);
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', {
    full_name: fullName, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true,
    invite_token: decodeURIComponent(inv.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-r7-c19@example.com', 'QA R7 Member Data');
  const lagoon = (await ok(await owner.post('/api/properties', { property_name: 'Lagoon Flats', property_type: 'apartment', address: '1 Mabini St', city: 'Bacoor', province: 'Cavite' }), 201)).property;
  const hill = (await ok(await owner.post('/api/properties', { property_name: 'Hill Rooms', property_type: 'apartment', address: '9 Ridge Rd', city: 'Antipolo', province: 'Rizal' }), 201)).property;
  const unit = async (propertyId, name) => (await ok(await owner.post(`/api/properties/${propertyId}/units`, { unit_name: name, unit_type: 'room', monthly_rent: '5000' }), 201)).unit.unit_id;
  const unitA = await unit(lagoon.property_id, 'Room A');
  const unitB = await unit(hill.property_id, 'Room B');
  const tenant = (await ok(await owner.post('/api/tenants', { full_name: 'Ana Reyes', email: 'ana-r7-c19@example.com' }), 201)).tenant.tenant_id;
  const lease = async (tenantId, unitId) => (await ok(await owner.post('/api/leases', { tenant_id: tenantId, unit_id: unitId, start_date: addMonths(today, -1), monthly_rent: '5000', due_day: 5 }), 201)).lease.lease_id;
  ids.tenant = tenant;
  ids.lease = await lease(tenant, unitA);
  const otherTenant = (await ok(await owner.post('/api/tenants', { full_name: 'Lito Lapid', email: 'lito-r7-c19@example.com' }), 201)).tenant.tenant_id;
  ids.otherLease = await lease(otherTenant, unitB);
  await sql('UPDATE leases SET document_file_id = $2 WHERE lease_id = $1', [ids.lease, documentId]);
  manager = await accept('r7-c19-manager@example.com', 'manager', [lagoon.property_id], 'Manager Lagoon');
  staff = await accept('r7-c19-staff@example.com', 'staff', [lagoon.property_id], 'Staff Lagoon');
  cleaner = await accept('r7-c19-cleaner@example.com', 'cleaner', [lagoon.property_id], 'Cleaner Lagoon');
});
test.after(async () => { await srv.close(); });

test('account profile: the owner sees the plan price and listing limit; everyone else sees the status only', async () => {
  const ownerPlan = (await ok(await owner.get('/api/account/profile'))).workspace.plan;
  assert.ok('price' in ownerPlan, 'owner keeps the price');
  assert.ok('listing_limit' in ownerPlan, 'owner keeps the listing limit');
  for (const [who, c] of [['manager', manager], ['staff', staff], ['cleaner', cleaner]]) {
    const plan = (await ok(await c.get('/api/account/profile'))).workspace.plan;
    assert.equal(plan.plan, 'trial', who);
    assert.equal(plan.name, 'Free trial', who);
    assert.equal(plan.read_only, false, who);
    assert.equal(typeof plan.trial_days_left, 'number', `${who} still gets the trial days the banner shows`);
    assert.equal('price' in plan, false, `${who} must not see the price`);
    assert.equal('listing_limit' in plan, false, `${who} must not see the listing limit`);
  }
});

test('auth me: staff and cleaners get the plan status without price or listing limit', async () => {
  for (const [who, c] of [['staff', staff], ['cleaner', cleaner]]) {
    const plan = (await ok(await c.get('/api/auth/me'))).user.plan;
    assert.equal(plan.plan, 'trial', who);
    assert.equal('price' in plan, false, `${who} must not see the price`);
    assert.equal('listing_limit' in plan, false, `${who} must not see the listing limit`);
  }
});

test('a lease document id reaches the owner and manager; staff get null and no files', async () => {
  assert.equal((await ok(await owner.get(`/api/leases/${ids.lease}`))).lease.document_file_id, documentId);
  assert.equal((await ok(await manager.get(`/api/leases/${ids.lease}`))).lease.document_file_id, documentId);
  const data = await ok(await staff.get(`/api/leases/${ids.lease}`));
  assert.equal(data.lease.document_file_id, null);
  assert.deepEqual(data.files, []);
  assert.equal(data.lease.lease_id, ids.lease, 'staff still open the lease in their property');
});

test('the tenant screen blanks the lease document id for staff too', async () => {
  assert.equal((await ok(await owner.get(`/api/tenants/${ids.tenant}`))).leases[0].document_file_id, documentId);
  const data = await ok(await staff.get(`/api/tenants/${ids.tenant}`));
  assert.equal(data.leases[0].lease_id, ids.lease);
  assert.equal(data.leases[0].document_file_id, null);
});

test('a cleaner cannot open a lease at all', async () => {
  const r = await cleaner.get(`/api/leases/${ids.lease}`);
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'CLEANER_FORBIDDEN');
});

test('staff still cannot open a lease in a property they are not assigned to', async () => {
  assert.equal((await staff.get(`/api/leases/${ids.otherLease}`)).status, 404);
});
