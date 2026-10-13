'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

let srv; let owner; let prop; let free; let leased;
const d = (n) => ical.addDays(manilaToday(), n);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Both Rentals');
  await owner.patch('/api/workspace', { business_type: 'both' });
  prop = (await owner.post('/api/properties', { property_name: 'Mixed House', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  const mk = async (name) => (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '2000', max_guests: 4, room_type: 'studio' })).data.unit;
  free = await mk('B Free');
  leased = await mk('A Leased');
  const t = (await owner.post('/api/tenants', { full_name: 'Monthly Tenant', phone: '09170000001' })).data.tenant;
  await sql(`INSERT INTO leases (organization_id, unit_id, tenant_id, start_date, end_date, monthly_rent, due_day, lease_status)
             SELECT p.organization_id, $1, $2, $3, $4, 9000, 1, 'active' FROM units u JOIN properties p USING (property_id) WHERE u.unit_id = $1`,
  [leased.unit_id, t.tenant_id, d(5), d(60)]);
});
test.after(async () => { await srv.close(); });

test('#37 unpaid and partial filters leave out cancelled bookings', async () => {
  const mkRes = async (n) => (await owner.post('/api/reservations', { unit_id: free.unit_id, check_in: d(100 + n * 3), check_out: d(102 + n * 3), guest_name: `G${n}` })).data.reservation;
  const a = await mkRes(0); const b = await mkRes(1);
  assert.equal((await owner.post(`/api/reservations/${b.booking_id}/cancel`, { reason: 'Guest cancelled' })).status, 200);
  const list = async (payment) => (await owner.get(`/api/reservations?view=all&payment=${payment}`)).data.reservations.map((r) => r.booking_id);
  const unpaid = await list('unpaid');
  assert.ok(unpaid.includes(a.booking_id));
  assert.ok(!unpaid.includes(b.booking_id));
  await owner.post(`/api/reservations/${a.booking_id}/payments`, { amount: '100', payment_date: manilaToday(), payment_method: 'cash' }, { 'Idempotency-Key': 'l10-partial-0001' });
  assert.ok(!(await list('partial')).includes(b.booking_id));
  assert.ok((await list('partial')).includes(a.booking_id));
});

test('#28 a unit with an active lease cannot be booked over the lease dates', async () => {
  const r = await owner.post('/api/reservations', { unit_id: leased.unit_id, check_in: d(10), check_out: d(12), guest_name: 'Clash' });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.match(r.data.error, /lease/i);
  assert.ok(r.data.fields.check_in);
  // Outside the lease dates is fine, and so is a unit with no lease.
  assert.equal((await owner.post('/api/reservations', { unit_id: leased.unit_id, check_in: d(1), check_out: d(3), guest_name: 'Before' })).status, 201);
  assert.equal((await owner.post('/api/reservations', { unit_id: free.unit_id, check_in: d(10), check_out: d(12), guest_name: 'Fine' })).status, 201);
});

test('#28 moving a stay onto a leased unit is refused', async () => {
  const mv = (await owner.post('/api/reservations', { unit_id: free.unit_id, check_in: d(20), check_out: d(22), guest_name: 'Mover' })).data.reservation;
  const r = await owner.patch(`/api/reservations/${mv.booking_id}`, { unit_id: leased.unit_id });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.match(r.data.error, /lease/i);
});

test('#28 a room type skips the leased unit', async () => {
  const r = await owner.post('/api/reservations', { property_id: prop.property_id, room_type: 'studio', check_in: d(30), check_out: d(32), guest_name: 'ByType' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.reservation.unit_id, free.unit_id);
});

test('#28 a long-term-only workspace cannot create or move stays', async () => {
  const mv = (await owner.post('/api/reservations', { unit_id: free.unit_id, check_in: d(200), check_out: d(202), guest_name: 'Pre' })).data.reservation;
  await owner.patch('/api/workspace', { business_type: 'long_term' });
  const r = await owner.post('/api/reservations', { unit_id: free.unit_id, check_in: d(210), check_out: d(212), guest_name: 'Nope' });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.match(r.data.error, /long-term/i);
  assert.equal((await owner.patch(`/api/reservations/${mv.booking_id}`, { check_in: d(201) })).status, 409);
  assert.equal((await owner.patch(`/api/reservations/${mv.booking_id}`, { notes: 'still editable' })).status, 200);
  await owner.patch('/api/workspace', { business_type: 'both' });
});
