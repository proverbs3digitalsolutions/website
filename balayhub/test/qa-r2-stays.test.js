'use strict';

// QA r2 lane A03: stays server fixes. Each test names the finding it covers.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const balancepay = require('../src/routes/balancepay');

let srv; let owner; let prop; let org; let userId; const u = {};
const d = (n) => ical.addDays(manilaToday(), n);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'r2stays@example.com', 'R2 Stays');
  org = (await sql(`SELECT organization_id FROM organizations WHERE name = 'R2 Stays'`))[0].organization_id;
  userId = (await sql(`SELECT user_id FROM users WHERE email = 'r2stays@example.com'`))[0].user_id;
  prop = (await owner.post('/api/properties', { property_name: 'R2 House', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  for (const n of ['R1', 'R2', 'R3', 'R4', 'R5']) {
    u[n] = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: n, unit_type: 'studio', nightly_rate: '2000', max_guests: 4, room_type: 'studio' })).data.unit;
  }
});
test.after(async () => { await srv.close(); });

const stay = async (unit, from, to, extra = {}) => {
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(from), check_out: d(to), guest_name: 'Guest', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.reservation;
};

test('calendar#2 a nightly override of 0 is refused, a blank still clears it', async () => {
  const put = (price) => owner.raw('PUT', '/api/rates', { unit_id: u.R1.unit_id, start_date: d(300), end_date: d(301), price });
  const zero = await put('0');
  assert.equal(zero.status, 400, JSON.stringify(zero.data));
  assert.ok(zero.data.fields.price);
  assert.equal((await put('2500')).status, 200);
  assert.equal((await put('')).status, 200);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM nightly_rates WHERE unit_id = $1`, [u.R1.unit_id]))[0].n, 0);
});

test('calendar#1 and #7 rooms are added to a group in one call, all or nothing; the list counts active rooms', async () => {
  const g = await owner.post('/api/booking-groups', { name: 'Reyes', guest: { full_name: 'Reyes' }, rooms: [
    { unit_id: u.R1.unit_id, check_in: d(40), check_out: d(42) }, { unit_id: u.R2.unit_id, check_in: d(40), check_out: d(42) }] });
  assert.equal(g.status, 201, JSON.stringify(g.data));
  const id = g.data.group.group_id;
  const rooms = () => sql(`SELECT booking_id, status FROM bookings WHERE group_id = $1`, [id]);
  // The second room has no free room: nothing is added, not even the first.
  const bad = await owner.post(`/api/booking-groups/${id}/rooms`, { rooms: [
    { unit_id: u.R3.unit_id, check_in: d(40), check_out: d(42) }, { unit_id: u.R1.unit_id, check_in: d(40), check_out: d(42) }] });
  assert.equal(bad.status, 409, JSON.stringify(bad.data));
  assert.match(bad.data.error, /Nothing was saved/);
  assert.equal((await rooms()).length, 2);
  // Both fine: both added.
  const ok = await owner.post(`/api/booking-groups/${id}/rooms`, { rooms: [
    { unit_id: u.R3.unit_id, check_in: d(40), check_out: d(42) }, { room_type: 'studio', property_id: prop.property_id, check_in: d(40), check_out: d(42) }] });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.booking_ids.length, 2);
  assert.equal(ok.data.group.rooms, 4);
  // Bad lengths and field errors name the room.
  assert.equal((await owner.post(`/api/booking-groups/${id}/rooms`, { rooms: [] })).status, 400);
  const field = await owner.post(`/api/booking-groups/${id}/rooms`, { rooms: [{ unit_id: u.R5.unit_id, check_in: d(50), check_out: d(49) }] });
  assert.equal(field.status, 400);
  assert.ok(field.data.fields['rooms.0.check_out']);
  // The old single-room body still works.
  const single = await owner.post(`/api/booking-groups/${id}/rooms`, { unit_id: u.R5.unit_id, check_in: d(40), check_out: d(42) });
  assert.equal(single.status, 201, JSON.stringify(single.data));
  assert.ok(single.data.booking_id);
  // A cancelled room drops out of the list count.
  await owner.post(`/api/booking-groups/${id}/rooms/${single.data.booking_id}/remove`, { reason: 'Changed mind' });
  const row = (await owner.get('/api/booking-groups')).data.groups.find((x) => x.group_id === id);
  assert.equal(row.rooms, 4);
  assert.equal((await owner.get(`/api/booking-groups/${id}`)).data.totals.rooms, 4);
});

test('money#2 a channel fee above the stay total is refused on create and edit', async () => {
  const over = await owner.post('/api/reservations', { unit_id: u.R4.unit_id, check_in: d(60), check_out: d(61), guest_name: 'Fee', channel: 'airbnb', accommodation_total: '1000', cleaning_fee: '0', channel_fee: '1500' });
  assert.equal(over.status, 400, JSON.stringify(over.data));
  assert.match(over.data.fields.channel_fee, /more than the stay total/);
  const r = await stay(u.R4, 60, 61, { channel: 'airbnb', accommodation_total: '1000', cleaning_fee: '0', channel_fee: '1000' });
  const patch = await owner.patch(`/api/reservations/${r.booking_id}`, { channel_fee: '1000.01' });
  assert.equal(patch.status, 400, JSON.stringify(patch.data));
  // Raising the total and the fee together is judged on the merged values.
  assert.equal((await owner.patch(`/api/reservations/${r.booking_id}`, { accommodation_total: '3000', channel_fee: '2000' })).status, 200);
  // The fee alone, against the stored total.
  assert.equal((await owner.patch(`/api/reservations/${r.booking_id}`, { channel_fee: '3000.01' })).status, 400);
});

test('money#5 a payment cannot be voided while refunds would then exceed the payments', async () => {
  const r = await stay(u.R4, 70, 71);
  const pay = (await owner.post(`/api/reservations/${r.booking_id}/payments`, { amount: '1000', payment_date: manilaToday(), payment_method: 'cash' }, { 'Idempotency-Key': 'r2-void-0001' })).data.payment_id;
  const pay2 = (await owner.post(`/api/reservations/${r.booking_id}/payments`, { amount: '500', payment_date: manilaToday(), payment_method: 'cash' }, { 'Idempotency-Key': 'r2-void-0002' })).data.payment_id;
  const [ref] = await sql(`INSERT INTO booking_refunds (organization_id, booking_id, amount, refund_date, method, reason, recorded_by) VALUES ($1,$2,800,$3,'cash','Refund',$4) RETURNING refund_id`, [org, r.booking_id, manilaToday(), userId]);
  const blocked = await owner.post(`/api/booking-payments/${pay}/void`, { reason: 'Mistake' });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
  assert.equal(blocked.data.code, 'REFUNDS_EXCEED_PAYMENTS');
  assert.match(blocked.data.error, /^Void the ₱800\.00 refund from .+ first, then this payment\.$/);
  assert.equal((await sql(`SELECT voided_at FROM booking_payments WHERE payment_id = $1`, [pay]))[0].voided_at, null);
  // Voiding the smaller one still leaves 1000 >= 800.
  assert.equal((await owner.post(`/api/booking-payments/${pay2}/void`, { reason: 'Mistake' })).status, 200);
  await sql(`UPDATE booking_refunds SET voided_at = now(), void_reason = 'Test' WHERE refund_id = $1`, [ref.refund_id]);
  assert.equal((await owner.post(`/api/booking-payments/${pay}/void`, { reason: 'Mistake' })).status, 200);
});

test('money#8 the reservations CSV leaves the balance blank for a cancelled stay', async () => {
  const live = await stay(u.R4, 80, 81);
  const dead = await stay(u.R4, 82, 83);
  await owner.post(`/api/reservations/${dead.booking_id}/cancel`, { reason: 'Guest cancelled' });
  const csv = (await owner.get('/api/reservations/export?view=all')).data;
  const line = (code) => String(csv).split('\r\n').find((l) => l.includes(code)).split(',');
  assert.notEqual(line(live.confirmation_code)[13], '');
  assert.equal(line(dead.confirmation_code)[13], '');
});

test('money#10 % and _ in search are plain characters', async () => {
  await stay(u.R5, 90, 91, { guest_name: 'Plain Name' });
  await stay(u.R5, 92, 93, { guest_name: 'Cent%Guy' });
  const names = async (path, key, q) => (await owner.get(`${path}?${path === '/api/reservations' ? 'view=all&' : ''}q=${encodeURIComponent(q)}`)).data[key];
  assert.equal((await names('/api/reservations', 'reservations', '%')).length, 1);
  assert.equal((await names('/api/reservations', 'reservations', 'Plain_Name')).length, 0);
  assert.equal((await names('/api/guests', 'guests', '%')).length, 1);
  assert.equal((await names('/api/guests', 'guests', 'P_ain')).length, 0);
});

test('money#11 the activity log records only the fields that changed', async () => {
  const r = await stay(u.R5, 100, 101, { notes: 'same' });
  const p = await owner.patch(`/api/reservations/${r.booking_id}`, { notes: 'new note', check_in: r.check_in, check_out: r.check_out, channel_fee: r.channel_fee, accommodation_total: r.accommodation_total });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const [row] = await sql(`SELECT details FROM audit_logs WHERE record_id = $1 AND action = 'reservation.updated'`, [r.booking_id]);
  assert.deepEqual(row.details.before, { notes: 'same' });
  assert.deepEqual(row.details.after, { notes: 'new note' });
  // Nothing changed: no write, no audit line.
  await owner.patch(`/api/reservations/${r.booking_id}`, { notes: 'new note' });
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE record_id = $1 AND action = 'reservation.updated'`, [r.booking_id]))[0].n, 1);
});

test('S3 changing the channel fee closes open payment checkouts', async () => {
  const r = await stay(u.R5, 110, 111, { channel: 'airbnb', accommodation_total: '2000', cleaning_fee: '0' });
  const saved = balancepay.closeOpenCheckouts;
  const closed = [];
  balancepay.closeOpenCheckouts = async (id) => { closed.push(id); };
  try {
    await owner.patch(`/api/reservations/${r.booking_id}`, { notes: 'note only' });
    assert.equal(closed.length, 0);
    await owner.patch(`/api/reservations/${r.booking_id}`, { channel_fee: '100' });
    assert.deepEqual(closed, [r.booking_id]);
  } finally { balancepay.closeOpenCheckouts = saved; }
});

test('a group asked for more rooms of a type than are free says how many are free; with none free, the plain message', async () => {
  // Nights 200 to 202: R1 to R3 are taken, so two studios (R4 and R5) are free.
  for (const n of ['R1', 'R2', 'R3']) await stay(u[n], 200, 202);
  const g = await owner.post('/api/booking-groups', { name: 'Free count', guest: { full_name: 'Free Count' }, rooms: [
    { unit_id: u.R4.unit_id, check_in: d(230), check_out: d(232) }, { unit_id: u.R5.unit_id, check_in: d(230), check_out: d(232) }] });
  assert.equal(g.status, 201, JSON.stringify(g.data));
  const id = g.data.group.group_id;
  const studios = (n) => Array.from({ length: n }, () => ({ room_type: 'studio', property_id: prop.property_id, check_in: d(200), check_out: d(202) }));
  const add = (n) => owner.post(`/api/booking-groups/${id}/rooms`, { rooms: studios(n) });
  const groupBookings = async () => (await sql(`SELECT COUNT(*)::int AS n FROM bookings WHERE group_id = $1`, [id]))[0].n;

  const three = await add(3);
  assert.equal(three.status, 409, JSON.stringify(three.data));
  assert.equal(three.data.code, 'NO_FREE_ROOM');
  assert.equal(three.data.error, 'Only 2 studio rooms are free on these dates (you asked for 3). Nothing was saved.');
  assert.equal(await groupBookings(), 2);
  // The New group dialog shares this path: the same wording, and a refused create leaves no group behind.
  const created = await owner.post('/api/booking-groups', { name: 'Refused count', guest: { full_name: 'Refused Count' }, rooms: studios(3) });
  assert.equal(created.status, 409, JSON.stringify(created.data));
  assert.equal(created.data.error, 'Only 2 studio rooms are free on these dates (you asked for 3). Nothing was saved.');
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM booking_groups WHERE name = 'Refused count'`))[0].n, 0);

  await stay(u.R5, 200, 202);
  const two = await add(2);
  assert.equal(two.data.error, 'Only 1 studio room is free on these dates (you asked for 2). Nothing was saved.');

  await stay(u.R4, 200, 202);
  const one = await add(1);
  assert.equal(one.status, 409, JSON.stringify(one.data));
  assert.equal(one.data.error, 'No free studio at this property on these dates. Nothing was saved.');
  assert.equal(await groupBookings(), 2);
});
