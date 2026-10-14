'use strict';

// QA r4 lane C02 (stays server). Each test names the finding it covers.
// Blank fees mean 0; a blank accommodation total is refused; a save says whether it changed anything;
// channel payouts only on channel bookings; a nightly price is capped at ₱1,000,000; a blank price says how many it cleared.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

let srv; let owner; let prop; const u = {};
const d = (n) => ical.addDays(manilaToday(), n);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qar4c02@example.com', 'QA R4 C02');
  prop = (await owner.post('/api/properties', { property_name: 'C02 House', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  for (const n of ['A', 'B', 'C', 'D']) {
    u[n] = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: n, unit_type: 'studio', nightly_rate: '2000', max_guests: 4, room_type: 'studio' })).data.unit;
  }
});
test.after(async () => { await srv.close(); });

const book = async (unit, from, to, extra = {}) => {
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(from), check_out: d(to), guest_name: 'Guest', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.reservation;
};
const money = async (id, col) => (await sql(`SELECT ${col}::text AS v FROM bookings WHERE booking_id = $1`, [id]))[0].v;

test('money#16 a blank cleaning fee on Edit reservation is saved as 0, and the save says it changed', async () => {
  const b = await book(u.A, 400, 402, { channel: 'airbnb', accommodation_total: '5000', cleaning_fee: '500', channel_fee: '300' });
  const r = await owner.patch(`/api/reservations/${b.booking_id}`, { cleaning_fee: '' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.changed, true);
  assert.equal(await money(b.booking_id, 'cleaning_fee'), '0.00');
});

test('money#16 a blank or null channel fee and a blank other fee on Edit are saved as 0', async () => {
  const b = await book(u.B, 410, 412, { channel: 'airbnb', accommodation_total: '5000', channel_fee: '300', other_fees: '75' });
  const r = await owner.patch(`/api/reservations/${b.booking_id}`, { channel_fee: null, other_fees: '' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.changed, true);
  assert.equal(await money(b.booking_id, 'channel_fee'), '0.00');
  assert.equal(await money(b.booking_id, 'other_fees'), '0.00');
});

test('money#16 a blank accommodation total is refused on that field and nothing is saved', async () => {
  const b = await book(u.C, 420, 422, { channel: 'direct', accommodation_total: '5000' });
  const r = await owner.patch(`/api/reservations/${b.booking_id}`, { accommodation_total: '', notes: 'Late arrival' });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.accommodation_total, 'Accommodation total is required. Type 0 for a free stay.');
  assert.equal(await money(b.booking_id, 'accommodation_total'), '5000.00');
  assert.equal((await sql('SELECT notes FROM bookings WHERE booking_id = $1', [b.booking_id]))[0].notes, null);
});

test('money#16 a save that writes nothing says changed false', async () => {
  const b = await book(u.D, 430, 432, { channel: 'direct', accommodation_total: '5000', cleaning_fee: '500' });
  const same = await owner.patch(`/api/reservations/${b.booking_id}`, { accommodation_total: '5000', cleaning_fee: '500.00' });
  assert.equal(same.status, 200, JSON.stringify(same.data));
  assert.equal(same.data.changed, false);
  const zeroAlready = await owner.patch(`/api/reservations/${b.booking_id}`, { other_fees: '' });
  assert.equal(zeroAlready.status, 200, JSON.stringify(zeroAlready.data));
  assert.equal(zeroAlready.data.changed, false);
});

test('money#17 channel payout is refused on a direct booking and accepted on a channel booking', async () => {
  const pay = { amount: '100', payment_date: manilaToday(), payment_method: 'channel_payout' };
  const direct = await book(u.A, 440, 442, { channel: 'direct', accommodation_total: '5000' });
  const refused = await owner.post(`/api/reservations/${direct.booking_id}/payments`, pay);
  assert.equal(refused.status, 400, JSON.stringify(refused.data));
  assert.equal(refused.data.fields.payment_method, 'Channel payout is only for bookings made through a channel.');
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM booking_payments WHERE booking_id = $1', [direct.booking_id]))[0].n, 0);
  const airbnb = await book(u.B, 440, 442, { channel: 'airbnb', accommodation_total: '5000' });
  const ok = await owner.post(`/api/reservations/${airbnb.booking_id}/payments`, pay);
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
});

test('calendar#3 a nightly price above ₱1,000,000 is refused, and exactly ₱1,000,000 is saved', async () => {
  const put = (price) => owner.raw('PUT', '/api/rates', { unit_id: u.A.unit_id, start_date: d(500), end_date: d(500), price });
  const over = await put('1000001');
  assert.equal(over.status, 400, JSON.stringify(over.data));
  assert.equal(over.data.fields.price, "A nightly price can't be more than ₱1,000,000.");
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM nightly_rates WHERE unit_id = $1', [u.A.unit_id]))[0].n, 0);
  assert.equal((await put('1000000')).status, 200);
});

test('calendar#1 a blank nightly price clears the set prices in the range and says how many', async () => {
  const put = (price) => owner.raw('PUT', '/api/rates', { unit_id: u.B.unit_id, start_date: d(510), end_date: d(511), price });
  assert.equal((await put('2500')).status, 200);
  const cleared = await put('');
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
  assert.equal(cleared.data.cleared, 2);
  const none = await put('');
  assert.equal(none.status, 200, JSON.stringify(none.data));
  assert.equal(none.data.cleared, 0);
});
