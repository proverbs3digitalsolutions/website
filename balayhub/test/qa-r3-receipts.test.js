'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

// QA r3 lane C03 (receipts and guest messages): a channel fee on a direct booking is
// not owed, so the receipt and the {{balance}} message must not take it off. A channel
// booking's fee is shown as an adjustment line, so the receipt adds up (money#11).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const receipts = require('../src/lib/receipts');
const messaging = require('../src/lib/messaging');

let srv; let owner; let unit;
const d = (n) => ical.addDays(manilaToday(), n);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qar3receipts@example.com', 'QA R3 Receipts');
  const prop = (await owner.post('/api/properties', { property_name: 'R3 House', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'R3 Unit', unit_type: 'studio', nightly_rate: '2000', max_guests: 4, room_type: 'studio' })).data.unit;
});
test.after(async () => { await srv.close(); });

// A 9,500 stay, then a cash payment of 8,000.
const paidStay = async (from, to, extra = {}) => {
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(from), check_out: d(to), guest_name: 'Guest', accommodation_total: '9500', cleaning_fee: '0', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const pay = await owner.post(`/api/reservations/${r.data.reservation.booking_id}/payments`, { amount: '8000', payment_date: manilaToday(), payment_method: 'cash' });
  assert.equal(pay.status, 201, JSON.stringify(pay.data));
  return { booking_id: r.data.reservation.booking_id, payment_id: pay.data.payment_id };
};

test('money#11 a channel fee stored on a direct booking is not taken off the receipt or the balance message', async () => {
  const { booking_id, payment_id } = await paidStay(60, 62);
  // Direct booking with a fee set by SQL (the API refuses one, legacy rows may hold it).
  await sql('UPDATE bookings SET channel_fee = 300 WHERE booking_id = $1', [booking_id]);

  const text = receipts.receiptText(await receipts.receiptData(payment_id));
  assert.match(text, /Booking total: ₱9,500\.00/);
  assert.doesNotMatch(text, /Adjustments/, 'a direct booking has no channel adjustment');
  assert.match(text, /Remaining balance: ₱1,500\.00/, '9,500 minus 8,000 paid');

  const ctx = await messaging.bookingContext(booking_id);
  assert.equal(messaging.variables(ctx, 'Maria Santos').balance, '₱1,500.00');
});

test('money#11 a channel fee on a channel booking shows as an adjustment, so the receipt adds up', async () => {
  const { booking_id, payment_id } = await paidStay(70, 72, { channel: 'airbnb', channel_fee: '300' });

  const text = receipts.receiptText(await receipts.receiptData(payment_id));
  assert.match(text, /Booking total: ₱9,500\.00/);
  assert.match(text, /Adjustments \(settled through the booking channel\): -₱300\.00/);
  // 9,500 total, minus 300 adjustment, minus 8,000 paid, leaves 1,200.
  assert.match(text, /Remaining balance: ₱1,200\.00/);
  assert.ok(text.indexOf('Adjustments') < text.indexOf('Remaining balance'), 'the adjustment comes before the remaining balance');

  const ctx = await messaging.bookingContext(booking_id);
  assert.equal(messaging.variables(ctx, 'Maria Santos').balance, '₱1,200.00');
});
