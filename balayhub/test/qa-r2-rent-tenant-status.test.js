'use strict';

// QA round 2, rent screen. An archived tenant who still owes is labelled "(archived)" on the
// Rent screen: tenantTag in views/rent.js reads tenant_status, so the server must send it on
// both GET /api/rent and GET /api/rent/leases.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_09 node --test --test-concurrency=1 test/qa-r2-rent-tenant-status.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, manilaToday, addMonths } = require('./helpers');

let srv; let owner;
const ids = {};
const today = manilaToday();

async function ok(res, status = 200) {
  assert.equal(res.status, status, JSON.stringify(res.data));
  return res.data;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-r2-rent-status@example.com', 'QA R2 Rent Status');
  const p = await ok(await owner.post('/api/properties', { property_name: 'Status Flats', property_type: 'apartment', address: '2 Mabini St', city: 'Bacoor', province: 'Cavite' }), 201);
  const unit = async (name) => (await ok(await owner.post(`/api/properties/${p.property.property_id}/units`, { unit_name: name, unit_type: 'room', monthly_rent: '5000' }), 201)).unit.unit_id;
  const unitA = await unit('Room A');
  const unitB = await unit('Room B');
  const tenant = async (full_name, email) => (await ok(await owner.post('/api/tenants', { full_name, email }), 201)).tenant.tenant_id;
  ids.ana = await tenant('Ana Reyes', 'ana-status@example.com');
  ids.lito = await tenant('Lito Lapid', 'lito-status@example.com');
  const lease = async (body) => (await ok(await owner.post('/api/leases', body), 201)).lease.lease_id;
  // Ana is still in the unit and behind on rent.
  ids.anaLease = await lease({ tenant_id: ids.ana, unit_id: unitA, start_date: addMonths(today, -2), monthly_rent: '5000', due_day: 5 });
  // Lito moved out today still owing rent, then was archived.
  ids.litoLease = await lease({ tenant_id: ids.lito, unit_id: unitB, start_date: addMonths(today, -2), monthly_rent: '5000', due_day: 5 });
  await ok(await owner.post(`/api/leases/${ids.litoLease}/end`, { end_date: today, lease_status: 'ended' }));
  await ok(await owner.post(`/api/tenants/${ids.lito}/archive`));
});
test.after(async () => { await srv.close(); });

test('GET /api/rent sends tenant_status so the Rent screen labels an archived tenant (archived)', async () => {
  const { charges } = await ok(await owner.get('/api/rent'));
  const litoCharges = charges.filter((c) => c.tenant_name === 'Lito Lapid');
  assert.ok(litoCharges.some((c) => Number(c.balance) > 0), 'Lito still has an unpaid charge');
  for (const c of litoCharges) assert.equal(c.tenant_status, 'archived');
  const anaCharges = charges.filter((c) => c.tenant_name === 'Ana Reyes');
  assert.ok(anaCharges.length > 0, 'Ana has charges');
  for (const c of anaCharges) assert.equal(c.tenant_status, 'active');
});

test('GET /api/rent/leases sends tenant_status for the Record Payment picker', async () => {
  const { leases } = await ok(await owner.get('/api/rent/leases'));
  assert.equal(leases.find((l) => l.lease_id === ids.litoLease).tenant_status, 'archived');
  assert.equal(leases.find((l) => l.lease_id === ids.anaLease).tenant_status, 'active');
});
