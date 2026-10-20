'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

// QA r24 BKG-2: a receipt is a record of the payment as it stood. Total, charge lines, extras total and
// balance are all as of that payment, so the lines add up however the stay changes afterwards.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const receipts = require('../src/lib/receipts');

let srv; let owner; let unit;
const d = (n) => ical.addDays(manilaToday(), n);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qar24receipts@example.com', 'QA R24 Receipts');
  const prop = (await owner.post('/api/properties', { property_name: 'R24 House', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'R24 Unit', unit_type: 'studio', nightly_rate: '2000', max_guests: 4, room_type: 'studio' })).data.unit;
});
test.after(async () => { await srv.close(); });

const stay = async (from, to) => {
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(from), check_out: d(to), guest_name: 'Guest', accommodation_total: '9500', cleaning_fee: '0' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.reservation.booking_id;
};
const charge = async (id, price, description = 'Extra') => {
  const c = await owner.post(`/api/reservations/${id}/charges`, { category: 'other', description, unit_price: price });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  return c.data.charge.charge_id;
};
const pay = async (id, amount) => {
  const p = await owner.post(`/api/reservations/${id}/payments`, { amount, payment_date: manilaToday(), payment_method: 'cash' });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  return p.data.payment_id;
};
const sum = (r) => (Number(r.total_amount) - Number(r.adjustments) - 4000 + 0).toFixed(2);

test('BKG-2 a later charge and a later refund stay off an earlier payment receipt, and the lines add up', async () => {
  const id = await stay(80, 82);
  await charge(id, '300', 'Early bed');
  const paymentId = await pay(id, '4000');
  await charge(id, '100', 'Late snack');
  const rf = await owner.post(`/api/reservations/${id}/refunds`, { amount: '1500.00', refund_date: manilaToday(), method: 'gcash', reason: 'Goodwill' });
  assert.equal(rf.status, 201, JSON.stringify(rf.data));

  const r = await receipts.receiptData(paymentId);
  assert.equal(r.total_amount, '9800.00', '9,500 + the 300 charge that existed then');
  assert.equal(r.extras_total, '300.00');
  assert.deepEqual(r.charges.map((c) => c.description), ['Early bed']);
  assert.equal(r.balance_after, '5800.00');
  assert.equal(r.balance_after, sum(r), 'total - adjustments - paid so far + refunded so far');
  const text = receipts.receiptText(r);
  assert.doesNotMatch(text, /Late snack/);
  assert.match(text, /Booking total: ₱9,800\.00/);
  assert.match(text, /Remaining balance: ₱5,800\.00/);
});

test('BKG-2 a charge added before the payment and voided after it is still on the receipt', async () => {
  const id = await stay(84, 86);
  const chargeId = await charge(id, '200', 'Was there');
  const paymentId = await pay(id, '1000');
  const v = await owner.post(`/api/charges/${chargeId}/void`, { reason: 'Changed mind' });
  assert.equal(v.status, 200, JSON.stringify(v.data));

  const r = await receipts.receiptData(paymentId);
  assert.deepEqual(r.charges.map((c) => c.description), ['Was there']);
  assert.equal(r.extras_total, '200.00');
  assert.equal(r.total_amount, '9700.00');
  assert.equal(r.balance_after, '8700.00');
});

test('BKG-2 the newest payment with nothing after it matches the stay page', async () => {
  const id = await stay(88, 90);
  await charge(id, '250');
  const paymentId = await pay(id, '2000');
  const r = await receipts.receiptData(paymentId);
  const page = (await owner.get(`/api/reservations/${id}`)).data.reservation;
  assert.equal(r.total_amount, page.total_amount);
  assert.equal(r.extras_total, page.extras_total);
  assert.equal(r.balance_after, page.balance);
});
