'use strict';

// QA round 3, money#11 (guest side): a channel fee on a direct booking must not lower what the
// guest is asked to pay. The write side refuses such a fee (C01); here the fee is set by SQL so
// this file only checks the pay page, the payment link, the PayMongo amount and proof checks.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const realFetch = globalThis.fetch;
const checkouts = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.paymongo.com/')) return realFetch(url, opts);
  const a = JSON.parse(opts.body).data.attributes;
  checkouts.push(a);
  const id = `cs_${crypto.randomBytes(6).toString('hex')}`;
  const session = { id, attributes: { checkout_url: `https://checkout.paymongo.com/${id}`, status: 'active', payments: [] } };
  return new Response(JSON.stringify({ data: session }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const d = (n) => ical.addDays(manilaToday(), n);
let srv; let owner; let unit;

// A reservation with 1500 already paid, and a channel fee of 300 (set by SQL for direct bookings).
async function bookingWith({ offset, channel, fee }) {
  const b = (await owner.post('/api/reservations', {
    unit_id: unit.unit_id, check_in: d(offset), check_out: d(offset + 2), guest_name: 'Ana Cruz', guest_email: 'ana@example.com',
    ...(channel ? { channel, channel_fee: fee } : {}),
  })).data.reservation;
  await owner.post(`/api/reservations/${b.booking_id}/payments`, { amount: '1500', payment_date: manilaToday(), payment_method: 'gcash' });
  if (!channel) await sql('UPDATE bookings SET channel_fee = $2 WHERE booking_id = $1', [b.booking_id, fee]);
  const [{ total_amount }] = await sql('SELECT total_amount FROM bookings WHERE booking_id = $1', [b.booking_id]);
  const token = (await owner.get(`/api/reservations/${b.booking_id}/payment-link`)).data.link.split('/#/pay/')[1];
  return { b, token, total: Number(total_amount) };
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Fee Stays');
  await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890' });
  const p = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500' })).data.unit;
});
test.after(async () => { globalThis.fetch = realFetch; await srv.close(); });

test('a direct booking with a stored channel fee asks the guest for its total less payments', async () => {
  const { b, token, total } = await bookingWith({ offset: 10, fee: '300' });
  const owed = (total - 1500).toFixed(2);
  assert.equal((await owner.get(`/api/reservations/${b.booking_id}/payment-link`)).data.balance, owed);
  const pg = (await client(srv.base).get(`/api/public/pay/${token}`)).data;
  assert.equal(pg.balance_due, owed);
  assert.equal(pg.paid, '1500.00');
  assert.equal(pg.bill.adjustments, '0.00');
  assert.equal((await client(srv.base).post(`/api/public/pay/${token}/checkout`)).status, 200);
  assert.equal(checkouts.at(-1).line_items[0].amount, Math.round(Number(owed) * 100), 'PayMongo charges the full amount owed');
});

test('a channel booking keeps its channel fee as an Adjustments line', async () => {
  const { token, total } = await bookingWith({ offset: 20, channel: 'airbnb', fee: '300' });
  const pg = (await client(srv.base).get(`/api/public/pay/${token}`)).data;
  assert.equal(pg.balance_due, (total - 300 - 1500).toFixed(2));
  assert.equal(pg.bill.adjustments, '300.00');
});

test('a guest can send a proof for the whole amount owed on a direct booking', async () => {
  await owner.patch('/api/workspace/manual-payments', { enabled: true, instructions: 'GCash 0917 123 4567 (Maria Santos)' });
  const { token, total } = await bookingWith({ offset: 30, fee: '300' });
  const owed = (total - 1500).toFixed(2);
  const r = await client(srv.base).post(`/api/public/pay/${token}/proofs`, { amount: owed, method: 'gcash' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
});
