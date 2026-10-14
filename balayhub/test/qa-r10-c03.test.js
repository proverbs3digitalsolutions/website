'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

// QA round 10, lane C03. K1: a receipt's "Remaining balance" counts only refunds recorded by that payment's time.
// #32: a lease is refused (409 LEASE_OVER_STAYS) over a confirmed short stay. #12: the address is not repeated with its city.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_01 node --test --test-concurrency=1 test/qa-r10-c03.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const receipts = require('../src/lib/receipts');
const messaging = require('../src/lib/messaging');

let srv; let owner; let prop; let tenant; let n = 0;
const d = (k) => ical.addDays(manilaToday(), k);
const unitOf = async () => (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: `R10 Unit ${++n}`, unit_type: 'studio', nightly_rate: '2000', max_guests: 4, room_type: 'studio' })).data.unit;
const stay = async (unit, from, to) => {
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(from), check_out: d(to), guest_name: 'Guest', accommodation_total: '2000', cleaning_fee: '0' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const [row] = await sql('SELECT booking_id, confirmation_code FROM bookings WHERE booking_id = $1', [r.data.reservation.booking_id]);
  return row;
};
const lease = (unit, from, to) => owner.post('/api/leases', { tenant_id: tenant.tenant_id, unit_id: unit.unit_id, start_date: d(from), ...(to === undefined ? {} : { end_date: d(to) }), monthly_rent: '8000', due_day: 5 });
const leaseRows = async (unit) => (await sql('SELECT lease_id FROM leases WHERE unit_id = $1', [unit.unit_id])).length;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qar10c03@example.com', 'QA R10 C03');
  prop = (await owner.post('/api/properties', { property_name: 'Azure Urban Residences', property_type: 'condominium', address: 'Azure Urban Residences, Parañaque', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  tenant = (await owner.post('/api/tenants', { full_name: 'Lease Tenant', phone: '09171230000' })).data.tenant;
});
test.after(async () => { await srv.close(); });

test('K1 the receipt balance counts only refunds recorded by that payment', async () => {
  const unit = await unitOf();
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(80), check_out: d(82), guest_name: 'Guest', accommodation_total: '6200', cleaning_fee: '0' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.reservation.booking_id;
  const pay = (amount) => owner.post(`/api/reservations/${id}/payments`, { amount, payment_date: manilaToday(), payment_method: 'cash' });
  const p1 = await pay('1000');
  assert.equal(p1.status, 201, JSON.stringify(p1.data));
  const rf = await owner.post(`/api/reservations/${id}/refunds`, { amount: '801', refund_date: manilaToday(), method: 'cash', reason: 'Goodwill' });
  assert.equal(rf.status, 201, JSON.stringify(rf.data));
  const p2 = await pay('500');
  assert.equal(p2.status, 201, JSON.stringify(p2.data));
  assert.equal((await receipts.receiptData(p1.data.payment_id)).balance_after, '5200.00', 'the later refund is not counted');
  assert.equal((await receipts.receiptData(p2.data.payment_id)).balance_after, '5501.00', 'a refund before the payment is counted');
});

test('#32 a lease over a confirmed stay is refused and writes nothing', async () => {
  const unit = await unitOf();
  const s = await stay(unit, 17, 18);
  const r = await lease(unit, 15);
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'LEASE_OVER_STAYS');
  assert.ok(s.confirmation_code);
  assert.equal(r.data.stays[0].confirmation_code, s.confirmation_code);
  assert.match(r.data.error, new RegExp(s.confirmation_code));
  assert.equal(await leaseRows(unit), 0);
  assert.equal((await lease(unit, 15, 16)).status, 201, 'a lease ending before the stay saves');
});

test('#32 a cancelled stay, or a stay on another unit, does not block', async () => {
  const unit = await unitOf(); const other = await unitOf();
  const s = await stay(unit, 17, 18);
  await sql("UPDATE bookings SET status = 'cancelled' WHERE booking_id = $1", [s.booking_id]);
  await stay(other, 17, 18);
  assert.equal((await lease(unit, 15)).status, 201);
});

test('#32 clearing or moving the end date over a stay is refused, the lease unchanged', async () => {
  const unit = await unitOf();
  await stay(unit, 20, 21);
  const l = await lease(unit, 15, 16);
  assert.equal(l.status, 201, JSON.stringify(l.data));
  const id = l.data.lease.lease_id;
  const clear = await owner.patch(`/api/leases/${id}`, { end_date: null });
  assert.equal(clear.status, 409, JSON.stringify(clear.data));
  assert.equal(clear.data.code, 'LEASE_OVER_STAYS');
  const later = await owner.patch(`/api/leases/${id}`, { end_date: d(22) });
  assert.equal(later.status, 409);
  assert.equal((await sql('SELECT end_date::text AS e FROM leases WHERE lease_id = $1', [id]))[0].e, d(16));
  assert.equal((await owner.patch(`/api/leases/${id}`, { end_date: d(19) })).status, 200, 'a later end that still clears the stay saves');
});

test('#12 the property address is not repeated with its city', async () => {
  const unit = await unitOf();
  const s = await stay(unit, 90, 91);
  const v = messaging.variables(await messaging.bookingContext(s.booking_id), 'Host');
  assert.equal(v.property_address, 'Azure Urban Residences, Parañaque, Metro Manila');
});
