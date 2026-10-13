'use strict';

// QA round 1, bug #38: the over-refund message printed "₱1000.00" with no thousands separator.
// Messages must use en-PH grouping with two decimals. API money fields stay plain decimal strings.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, manilaToday } = require('./helpers');
const { addDays } = require('../src/lib/holidays');

const d = (n) => addDays(manilaToday(), n);
const refundBody = (over = {}) => ({ amount: '1000.00', refund_date: d(0), method: 'gcash', reason: 'Cancelled by guest', ...over });

let srv; let owner;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-l17@example.com', 'Balay Stays L17');
});
test.after(async () => { await srv.close(); });

test('over-refund message groups thousands and keeps two decimals; the API still returns plain decimals', async () => {
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Paranaque', province: 'Metro Manila' })).data.property;
  const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: 'Paris 1208', unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, bookable_online: true, min_nights: 2,
  })).data.unit;
  const { booking_id: id } = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(20), check_out: d(22), guest_name: 'Juan Dela Cruz', guest_email: 'juan@example.com' })).data.reservation;
  assert.equal((await owner.post(`/api/reservations/${id}/payments`, { amount: '3500.00', payment_date: d(0), payment_method: 'gcash' })).status, 201);
  assert.equal((await owner.post(`/api/reservations/${id}/refunds`, refundBody({ amount: '1000.00' }))).status, 201);

  const log = (await owner.get(`/api/reservations/${id}/refunds`)).data;
  assert.equal(log.refundable, '2500.00', 'refundable is a decimal string, not a formatted peso amount');
  assert.equal(log.refunded, '1000.00');

  const over = await owner.post(`/api/reservations/${id}/refunds`, refundBody({ amount: '3000.00' }));
  assert.equal(over.status, 400);
  assert.equal(over.data.fields.amount, 'Only ₱2,500.00 is left to refund (₱3,500.00 paid, ₱1,000.00 already refunded).');

  assert.equal((await owner.post(`/api/reservations/${id}/refunds`, refundBody({ amount: '2500.00' }))).status, 201, 'exactly the rest is allowed');
  const none = await owner.post(`/api/reservations/${id}/refunds`, refundBody({ amount: '0.01' }));
  assert.equal(none.status, 400);
  assert.equal(none.data.fields.amount, 'Nothing is left to refund (₱3,500.00 paid, ₱3,500.00 already refunded).');
});
