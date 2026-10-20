'use strict';

// Round 2 fixes for the tenants screen and the dashboard. The tenant search treats % and _
// as plain text. A tenant who moved out and was archived while still owing keeps counting
// on the dashboard and reports, and their rows say "(archived)". The archive confirmation
// states the amount still owed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ownerAccount, manilaToday, addMonths } = require('./helpers');

let srv; let owner;
const ids = {};
const today = manilaToday();
const names = (rows) => rows.map((r) => r.full_name).sort();

async function ok(res, status = 200) {
  assert.equal(res.status, status, JSON.stringify(res.data));
  return res.data;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-r2-tenants@example.com', 'QA R2 Tenants');
  const p = await ok(await owner.post('/api/properties', { property_name: 'Lagoon Flats', property_type: 'apartment', address: '1 Mabini St', city: 'Bacoor', province: 'Cavite' }), 201);
  const unit = async (name) => (await ok(await owner.post(`/api/properties/${p.property.property_id}/units`, { unit_name: name, unit_type: 'room', monthly_rent: '5000' }), 201)).unit.unit_id;
  const unitA = await unit('Room A');
  const unitB = await unit('Room B');
  const tenant = async (full_name, email) => (await ok(await owner.post('/api/tenants', { full_name, email }), 201)).tenant.tenant_id;
  ids.ana = await tenant('Ana Reyes', 'ana@example.com');
  ids.lito = await tenant('Lito Lapid', 'lito@example.com');
  const lease = async (body) => (await ok(await owner.post('/api/leases', body), 201)).lease.lease_id;
  // Ana is still in the unit and behind on rent.
  ids.anaLease = await lease({ tenant_id: ids.ana, unit_id: unitA, start_date: addMonths(today, -2), monthly_rent: '5000', due_day: 5 });
  // Lito moved out today still owing two months of rent, then was archived.
  ids.litoLease = await lease({ tenant_id: ids.lito, unit_id: unitB, start_date: addMonths(today, -2), monthly_rent: '5000', due_day: 5 });
  await ok(await owner.post(`/api/leases/${ids.litoLease}/end`, { end_date: today, lease_status: 'ended' }));
  await ok(await owner.post(`/api/tenants/${ids.lito}/archive`));
});
test.after(async () => { await srv.close(); });

test('tenant search treats % and _ as plain text', async () => {
  const search = async (q) => (await ok(await owner.get(`/api/tenants?q=${encodeURIComponent(q)}`))).tenants;
  assert.deepEqual(names(await search('%')), [], 'a lone % matches no tenant');
  assert.deepEqual(names(await search('_')), [], 'a lone _ matches no tenant');
  assert.deepEqual(names(await search('\\')), [], 'a backslash is plain text too');
  assert.deepEqual(names(await search('Ana')), ['Ana Reyes'], 'ordinary search still works');
});

test('an archived tenant who still owes keeps counting on the dashboard, labelled (archived)', async () => {
  const d = await ok(await owner.get('/api/dashboard'));
  const ana = d.overdue_tenants.find((t) => t.tenant_name === 'Ana Reyes');
  const lito = d.overdue_tenants.find((t) => t.tenant_name === 'Lito Lapid');
  assert.equal(ana.tenant_status, 'active');
  assert.equal(lito.tenant_status, 'archived');
  assert.ok(Number(lito.overdue) > 0, 'Lito is overdue');
  assert.equal(Number(d.outstanding), Number(ana.outstanding) + Number(lito.outstanding), 'the archived balance is still in the total');
});

test('the outstanding list on reports says which tenant is archived', async () => {
  const r = await ok(await owner.get(`/api/reports?from=2020-01-01&to=${today}`));
  assert.equal(r.outstanding.find((o) => o.tenant_name === 'Lito Lapid').tenant_status, 'archived');
  assert.equal(r.outstanding.find((o) => o.tenant_name === 'Ana Reyes').tenant_status, 'active');
});

test('the tenant page shows what an archived tenant still owes, which the archive confirmation states', async () => {
  const t = await ok(await owner.get(`/api/tenants/${ids.lito}`));
  assert.equal(t.tenant.status, 'archived');
  const ended = t.leases.find((l) => l.lease_id === ids.litoLease);
  assert.ok(Number(ended.outstanding) > 0, 'the ended lease still shows an amount owed');
});

test('the tenants screen names the lease file input, states the archive balance, and the dashboard labels archived rows', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
  assert.match(read('views/tenants.js'), /type: 'file', id: 'lease-doc-file'/);
  assert.match(read('views/tenants.js'), /h\('label', \{ for: 'lease-doc-file' \}/);
  assert.match(read('views/tenants.js'), /They still owe \$\{peso\(/);
  assert.match(read('views/dashboard.js'), /tenant_status === 'archived' \? ' \(archived\)'/);
});
