'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const { pool } = require('../src/db');
const ical = require('../src/lib/ical');

let srv; let owner; let mgr; let staff; let propA; let propB; let group; let anaBookingId;
const u = {};
const today = manilaToday();
const d = (n) => ical.addDays(today, n);

async function invite(email, role, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: `${role} person`, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

async function addUnit(property, name, roomType) {
  const r = await owner.post(`/api/properties/${property.property_id}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, room_type: roomType });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  u[name] = r.data.unit;
}

const count = async (text, params) => (await sql(text, params))[0].n;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'groups@example.com', 'Groups Test');
  propA = (await owner.post('/api/properties', { property_name: 'Azure Residences', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  propB = (await owner.post('/api/properties', { property_name: 'Bay View', property_type: 'condominium', address: 'Roxas Blvd', city: 'Pasay', province: 'Metro Manila' })).data.property;
  await addUnit(propA, 'Unit 101', 'Studio');
  await addUnit(propA, 'Unit 102', 'Studio');
  await addUnit(propA, 'Unit 201', 'Studio');
  await addUnit(propA, 'Unit 301', 'Deluxe');
  await addUnit(propB, 'Unit 401', 'Studio');
  await addUnit(propB, 'Unit 402', 'Studio');
  mgr = await invite('mgr@example.com', 'manager', [propB.property_id]);
  staff = await invite('staff@example.com', 'staff', [propA.property_id]);
});
test.after(async () => { await srv.close(); });

test('a single reservation by room type takes the first free listing of that type', async () => {
  const body = { room_type: 'studio', property_id: propA.property_id, check_in: d(10), check_out: d(12), guest_name: 'Ana One' };
  const first = await owner.post('/api/reservations', body);
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.equal(first.data.reservation.unit_name, 'Unit 101');
  assert.equal(first.data.reservation.accommodation_total, '5000.00');
  anaBookingId = first.data.reservation.booking_id;
  assert.equal((await owner.post('/api/reservations', { ...body, guest_name: 'Ben Two' })).data.reservation.unit_name, 'Unit 102');
  assert.equal((await owner.post('/api/reservations', { ...body, guest_name: 'Cy Three' })).data.reservation.unit_name, 'Unit 201');
  const none = await owner.post('/api/reservations', { ...body, guest_name: 'Dee Four' });
  assert.equal(none.status, 409);
  assert.equal(none.data.code, 'NO_FREE_ROOM');
  // The Deluxe type is its own pool.
  const deluxe = await owner.post('/api/reservations', { room_type: 'Deluxe', property_id: propA.property_id, check_in: d(10), check_out: d(12), guest_name: 'Eve Five' });
  assert.equal(deluxe.data.reservation.unit_name, 'Unit 301');
});

test('a stay names a listing or a room type, not both and not neither', async () => {
  const both = await owner.post('/api/reservations', { unit_id: u['Unit 101'].unit_id, room_type: 'Studio', property_id: propA.property_id, check_in: d(10), check_out: d(11), guest_name: 'X' });
  assert.equal(both.status, 400);
  const neither = await owner.post('/api/reservations', { check_in: d(10), check_out: d(11), guest_name: 'X' });
  assert.equal(neither.status, 400);
  assert.ok(neither.data.fields.room_type);
  assert.ok(neither.data.fields.property_id);
});

test('a group books its rooms together: a named listing and a room type, with totals', async () => {
  const r = await owner.post('/api/booking-groups', {
    name: 'Lakeside wedding', notes: 'Bride party',
    guest: { full_name: 'Maria Lopez', phone: '09171234567', email: 'maria@example.com' },
    rooms: [
      { unit_id: u['Unit 101'].unit_id, check_in: d(30), check_out: d(33), num_guests: 2 },
      { room_type: 'Studio', property_id: propA.property_id, check_in: d(30), check_out: d(33), num_guests: 2, accommodation_total: '6000' },
    ],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  group = r.data.group;
  assert.match(group.group_id, /^[0-9a-f-]{36}$/);
  assert.equal(group.status, 'active');
  assert.equal(group.rooms, 2);
  assert.equal(group.check_in, d(30));
  assert.equal(group.check_out, d(33));
  assert.equal(group.total, '14500.00');

  const detail = await owner.get(`/api/booking-groups/${group.group_id}`);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.data.rooms.map((x) => x.unit_name), ['Unit 101', 'Unit 102'], 'the room type skipped Unit 101, which is named in the group');
  assert.equal(detail.data.group.name, 'Lakeside wedding');
  assert.equal(detail.data.guest.full_name, 'Maria Lopez');
  assert.equal(detail.data.totals.rooms, 2);
  assert.equal(detail.data.totals.total, '14500.00');
  assert.equal(detail.data.totals.balance, '14500.00');
  assert.equal(detail.data.totals.amount_paid, '0.00');
  assert.equal(detail.data.rooms[0].balance, '8000.00');
  assert.equal(await count(`SELECT COUNT(*)::int AS n FROM guests WHERE email = 'maria@example.com'`), 1);

  const reservation = await owner.get(`/api/reservations/${detail.data.rooms[0].booking_id}`);
  assert.deepEqual(reservation.data.reservation.group, { group_id: group.group_id, name: 'Lakeside wedding' });
  const solo = await owner.get(`/api/reservations/${anaBookingId}`);
  assert.equal(solo.data.reservation.group, null);
});

test('a group with one taken room books nothing and names the taken room', async () => {
  assert.equal((await owner.post('/api/reservations', { unit_id: u['Unit 301'].unit_id, check_in: d(40), check_out: d(42), guest_name: 'Early Bird' })).status, 201);
  const groupsBefore = await count('SELECT COUNT(*)::int AS n FROM booking_groups');
  const r = await owner.post('/api/booking-groups', {
    name: 'Ghost party', guest: { full_name: 'Ghost Guest' },
    rooms: [
      { unit_id: u['Unit 101'].unit_id, check_in: d(40), check_out: d(42) },
      { unit_id: u['Unit 301'].unit_id, check_in: d(40), check_out: d(42) },
    ],
  });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'ROOMS_TAKEN');
  assert.deepEqual(r.data.rooms, [{ unit_name: 'Unit 301', check_in: d(40), check_out: d(42) }]);
  assert.equal(await count('SELECT COUNT(*)::int AS n FROM booking_groups'), groupsBefore);
  assert.equal(await count(`SELECT COUNT(*)::int AS n FROM guests WHERE full_name = 'Ghost Guest'`), 0);
  assert.equal(await count('SELECT COUNT(*)::int AS n FROM bookings WHERE unit_id = $1 AND check_in = $2', [u['Unit 101'].unit_id, d(40)]), 0);
});

test('a room type with no free listing fails the whole group', async () => {
  // Unit 301 is the only Deluxe at Azure and it is booked for these nights.
  const r = await owner.post('/api/booking-groups', {
    name: 'Deluxe dinner', guest: { full_name: 'Rolled Back' },
    rooms: [
      { unit_id: u['Unit 102'].unit_id, check_in: d(40), check_out: d(42) },
      { room_type: 'Deluxe', property_id: propA.property_id, check_in: d(40), check_out: d(42) },
    ],
  });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'NO_FREE_ROOM');
  assert.equal(await count('SELECT COUNT(*)::int AS n FROM bookings WHERE unit_id = $1 AND check_in = $2', [u['Unit 102'].unit_id, d(40)]), 0);
  assert.equal(await count(`SELECT COUNT(*)::int AS n FROM guests WHERE full_name = 'Rolled Back'`), 0);
});

test('group validation: 2 to 20 rooms, field errors name the room, one listing cannot be booked twice in a group', async () => {
  const one = await owner.post('/api/booking-groups', { name: 'Solo', guest: { full_name: 'X' }, rooms: [{ unit_id: u['Unit 101'].unit_id, check_in: d(50), check_out: d(51) }] });
  assert.equal(one.status, 400);
  assert.ok(one.data.fields.rooms);
  const many = Array.from({ length: 21 }, (_, i) => ({ unit_id: u['Unit 101'].unit_id, check_in: d(100 + i), check_out: d(101 + i) }));
  assert.equal((await owner.post('/api/booking-groups', { name: 'Big', guest: { full_name: 'X' }, rooms: many })).status, 400);
  const badDates = await owner.post('/api/booking-groups', { name: 'Bad dates', guest: { full_name: 'X' }, rooms: [
    { unit_id: u['Unit 101'].unit_id, check_in: d(50), check_out: d(51) },
    { unit_id: u['Unit 102'].unit_id, check_in: d(52), check_out: d(52) },
  ] });
  assert.equal(badDates.status, 400);
  assert.ok(badDates.data.fields['rooms.1.check_out']);
  const twice = await owner.post('/api/booking-groups', { name: 'Twice', guest: { full_name: 'X' }, rooms: [
    { unit_id: u['Unit 101'].unit_id, check_in: d(50), check_out: d(52) },
    { unit_id: u['Unit 101'].unit_id, check_in: d(51), check_out: d(53) },
  ] });
  assert.equal(twice.status, 400);
  assert.equal(await count(`SELECT COUNT(*)::int AS n FROM booking_groups WHERE name IN ('Solo', 'Big', 'Bad dates', 'Twice')`), 0);
});

test('staff see the group and its rooms without money, and cannot create one', async () => {
  const list = await staff.get('/api/booking-groups?status=active');
  assert.equal(list.status, 200);
  const row = list.data.groups.find((x) => x.group_id === group.group_id);
  assert.ok(row);
  assert.equal(row.total, undefined);
  assert.equal(row.balance, undefined);
  assert.equal(row.rooms, 2);
  const detail = await staff.get(`/api/booking-groups/${group.group_id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.totals.total, undefined);
  assert.equal(detail.data.totals.balance, undefined);
  assert.equal(detail.data.totals.rooms, 2);
  assert.equal(detail.data.rooms[0].total_amount, undefined);
  assert.equal(detail.data.guest.email, undefined);
  assert.equal(detail.data.guest.limited, true);
  const create = await staff.post('/api/booking-groups', { name: 'Staff', guest: { full_name: 'Y' }, rooms: [
    { unit_id: u['Unit 201'].unit_id, check_in: d(60), check_out: d(61) },
    { room_type: 'Studio', property_id: propA.property_id, check_in: d(60), check_out: d(61) },
  ] });
  assert.equal(create.status, 403);
});

test('adding a room: a named listing, a room type, and the taken cases', async () => {
  const added = await owner.post(`/api/booking-groups/${group.group_id}/rooms`, { room_type: 'Studio', property_id: propA.property_id, check_in: d(30), check_out: d(33), num_guests: 2 });
  assert.equal(added.status, 201, JSON.stringify(added.data));
  assert.equal(added.data.group.rooms, 3);
  const detail = await owner.get(`/api/booking-groups/${group.group_id}`);
  assert.ok(detail.data.rooms.some((x) => x.unit_name === 'Unit 201' && x.booking_id === added.data.booking_id));
  assert.equal(detail.data.totals.total, '22500.00');
  const clash = await owner.post(`/api/booking-groups/${group.group_id}/rooms`, { unit_id: u['Unit 101'].unit_id, check_in: d(30), check_out: d(33) });
  assert.equal(clash.status, 409);
  assert.equal(clash.data.code, 'ROOMS_TAKEN');
  assert.deepEqual(clash.data.rooms, [{ unit_name: 'Unit 101', check_in: d(30), check_out: d(33) }]);
  const none = await owner.post(`/api/booking-groups/${group.group_id}/rooms`, { room_type: 'Studio', property_id: propA.property_id, check_in: d(30), check_out: d(33) });
  assert.equal(none.status, 409);
  assert.equal(none.data.code, 'NO_FREE_ROOM');
});

test('removing a room cancels only that booking, through the normal cancel path', async () => {
  const detail = await owner.get(`/api/booking-groups/${group.group_id}`);
  const roomId = detail.data.rooms.find((x) => x.unit_name === 'Unit 201').booking_id;
  assert.equal((await owner.post(`/api/booking-groups/${group.group_id}/rooms/${roomId}/remove`, {})).status, 400, 'a reason is required, as for any cancel');
  const other = (await owner.post('/api/reservations', { unit_id: u['Unit 301'].unit_id, check_in: d(60), check_out: d(61), guest_name: 'Other' })).data.reservation.booking_id;
  assert.equal((await owner.post(`/api/booking-groups/${group.group_id}/rooms/${other}/remove`, { reason: 'x' })).status, 404, 'a room from another booking is not in this group');
  const ok = await owner.post(`/api/booking-groups/${group.group_id}/rooms/${roomId}/remove`, { reason: 'Guest dropped a room' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const after = await owner.get(`/api/booking-groups/${group.group_id}`);
  assert.equal(after.data.rooms.find((x) => x.booking_id === roomId).status, 'cancelled');
  assert.equal(after.data.totals.total, '14500.00');
  assert.equal((await owner.post(`/api/booking-groups/${group.group_id}/rooms/${roomId}/remove`, { reason: 'again' })).status, 409);
});

test('every group action writes one audit row per booking, with booking_id and group_id', async () => {
  const rows = await sql(`SELECT action, record_id, details FROM audit_logs WHERE details->>'group_id' = $1`, [group.group_id]);
  assert.equal(rows.filter((r) => r.action === 'booking_group.created').length, 2);
  assert.equal(rows.filter((r) => r.action === 'booking_group.room_added').length, 1);
  assert.equal(rows.filter((r) => r.action === 'booking_group.room_removed').length, 1);
  for (const r of rows) assert.equal(r.details.booking_id, r.record_id);
});

test('renaming a group: name required, every room gets an audit row', async () => {
  assert.equal((await owner.patch(`/api/booking-groups/${group.group_id}`, { name: '   ' })).status, 400);
  const ok = await owner.patch(`/api/booking-groups/${group.group_id}`, { name: 'Lakeside wedding (moved)', notes: null });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.group.name, 'Lakeside wedding (moved)');
  assert.equal((await owner.get(`/api/booking-groups/${group.group_id}`)).data.group.name, 'Lakeside wedding (moved)');
  assert.equal(await count(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'booking_group.updated' AND details->>'group_id' = $1`, [group.group_id]), 3, 'three rooms, including the removed one');
});

test('a manager sees and books only rooms in their properties', async () => {
  const mixed = await owner.post('/api/booking-groups', { name: 'Two cities', guest: { full_name: 'Traveler' }, rooms: [
    { unit_id: u['Unit 101'].unit_id, check_in: d(80), check_out: d(82) },
    { unit_id: u['Unit 401'].unit_id, check_in: d(80), check_out: d(82) },
  ] });
  assert.equal(mixed.status, 201, JSON.stringify(mixed.data));
  const list = await mgr.get('/api/booking-groups');
  assert.equal(list.status, 200);
  assert.ok(!list.data.groups.some((x) => x.name === 'Two cities'), 'a group with a room outside the manager scope is hidden');
  assert.equal((await mgr.get(`/api/booking-groups/${mixed.data.group.group_id}`)).status, 404);
  const outside = await mgr.post('/api/booking-groups', { name: 'Not mine', guest: { full_name: 'X' }, rooms: [
    { unit_id: u['Unit 101'].unit_id, check_in: d(85), check_out: d(86) },
    { unit_id: u['Unit 401'].unit_id, check_in: d(85), check_out: d(86) },
  ] });
  assert.equal(outside.status, 404);
  const mine = await mgr.post('/api/booking-groups', { name: 'Mine', guest: { full_name: 'Local Guest' }, rooms: [
    { room_type: 'Studio', property_id: propB.property_id, check_in: d(85), check_out: d(86) },
    { room_type: 'Studio', property_id: propB.property_id, check_in: d(85), check_out: d(86) },
  ] });
  assert.equal(mine.status, 201, JSON.stringify(mine.data));
  const seen = await mgr.get(`/api/booking-groups/${mine.data.group.group_id}`);
  assert.deepEqual(seen.data.rooms.map((x) => x.unit_name), ['Unit 401', 'Unit 402']);
});

test('two group bookings for the same nights at once: one books, the other is told which rooms are taken', async () => {
  const body = (name) => ({ name, guest: { full_name: name }, rooms: [
    { unit_id: u['Unit 102'].unit_id, check_in: d(120), check_out: d(122) },
    { unit_id: u['Unit 201'].unit_id, check_in: d(120), check_out: d(122) },
  ] });
  const [a, b] = await Promise.all([owner.post('/api/booking-groups', body('Race A')), owner.post('/api/booking-groups', body('Race B'))]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const loser = a.status === 409 ? a : b;
  assert.equal(loser.data.code, 'ROOMS_TAKEN');
  assert.deepEqual(loser.data.rooms.map((x) => x.unit_name).sort(), ['Unit 102', 'Unit 201']);
  assert.equal(await count(`SELECT COUNT(*)::int AS n FROM bookings WHERE unit_id = $1 AND status = 'confirmed' AND check_in = $2`, [u['Unit 102'].unit_id, d(120)]), 1);
  assert.equal(await count(`SELECT COUNT(*)::int AS n FROM booking_groups WHERE name LIKE 'Race %'`), 1);
});

test('cancelling a group cancels every room, frees the nights, and is listed as cancelled', async () => {
  const r = await owner.post(`/api/booking-groups/${group.group_id}/cancel`, { reason: 'Event moved' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const detail = await owner.get(`/api/booking-groups/${group.group_id}`);
  assert.equal(detail.data.group.status, 'cancelled');
  assert.ok(detail.data.group.cancelled_at);
  assert.ok(detail.data.rooms.every((x) => x.status === 'cancelled'));
  assert.equal(detail.data.totals.balance, '0.00');
  assert.equal((await owner.post(`/api/booking-groups/${group.group_id}/cancel`, {})).status, 409);
  const free = await owner.post('/api/reservations', { unit_id: u['Unit 101'].unit_id, check_in: d(30), check_out: d(33), guest_name: 'Next Guest', accommodation_total: '7500' });
  assert.equal(free.status, 201, 'the cancelled group freed Unit 101');
  const cancelled = await owner.get('/api/booking-groups?status=cancelled');
  assert.ok(cancelled.data.groups.some((x) => x.group_id === group.group_id));
  const active = await owner.get('/api/booking-groups?status=active');
  assert.ok(!active.data.groups.some((x) => x.group_id === group.group_id));
  assert.ok((await owner.get('/api/booking-groups')).data.groups.some((x) => x.group_id === group.group_id));
  assert.equal(await count(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'booking_group.cancelled' AND details->>'group_id' = $1`, [group.group_id]), 2, 'the two rooms still booked');
});

test('listings carry the room type; an unknown group is not found', async () => {
  const listings = await owner.get('/api/listings');
  assert.equal(listings.data.listings.find((l) => l.unit_name === 'Unit 301').room_type, 'Deluxe');
  assert.equal((await owner.get('/api/booking-groups/00000000-0000-4000-8000-000000000000')).status, 404);
});

test('removing the last booked room cancels the group, and a cancelled group takes no new rooms', async () => {
  const r = await owner.post('/api/booking-groups', { name: 'Shrinking party', guest: { full_name: 'Shrink Guest' }, rooms: [
    { unit_id: u['Unit 101'].unit_id, check_in: d(150), check_out: d(152) },
    { unit_id: u['Unit 102'].unit_id, check_in: d(150), check_out: d(152) },
  ] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.group.group_id;
  const [first, second] = (await owner.get(`/api/booking-groups/${id}`)).data.rooms;

  assert.equal((await owner.post(`/api/booking-groups/${id}/rooms/${first.booking_id}/remove`, { reason: 'Dropped one' })).status, 200);
  const partly = await owner.get(`/api/booking-groups/${id}`);
  assert.equal(partly.data.group.status, 'active', 'one room is still booked');
  assert.equal(partly.data.group.cancelled_at, null);

  assert.equal((await owner.post(`/api/booking-groups/${id}/rooms/${second.booking_id}/remove`, { reason: 'Dropped the last' })).status, 200);
  const gone = await owner.get(`/api/booking-groups/${id}`);
  assert.equal(gone.data.group.status, 'cancelled');
  assert.ok(gone.data.group.cancelled_at);
  assert.equal(gone.data.totals.balance, '0.00');

  const add = await owner.post(`/api/booking-groups/${id}/rooms`, { room_type: 'Studio', property_id: propA.property_id, check_in: d(150), check_out: d(152) });
  assert.equal(add.status, 409);
  assert.equal(add.data.code, 'CANCELLED');
  assert.ok((await owner.get('/api/booking-groups?status=cancelled')).data.groups.some((x) => x.group_id === id));
});

test('removing the last two rooms at the same moment still cancels the group', async () => {
  const r = await owner.post('/api/booking-groups', { name: 'Both out', guest: { full_name: 'Both Out' }, rooms: [
    { unit_id: u['Unit 101'].unit_id, check_in: d(155), check_out: d(157) },
    { unit_id: u['Unit 102'].unit_id, check_in: d(155), check_out: d(157) },
  ] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.group.group_id;
  const rooms = (await owner.get(`/api/booking-groups/${id}`)).data.rooms;
  const removed = await Promise.all(rooms.map((x) => owner.post(`/api/booking-groups/${id}/rooms/${x.booking_id}/remove`, { reason: 'Both dropped' })));
  assert.deepEqual(removed.map((x) => x.status), [200, 200]);
  assert.equal((await owner.get(`/api/booking-groups/${id}`)).data.group.status, 'cancelled');
});

test('a room added at the same moment as a cancel is either refused or cancelled with the group', async () => {
  const r = await owner.post('/api/booking-groups', { name: 'Cancel race', guest: { full_name: 'Race Guest' }, rooms: [
    { unit_id: u['Unit 201'].unit_id, check_in: d(160), check_out: d(162) },
    { unit_id: u['Unit 301'].unit_id, check_in: d(160), check_out: d(162) },
  ] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.group.group_id;
  const [cancel, add] = await Promise.all([
    owner.post(`/api/booking-groups/${id}/cancel`, { reason: 'Event moved' }),
    owner.post(`/api/booking-groups/${id}/rooms`, { unit_id: u['Unit 102'].unit_id, check_in: d(160), check_out: d(162) }),
  ]);
  assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
  assert.ok([201, 409].includes(add.status), JSON.stringify(add.data));
  if (add.status === 409) assert.equal(add.data.code, 'CANCELLED');
  // Whichever ran first, a cancelled group is left with no confirmed room.
  const detail = await owner.get(`/api/booking-groups/${id}`);
  assert.equal(detail.data.group.status, 'cancelled');
  assert.equal(detail.data.rooms.filter((x) => x.status === 'confirmed').length, 0);
});

// Waits until n requests are queued behind a row lock, so they have already passed their first checks.
async function waitForLockWaiters(n) {
  for (let i = 0; i < 400; i++) {
    const [{ waiting }] = await sql(`SELECT COUNT(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`);
    if (waiting >= n) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`only some of the ${n} requests reached the lock`);
}

test('two taps on remove for the same room: one removes it, the other is refused and writes no second audit row', async () => {
  const r = await owner.post('/api/booking-groups', { name: 'Double tap', guest: { full_name: 'Double Tap' }, rooms: [
    { unit_id: u['Unit 101'].unit_id, check_in: d(170), check_out: d(172) },
    { unit_id: u['Unit 102'].unit_id, check_in: d(170), check_out: d(172) },
  ] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.group.group_id;
  const [room] = (await owner.get(`/api/booking-groups/${id}`)).data.rooms;
  const remove = (reason) => owner.post(`/api/booking-groups/${id}/rooms/${room.booking_id}/remove`, { reason });

  // Hold the group lock so both taps pass their checks and queue behind it, then let them run one after the other.
  const holder = await pool.connect();
  let taps;
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT 1 FROM booking_groups WHERE group_id = $1 FOR UPDATE', [id]);
    taps = Promise.all([remove('First tap'), remove('Second tap')]);
    await waitForLockWaiters(2);
    await holder.query('COMMIT');
  } catch (err) {
    await holder.query('ROLLBACK');
    throw err;
  } finally {
    holder.release();
  }
  const results = await taps;
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
  assert.equal(results.find((x) => x.status === 409).data.code, 'CANCELLED');

  const [booking] = await sql('SELECT status, cancel_reason FROM bookings WHERE booking_id = $1', [room.booking_id]);
  assert.equal(booking.status, 'cancelled');
  const audits = await sql(`SELECT details FROM audit_logs WHERE action = 'booking_group.room_removed' AND record_id = $1`, [room.booking_id]);
  assert.equal(audits.length, 1, 'one removal, one audit row');
  assert.equal(audits[0].details.reason, booking.cancel_reason, 'the reason on record is the tap that removed it');
});
