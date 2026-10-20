'use strict';

// QA r33 lane VOIDREFUND (BKG-3, D-115): a payment void that live refunds block names those refunds.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

let srv; let owner; let org; let userId; const u = {};
const d = (n) => ical.addDays(manilaToday(), n);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'r33voidrefund@example.com', 'R33 Void Refund');
  org = (await sql(`SELECT organization_id FROM organizations WHERE name = 'R33 Void Refund'`))[0].organization_id;
  userId = (await sql(`SELECT user_id FROM users WHERE email = 'r33voidrefund@example.com'`))[0].user_id;
  const prop = (await owner.post('/api/properties', { property_name: 'R33 House', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  for (const n of ['R1', 'R2']) {
    u[n] = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: n, unit_type: 'studio', nightly_rate: '2000', max_guests: 4, room_type: 'studio' })).data.unit;
  }
});
test.after(async () => { await srv.close(); });

const stay = async (unit, from, to) => {
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(from), check_out: d(to), guest_name: 'Guest' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.reservation;
};
const pay = async (booking, amount) => (await owner.post(`/api/reservations/${booking.booking_id}/payments`,
  { amount, payment_date: manilaToday(), payment_method: 'cash' })).data.payment_id;
const refund = (bookingId, amount, date) => sql(
  `INSERT INTO booking_refunds (organization_id, booking_id, amount, refund_date, method, reason, recorded_by) VALUES ($1,$2,$3,$4,'cash','Refund',$5) RETURNING refund_id`,
  [org, bookingId, amount, date, userId]);
const voidPayment = (id) => owner.post(`/api/booking-payments/${id}/void`, { reason: 'Mistake' });

test('BKG-3 a payment void blocked by one live refund names that refund, its amount and its date', async () => {
  const r = await stay(u.R1, 100, 101);
  const payId = await pay(r, '1000');
  await refund(r.booking_id, '800', '2026-10-21');
  const blocked = await voidPayment(payId);
  assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
  assert.equal(blocked.data.code, 'REFUNDS_EXCEED_PAYMENTS');
  assert.equal(blocked.data.error, 'Void the ₱800.00 refund from Oct 21, 2026 first, then this payment.');
  assert.equal((await sql(`SELECT voided_at FROM booking_payments WHERE payment_id = $1`, [payId]))[0].voided_at, null);
});

test('BKG-3 several live refunds are named newest first, a voided refund is not, and another booking\'s refund is not', async () => {
  const r = await stay(u.R2, 110, 111);
  const other = await stay(u.R1, 120, 121);
  const payId = await pay(r, '1000');
  await refund(r.booking_id, '800', '2026-10-21');
  await refund(r.booking_id, '100', '2026-10-22');
  await refund(other.booking_id, '50', '2026-10-23');
  const both = await voidPayment(payId);
  assert.equal(both.status, 409, JSON.stringify(both.data));
  assert.equal(both.data.error, 'Void a refund first, then this payment. Refunds on this booking: ₱100.00 from Oct 22, 2026 and ₱800.00 from Oct 21, 2026.');
  // Voiding the newer refund leaves only the older one live, so only it is named.
  await sql(`UPDATE booking_refunds SET voided_at = now(), void_reason = 'Test' WHERE booking_id = $1 AND refund_date = '2026-10-22'`, [r.booking_id]);
  const one = await voidPayment(payId);
  assert.equal(one.status, 409, JSON.stringify(one.data));
  assert.equal(one.data.error, 'Void the ₱800.00 refund from Oct 21, 2026 first, then this payment.');
});
