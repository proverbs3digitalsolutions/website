'use strict';

// QA r17 lane SB (server): three contracts from STRATEGY.md round 17.
// 1. A room that fails its listing's guest limit answers 400 with room_index (its 0-based place in `rooms`), and saves nothing.
// 2. A group whose lead guest has a flagged email answers guest_do_not_rebook and guest_name (owner and manager only).
// 3. Audit reasons take up to 500 characters; 501 is refused with the standard sentence.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);
let srv; let owner; let prop; let unitA; let unitB;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'r17sb-owner@example.com', 'R17 SB');
  prop = (await owner.post('/api/properties', { property_name: 'R17 Harbor', property_type: 'condominium', address: 'Roxas Blvd', city: 'Pasay', province: 'Metro Manila' })).data.property;
  const makeUnit = (name) => owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: name, unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, description: 'Sea view.', bookable_online: true,
  });
  unitA = (await makeUnit('Paris 1208')).data.unit;
  unitB = (await makeUnit('Paris 1209')).data.unit;
});
test.after(async () => { await srv.close(); });

const room = (unit, from, to, guests = 2) => ({ unit_id: unit.unit_id, check_in: d(from), check_out: d(to), num_guests: guests, accommodation_total: '5000.00' });
const reasonTooLong = (r) => {
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.deepEqual(r.data.fields, { reason: 'Reason must be at most 500 characters.' });
};

test('a room over its listing guest limit answers 400 with room_index and saves no group', async () => {
  const before = (await sql('SELECT COUNT(*)::int AS n FROM booking_groups WHERE name = $1', ['R17 limit group']))[0].n;
  const r = await owner.post('/api/booking-groups', {
    name: 'R17 limit group',
    guest: { full_name: 'Limit Guest' },
    rooms: [room(unitA, 100, 102), room(unitB, 100, 102, 99)],
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.error, 'Please check the highlighted fields.');
  assert.equal(r.data.room_index, 1);
  assert.deepEqual(r.data.fields, { num_guests: 'This listing allows up to 4 guests.' });
  const after = (await sql('SELECT COUNT(*)::int AS n FROM booking_groups WHERE name = $1', ['R17 limit group']))[0].n;
  assert.equal(after, before, 'nothing is saved');
});

test('a group whose lead guest has a flagged email answers guest_do_not_rebook and the guest name', async () => {
  const flagged = await owner.post('/api/guests', { full_name: 'Ana Cruz', email: 'a@x.test', do_not_rebook: true });
  assert.equal(flagged.status, 201, JSON.stringify(flagged.data));
  const r = await owner.post('/api/booking-groups', {
    name: 'R17 DNR group',
    guest: { full_name: 'B. Cruz', email: 'A@X.test ' },
    rooms: [room(unitA, 110, 112), room(unitB, 110, 112)],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.guest_do_not_rebook, true);
  assert.equal(r.data.guest_name, 'B. Cruz');
});

test('a group whose lead guest has another email answers guest_do_not_rebook false', async () => {
  const r = await owner.post('/api/booking-groups', {
    name: 'R17 clean group',
    guest: { full_name: 'Ana Cruz', email: 'ana.cruz@x.test' },
    rooms: [room(unitA, 120, 122), room(unitB, 120, 122)],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.guest_do_not_rebook, false);
  assert.equal(r.data.guest_name, 'Ana Cruz');
});

test('a reservation cancel reason of 501 characters is refused, and 500 is accepted', async () => {
  const b = await owner.post('/api/reservations', { unit_id: unitA.unit_id, check_in: d(200), check_out: d(201), guest_name: 'Reason Guest' });
  assert.equal(b.status, 201, JSON.stringify(b.data));
  const id = b.data.reservation.booking_id;
  reasonTooLong(await owner.post(`/api/reservations/${id}/cancel`, { reason: 'x'.repeat(501) }));
  const ok = await owner.post(`/api/reservations/${id}/cancel`, { reason: 'x'.repeat(500) });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
});

test('a group cancel reason of 501 characters is refused, and 500 is accepted', async () => {
  const g = await owner.post('/api/booking-groups', { name: 'R17 cancel group', guest: { full_name: 'Cancel Guest' }, rooms: [room(unitA, 300, 302), room(unitB, 300, 302)] });
  assert.equal(g.status, 201, JSON.stringify(g.data));
  const id = g.data.group.group_id;
  reasonTooLong(await owner.post(`/api/booking-groups/${id}/cancel`, { reason: 'x'.repeat(501) }));
  const ok = await owner.post(`/api/booking-groups/${id}/cancel`, { reason: 'x'.repeat(500) });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
});

test('a room removal reason of 501 characters is refused, and 500 is accepted', async () => {
  const g = await owner.post('/api/booking-groups', { name: 'R17 remove group', guest: { full_name: 'Remove Guest' }, rooms: [room(unitA, 400, 402), room(unitB, 400, 402)] });
  assert.equal(g.status, 201, JSON.stringify(g.data));
  const id = g.data.group.group_id;
  const detail = await owner.get(`/api/booking-groups/${id}`);
  const bookingId = detail.data.rooms[0].booking_id;
  reasonTooLong(await owner.post(`/api/booking-groups/${id}/rooms/${bookingId}/remove`, { reason: 'x'.repeat(501) }));
  const ok = await owner.post(`/api/booking-groups/${id}/rooms/${bookingId}/remove`, { reason: 'x'.repeat(500) });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
});
