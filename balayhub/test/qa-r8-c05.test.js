'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

// QA round 8, stays server (C05). N26/N27: guest and booking-group edits write a row only for fields that really
// changed. N32: the reservation timeline names the fields of a cleaning-task edit stored as { fields }. #1: the
// room-type quote names the listing a reservation would take (skips leased and busy ones).
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_04 node --test --test-concurrency=1 test/qa-r8-c05.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const activity = require('../src/lib/activity');

const d = (n) => ical.addDays(manilaToday(), n);
const PROPERTY = { property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' };
let srv; let owner; let prop; let units = {}; let guestId; let group;
const count = async (text, params) => Number((await sql(text, params))[0].n);

async function addUnit(name) {
  const r = await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, room_type: 'Studio' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  units[name] = r.data.unit;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'c05r8@example.com', 'C05 R8 Stays');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', ...PROPERTY })).data.property;
  await addUnit('Unit 101');
  await addUnit('Unit 102');
  const g = await owner.post('/api/guests', { full_name: 'Ana Cruz', phone: '0917 123 4567', email: 'ana@example.com' });
  assert.equal(g.status, 201, JSON.stringify(g.data));
  guestId = g.data.guest.guest_id;
});
test.after(async () => { await srv.close(); });

test('N26 guest PATCH: same values write no row; a phone change names only phone', async () => {
  const rows = () => count(`SELECT count(*) AS n FROM audit_logs WHERE action = 'guest.updated' AND record_id = $1`, [guestId]);
  const same = await owner.patch(`/api/guests/${guestId}`, { full_name: 'Ana Cruz', email: 'ana@example.com', phone: '0917 123 4567', vip: false });
  assert.equal(same.status, 200, JSON.stringify(same.data));
  assert.equal(await rows(), 0);
  const p = await owner.patch(`/api/guests/${guestId}`, { full_name: 'Ana Cruz', phone: '0918 000 1111' });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const [row] = await sql(`SELECT details FROM audit_logs WHERE action = 'guest.updated' AND record_id = $1`, [guestId]);
  assert.deepEqual(row.details.fields, ['phone']);
  assert.equal(await rows(), 1);
});

test('N27 booking group rename: same name writes no rows; a note change writes one per room', async () => {
  const r = await owner.post('/api/booking-groups', {
    name: 'Wedding', guest: { full_name: 'Maria Lopez', phone: '09171234567' },
    rooms: [
      { unit_id: units['Unit 101'].unit_id, check_in: d(30), check_out: d(32), num_guests: 2 },
      { unit_id: units['Unit 102'].unit_id, check_in: d(30), check_out: d(32), num_guests: 2 },
    ],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  group = r.data.group;
  const rows = () => count(`SELECT count(*) AS n FROM audit_logs WHERE action = 'booking_group.updated' AND details->>'group_id' = $1`, [group.group_id]);
  assert.equal((await owner.patch(`/api/booking-groups/${group.group_id}`, { name: 'Wedding' })).status, 200);
  assert.equal(await rows(), 0);
  assert.equal((await owner.patch(`/api/booking-groups/${group.group_id}`, { name: 'Wedding', notes: 'Bride party' })).status, 200);
  assert.equal(await rows(), 2);
  const [row] = await sql(`SELECT details FROM audit_logs WHERE action = 'booking_group.updated' AND details->>'group_id' = $1 LIMIT 1`, [group.group_id]);
  assert.deepEqual(row.details.fields, ['notes']);
});

test('N32 the timeline names the fields of a cleaning-task edit stored as { fields }', () => {
  const it = activity.item({ action: 'cleaning.task_updated', details: { fields: ['notes', 'due_date'] }, created_at: new Date(), actor_name: 'Maria' });
  assert.equal(it.text, 'Changed the cleaning task: notes, due date');
  // Old rows (before/after) still read.
  const old = activity.item({ action: 'cleaning.task_updated', details: { after: { notes: 'x' } }, created_at: new Date(), actor_name: 'Maria' });
  assert.equal(old.text, 'Changed the cleaning task: notes');
});

test('#1 room-type quote names the listing a reservation would take (skips a leased one)', async () => {
  const t = await owner.post('/api/tenants', { full_name: 'Juan Dela Cruz', phone: '0919 111 2222' });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  const l = await owner.post('/api/leases', {
    tenant_id: t.data.tenant.tenant_id, unit_id: units['Unit 101'].unit_id, start_date: d(-30), monthly_rent: '8000', due_day: 5,
  });
  assert.equal(l.status, 201, JSON.stringify(l.data));
  const q = `/api/reservations/quote?property_id=${prop.property_id}&room_type=studio&check_in=${d(5)}&check_out=${d(7)}`;
  const r = await owner.get(q);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.unit_id, units['Unit 102'].unit_id);
  assert.equal(r.data.unit_name, 'Unit 102');
  assert.ok(r.data.max_guests);
  // A booking on the other one: none free.
  const b = await owner.post('/api/reservations', { unit_id: units['Unit 102'].unit_id, check_in: d(5), check_out: d(7), guest_name: 'Z' });
  assert.equal(b.status, 201, JSON.stringify(b.data));
  const none = await owner.get(q);
  assert.equal(none.status, 409);
  assert.equal(none.data.code, 'NO_FREE_ROOM');
  assert.equal(none.data.error ?? none.data.message, 'No free studio at this property on these dates.');
  // The unit_id form is unchanged.
  const byUnit = await owner.get(`/api/reservations/quote?unit_id=${units['Unit 101'].unit_id}&check_in=${d(5)}&check_out=${d(7)}`);
  assert.equal(byUnit.status, 200);
  assert.equal(byUnit.data.unit_id, undefined);
});
