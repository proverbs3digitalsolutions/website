'use strict';
require('./helpers');

// QA round 50, PHOTOSERVER (carry 16(b) and DEP50-S1; D-132): the file route refuses a non-image on the five photo-only
// records (cleaning, damage, lost_found, inspection, deposit) with the sentence those screens use, after the access checks.
// Maintenance, expenses and the other records still take a PDF.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
const PDF = Buffer.from('%PDF-1.4\n% qa r50 photoserver\n');
const PHOTO_ONLY = 'Upload a JPG, PNG or WEBP photo up to 10 MB.';
const OWNER_EMAIL = 'qa-r50-photoserver@example.com';
const d = (n) => ical.addDays(manilaToday(), n);

let srv; let owner; let stranger; let propertyId; let bookingId; let records = {}; let maintenanceId; let expenseId;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, OWNER_EMAIL, 'QA r50 photoserver');
  stranger = await ownerAccount(srv.base, 'qa-r50-photoserver-other@example.com', 'QA r50 photoserver other');
  propertyId = (await owner.post('/api/properties', { property_name: 'QA r50 photoserver A', property_type: 'condominium', address: '1 QA r50 St', city: 'Taguig', province: 'Metro Manila' })).data.property.property_id;
  const unit = (await owner.post(`/api/properties/${propertyId}/units`, { unit_name: 'QA r50 photoserver 1', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  bookingId = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(-3), check_out: d(-1), guest_name: 'QA r50 photoserver guest' })).data.reservation.booking_id;

  const dep = await owner.post(`/api/reservations/${bookingId}/deposit`, { amount: '1000', received_date: d(-3), method: 'cash' });
  assert.equal(dep.status, 201, JSON.stringify(dep.data));
  const task = await owner.post('/api/cleaning-tasks', { unit_id: unit.unit_id, due_date: d(0) });
  assert.equal(task.status, 201, JSON.stringify(task.data));
  const damage = await owner.post(`/api/reservations/${bookingId}/damage`, { description: 'QA r50 photoserver scuffed wall' });
  assert.equal(damage.status, 201, JSON.stringify(damage.data));
  const item = await owner.post(`/api/reservations/${bookingId}/lost-found`, { description: 'QA r50 photoserver phone charger' });
  assert.equal(item.status, 201, JSON.stringify(item.data));
  const [{ user_id: ownerId, organization_id: orgId }] = await sql('SELECT user_id, organization_id FROM users WHERE email = $1', [OWNER_EMAIL]);
  const [{ inspection_id: inspectionId }] = await sql(
    `INSERT INTO cleaning_inspections (organization_id, task_id, inspected_by, items, score, passed)
     VALUES ($1, $2, $3, '[]', 80, false) RETURNING inspection_id`, [orgId, task.data.task.task_id, ownerId]);

  records = {
    deposit: dep.data.deposit.deposit_id,
    cleaning: task.data.task.task_id,
    damage: damage.data.report.report_id,
    lost_found: item.data.item.item_id,
    inspection: inspectionId,
  };
  maintenanceId = (await owner.post('/api/maintenance', { property_id: propertyId, title: 'QA r50 photoserver leaking tap', priority: 'medium' })).data.request.request_id;
  expenseId = (await owner.post('/api/expenses', { property_id: propertyId, expense_date: d(0), category: 'utilities', amount: '500', description: 'QA r50 photoserver bill' })).data.expense.expense_id;
});
test.after(async () => { await srv.close(); });

test('a PDF on a deposit, cleaning, damage, lost-and-found or inspection record is refused with the photo sentence; nothing is stored', async () => {
  for (const [type, id] of Object.entries(records)) {
    const r = await owner.raw('POST', `/api/files?record_type=${type}&record_id=${id}`, PDF, { 'Content-Type': 'application/pdf' });
    assert.equal(r.status, 415, `${type}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.error, PHOTO_ONLY, type);
    assert.equal(r.data.code, 'UNSUPPORTED_FILE', type);
  }
  const [{ n }] = await sql('SELECT COUNT(*)::int AS n FROM files WHERE related_record_type = ANY($1::text[])', [Object.keys(records)]);
  assert.equal(n, 0);
});

test('a PNG on each photo-only record is still stored', async () => {
  for (const [type, id] of Object.entries(records)) {
    const r = await owner.raw('POST', `/api/files?record_type=${type}&record_id=${id}`, PNG, { 'Content-Type': 'image/png' });
    assert.equal(r.status, 201, `${type}: ${JSON.stringify(r.data)}`);
  }
});

test('a PDF is still stored on a maintenance request and on an expense', async () => {
  for (const [type, id] of [['maintenance', maintenanceId], ['expense', expenseId]]) {
    const r = await owner.raw('POST', `/api/files?record_type=${type}&record_id=${id}`, PDF, { 'Content-Type': 'application/pdf' });
    assert.equal(r.status, 201, `${type}: ${JSON.stringify(r.data)}`);
  }
});

test('a PDF on another workspace\'s deposit is "not found", not the photo sentence', async () => {
  const r = await stranger.raw('POST', `/api/files?record_type=deposit&record_id=${records.deposit}`, PDF, { 'Content-Type': 'application/pdf' });
  assert.equal(r.status, 404, JSON.stringify(r.data));
  const missing = await owner.raw('POST', '/api/files?record_type=deposit&record_id=00000000-0000-0000-0000-000000000000', PDF, { 'Content-Type': 'application/pdf' });
  assert.equal(missing.status, 404, JSON.stringify(missing.data));
});
