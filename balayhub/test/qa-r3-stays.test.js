'use strict';

// QA r3 lane C01 (stays server): money#11 (SEV1) a channel fee exists only on a channel booking, and what a
// guest owes never subtracts one from a direct booking. calendar#2: a group room priced at 0 is refused.
// Each test names the finding it covers.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const DIRECT_FEE_MSG = 'Direct bookings have no channel fee. If a platform or agent took a cut, set Booked through to that channel or Other.';
const ZERO_PRICE_MSG = "Accommodation total must be greater than zero. Leave it blank to use the listing's price.";

let srv; let owner; let prop; const u = {};
const d = (n) => ical.addDays(manilaToday(), n);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qa-r3-stays@example.com', 'QA r3 Stays');
  prop = (await owner.post('/api/properties', { property_name: 'QA r3 House', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  for (const n of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) {
    u[n] = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: n, unit_type: 'studio', nightly_rate: '2000', max_guests: 4, room_type: 'studio' })).data.unit;
  }
});
test.after(async () => { await srv.close(); });

const stay = async (unit, from, to, extra = {}) => {
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(from), check_out: d(to), guest_name: 'Guest', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.reservation;
};

// A direct booking that already carries a fee, as an older version of the app wrote it.
const legacyDirectWithFee = async (unit, from, to, fee) => {
  const r = await stay(unit, from, to, { accommodation_total: '1000', cleaning_fee: '0' });
  await sql('UPDATE bookings SET channel_fee = $2 WHERE booking_id = $1', [r.booking_id, fee]);
  return r;
};

const listedIds = async (query) => (await owner.get(`/api/reservations?${query}`)).data.reservations.map((x) => x.booking_id);

test('money#11 a direct booking cannot be given a channel fee when it is created; the same fee on a channel booking is fine', async () => {
  const refused = await owner.post('/api/reservations', { unit_id: u.R1.unit_id, check_in: d(300), check_out: d(301), guest_name: 'Direct fee', accommodation_total: '1000', cleaning_fee: '0', channel_fee: '300' });
  assert.equal(refused.status, 400, JSON.stringify(refused.data));
  assert.equal(refused.data.fields.channel_fee, DIRECT_FEE_MSG);
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM bookings WHERE unit_id = $1', [u.R1.unit_id]))[0].n, 0);
  const ok = await owner.post('/api/reservations', { unit_id: u.R1.unit_id, check_in: d(300), check_out: d(301), guest_name: 'Airbnb fee', channel: 'airbnb', accommodation_total: '1000', cleaning_fee: '0', channel_fee: '300' });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(Number(ok.data.reservation.channel_fee), 300);
});

test('money#11 an airbnb stay cannot be moved to direct while it carries a fee, and a fee cannot be typed onto a direct stay', async () => {
  const r = await stay(u.R2, 300, 301, { channel: 'airbnb', accommodation_total: '1000', cleaning_fee: '0', channel_fee: '300' });
  const toDirect = await owner.patch(`/api/reservations/${r.booking_id}`, { channel: 'direct' });
  assert.equal(toDirect.status, 400, JSON.stringify(toDirect.data));
  assert.equal(toDirect.data.fields.channel_fee, DIRECT_FEE_MSG);
  assert.equal((await owner.get(`/api/reservations/${r.booking_id}`)).data.reservation.channel, 'airbnb');
  // Clearing the fee in the same change is the way across.
  const cleared = await owner.patch(`/api/reservations/${r.booking_id}`, { channel: 'direct', channel_fee: '0' });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
  assert.equal(cleared.data.reservation.channel, 'direct');
  assert.equal((await owner.patch(`/api/reservations/${r.booking_id}`, { channel_fee: '50' })).status, 400);
});

test('money#11 a direct booking that still carries an old fee owes its full amount, and the detail says the fee is ignored', async () => {
  // Total 1000, old fee 300, paid 800: the guest still owes 200 (not 200 less the old fee, which would be -100).
  const r = await legacyDirectWithFee(u.R3, 300, 302, '300');
  await owner.post(`/api/reservations/${r.booking_id}/payments`, { amount: '800', payment_date: manilaToday(), payment_method: 'cash' }, { 'Idempotency-Key': 'r3-stays-legacy-1' });
  const detail = (await owner.get(`/api/reservations/${r.booking_id}`)).data.reservation;
  assert.equal(Number(detail.balance), 200);
  assert.equal(detail.channel_fee_ignored, true);
  assert.ok((await listedIds('view=all&payment=partial')).includes(r.booking_id), 'partial filter lists it');
  assert.ok(!(await listedIds('view=all&payment=paid')).includes(r.booking_id), 'paid filter does not');
  // A channel booking with a fee is unchanged: the fee comes off what the guest owes.
  const airbnb = await stay(u.R3, 303, 304, { channel: 'airbnb', accommodation_total: '1000', cleaning_fee: '0', channel_fee: '300' });
  const airbnbDetail = (await owner.get(`/api/reservations/${airbnb.booking_id}`)).data.reservation;
  assert.equal(Number(airbnbDetail.balance), 700);
  assert.equal(airbnbDetail.channel_fee_ignored, false);
});

test('money#11 an old direct booking whose fee equals its total is still listed as unpaid', async () => {
  const r = await legacyDirectWithFee(u.R4, 300, 301, '1000');
  assert.ok((await listedIds('view=unpaid')).includes(r.booking_id));
  assert.equal(Number((await owner.get(`/api/reservations/${r.booking_id}`)).data.reservation.balance), 1000);
});

test('money#11 a group summary counts what is owed without an old direct fee', async () => {
  const g = await owner.post('/api/booking-groups', { name: 'QA r3 legacy group', guest: { full_name: 'Legacy Group' }, rooms: [
    { unit_id: u.R5.unit_id, check_in: d(300), check_out: d(301), accommodation_total: '1000', cleaning_fee: '0' },
    { unit_id: u.R1.unit_id, check_in: d(304), check_out: d(305), accommodation_total: '1000', cleaning_fee: '0' }] });
  assert.equal(g.status, 201, JSON.stringify(g.data));
  const id = g.data.group.group_id;
  await sql('UPDATE bookings SET channel_fee = total_amount WHERE group_id = $1', [id]);
  const owed = Number((await sql('SELECT SUM(total_amount) AS t FROM bookings WHERE group_id = $1', [id]))[0].t);
  assert.equal(owed, 2000);
  const detail = (await owner.get(`/api/booking-groups/${id}`)).data;
  assert.equal(Number(detail.totals.balance), owed);
});

test('calendar#2 a group room priced at 0 is refused and nothing is saved; a blank price still uses the listing, and the single-room form refuses 0 too', async () => {
  const zero = await owner.post('/api/booking-groups', { name: 'QA r3 zero price', guest: { full_name: 'Zero Price' }, rooms: [
    { unit_id: u.R6.unit_id, check_in: d(300), check_out: d(301), accommodation_total: '0' },
    { unit_id: u.R6.unit_id, check_in: d(304), check_out: d(305), accommodation_total: '1000' }] });
  assert.equal(zero.status, 400, JSON.stringify(zero.data));
  assert.equal(zero.data.fields['rooms.0.accommodation_total'], ZERO_PRICE_MSG);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM booking_groups WHERE name = 'QA r3 zero price'`))[0].n, 0);
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM bookings WHERE unit_id = $1', [u.R6.unit_id]))[0].n, 0);
  const blank = await owner.post('/api/booking-groups', { name: 'QA r3 blank price', guest: { full_name: 'Blank Price' }, rooms: [
    { unit_id: u.R6.unit_id, check_in: d(300), check_out: d(301), accommodation_total: '' },
    { unit_id: u.R1.unit_id, check_in: d(306), check_out: d(307), accommodation_total: '' }] });
  assert.equal(blank.status, 201, JSON.stringify(blank.data));
  const priced = await sql('SELECT accommodation_total FROM bookings WHERE group_id = $1 AND unit_id = $2', [blank.data.group.group_id, u.R6.unit_id]);
  assert.equal(Number(priced[0].accommodation_total), 2000);
  const single = await owner.post(`/api/booking-groups/${blank.data.group.group_id}/rooms`, { unit_id: u.R1.unit_id, check_in: d(302), check_out: d(303), accommodation_total: '0' });
  assert.equal(single.status, 400, JSON.stringify(single.data));
  assert.equal(single.data.fields.accommodation_total, ZERO_PRICE_MSG);
});

test('S1 a single manual reservation at 0 is still allowed (a free stay; the founder decides, so no change)', async () => {
  const r = await owner.post('/api/reservations', { unit_id: u.R2.unit_id, check_in: d(302), check_out: d(303), guest_name: 'Family stay', accommodation_total: '0', cleaning_fee: '0' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
});

test('money#11 editing the amount of an old direct booking is not blocked by its old fee; the fee stays ignored', async () => {
  const r = await legacyDirectWithFee(u.R6, 302, 303, '300');
  const p = await owner.patch(`/api/reservations/${r.booking_id}`, { accommodation_total: '1200' });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.reservation.channel_fee_ignored, true);
  assert.equal(Number(p.data.reservation.balance), 1200);
});
