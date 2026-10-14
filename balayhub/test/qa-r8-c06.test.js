'use strict';

// QA round 8, lane C06 (tenants-audit). A tenant or lease save writes an activity row only for the fields that
// really changed, by name: never their values and never a "before" copy (N28, N29). A save that changes nothing
// writes no row, and it still answers with the record as it was.
// node --test --test-concurrency=1 test/qa-r8-c06.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, sql, manilaToday, addMonths } = require('./helpers');

const today = manilaToday();
let srv; let owner; let unit; let tenant;

const updates = (recordType, id) => sql(
  `SELECT action, details FROM audit_logs WHERE record_type = $1 AND record_id = $2 AND action = $3 ORDER BY audit_id`,
  [recordType, id, `${recordType}.updated`]);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-c06-r8@example.com', 'C06 Co');
  const p = await owner.post('/api/properties', {
    property_name: 'Mabini Lofts', property_type: 'apartment', address: '3 Mabini St', city: 'Bacoor', province: 'Cavite',
  });
  unit = (await owner.post(`/api/properties/${p.data.property.property_id}/units`, { unit_name: '201', unit_type: 'studio', monthly_rent: '8000' })).data.unit;
  tenant = (await owner.post('/api/tenants', {
    full_name: 'Rico Bautista', phone: '09171230000', email: 'rico@example.com', notes: 'Pays early',
  })).data.tenant;
});
test.after(async () => { await srv.close(); });

test('a tenant save with the stored values writes no row and never keeps before values (N28)', async () => {
  const same = await owner.patch(`/api/tenants/${tenant.tenant_id}`, {
    full_name: 'Rico Bautista', email: 'rico@example.com', phone: '09171230000', notes: 'Pays early',
  });
  assert.equal(same.status, 200, JSON.stringify(same.data));
  assert.equal(same.data.tenant.full_name, 'Rico Bautista');
  assert.deepEqual(await updates('tenant', tenant.tenant_id), []);
});

test('a tenant email change writes one row naming only the field, and saving it again writes nothing (N28)', async () => {
  const r = await owner.patch(`/api/tenants/${tenant.tenant_id}`, { email: 'rico.b@example.com' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.tenant.email, 'rico.b@example.com');
  const made = await updates('tenant', tenant.tenant_id);
  assert.equal(made.length, 1);
  assert.deepEqual(made[0].details, { fields: ['email'] });

  await owner.patch(`/api/tenants/${tenant.tenant_id}`, { email: 'rico.b@example.com' });
  assert.equal((await updates('tenant', tenant.tenant_id)).length, 1);
});

test('a lease save with the stored values writes no row; a rent change names only rent (N29)', async () => {
  const created = await owner.post('/api/leases', {
    tenant_id: tenant.tenant_id, unit_id: unit.unit_id, start_date: today, monthly_rent: '8000', due_day: 5, deposit_amount: '16000',
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const lease = created.data.lease;

  const same = await owner.patch(`/api/leases/${lease.lease_id}`, {
    monthly_rent: '8000', due_day: 5, deposit_amount: '16000', end_date: null,
  });
  assert.equal(same.status, 200, JSON.stringify(same.data));
  assert.equal(same.data.lease.lease_id, lease.lease_id);
  assert.equal(same.data.lease.monthly_rent, '8000.00');
  assert.deepEqual(await updates('lease', lease.lease_id), []);

  const rent = await owner.patch(`/api/leases/${lease.lease_id}`, { monthly_rent: '8500', due_day: 5 });
  assert.equal(rent.status, 200, JSON.stringify(rent.data));
  const made = await updates('lease', lease.lease_id);
  assert.equal(made.length, 1);
  assert.deepEqual(made[0].details, { fields: ['monthly_rent'] });
});

test('a lease end date set and then saved again writes one row, not two (N29)', async () => {
  const lease = (await sql(`SELECT lease_id FROM leases WHERE tenant_id = $1`, [tenant.tenant_id]))[0];
  const endDate = addMonths(today, 6);
  assert.equal((await owner.patch(`/api/leases/${lease.lease_id}`, { end_date: endDate })).status, 200);
  assert.equal((await owner.patch(`/api/leases/${lease.lease_id}`, { end_date: endDate })).status, 200);
  const made = await updates('lease', lease.lease_id);
  assert.equal(made.length, 2, 'the rent change and the end date change, and nothing for the repeat');
  assert.deepEqual(made[1].details, { fields: ['end_date'] });
});
