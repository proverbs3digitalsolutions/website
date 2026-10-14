'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

// QA r7 lane C02: reservation and receipt shapes for roles other than owner and manager are allow-lists
// (a new bookings column never reaches staff; booking sources stay hidden, matrix 6.2); a failed receipt email
// gives staff a fixed sentence, not the provider's text; a cancelled group reports the money still held.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const PASSWORD = 'longenough1';
const d = (n) => ical.addDays(manilaToday(), n);
// Today's staff reservation row, minus `source` (matrix 6.2), plus `limited`.
const STAFF_RESERVATION_KEYS = ['accommodation_total', 'amount_paid', 'balance', 'block_reason', 'booking_id', 'cancel_reason', 'cancelled_at', 'channel',
  'channel_fee', 'channel_fee_ignored', 'check_in', 'check_out', 'checked_in_at', 'checked_out_at', 'cleaning_fee', 'confirmation_code', 'created_at',
  'created_by', 'external_uid', 'extras_total', 'group_id', 'guest_has_email', 'guest_id', 'guest_label', 'guest_name', 'ical_feed_id', 'kind', 'limited', 'max_guests',
  'nights', 'num_guests', 'organization_id', 'other_fees', 'owner_block_by', 'property_id', 'property_name', 'status', 'total_amount', 'unit_id', 'unit_name',
  'updated_at'];
const STAFF_RECEIPT_KEYS = ['adjustments', 'amount', 'balance_after', 'booking_id', 'charges', 'check_in', 'check_out', 'confirmation_code', 'created_at',
  'extras_total', 'guest_id', 'guest_name', 'limited', 'organization_id', 'payment_date', 'payment_id', 'payment_method', 'property_name', 'receipt_number',
  'receipt_sent_at', 'recorded_by', 'recorded_by_name', 'reference_number', 'total_amount', 'unit_name', 'void_reason', 'voided_at', 'voided_by', 'workspace_name'];
const SENTENCE = 'The receipt could not be emailed. Ask an owner or manager to send it again.';
const keys = (o) => Object.keys(o).sort();

let srv; let owner; let manager; let staff; let prop; let unit; let booking; let paymentId;

async function accept(email, role, name) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: [prop.property_id] });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', {
    full_name: name, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'r7c02-owner@example.com', 'R7 C02');
  prop = (await owner.post('/api/properties', { property_name: 'R7 C02 House', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'C1', unit_type: 'studio', nightly_rate: '2000', max_guests: 4, room_type: 'studio' })).data.unit;
  manager = await accept('r7c02-mgr@example.com', 'manager', 'R7 Manager');
  staff = await accept('r7c02-staff@example.com', 'staff', 'R7 Staff');
  booking = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(0), check_out: d(2), guest_name: 'Rita Reyes', guest_email: 'rita@example.com', guest_phone: '09171234567' })).data.reservation;
  assert.ok(booking);
  await sql(`UPDATE bookings SET source = 'facebook' WHERE booking_id = $1`, [booking.booking_id]);
  const pay = await owner.post(`/api/reservations/${booking.booking_id}/payments`, { amount: '1000', payment_date: manilaToday(), payment_method: 'cash' });
  assert.equal(pay.status, 201, JSON.stringify(pay.data));
  paymentId = pay.data.payment_id;
});
test.after(async () => { await srv.close(); });

test('staff reservation list row and detail have exactly the allow-listed keys, with no source', async () => {
  const row = (await staff.get('/api/reservations?view=all')).data.reservations.find((r) => r.booking_id === booking.booking_id);
  assert.deepEqual(keys(row), STAFF_RESERVATION_KEYS);
  const det = (await staff.get(`/api/reservations/${booking.booking_id}`)).data.reservation;
  assert.deepEqual(keys(det).filter((k) => k !== 'group'), STAFF_RESERVATION_KEYS);
  assert.ok(!('source' in row) && !('source' in det));
});

test('staff overview rows have no source and only the allow-listed keys', async () => {
  const o = (await staff.get('/api/stays/overview?range=today')).data;
  const rows = [...o.arrivals, ...o.departures, ...o.staying];
  const row = rows.find((r) => r.booking_id === booking.booking_id);
  assert.ok(row);
  for (const r of rows) assert.deepEqual(keys(r), STAFF_RESERVATION_KEYS);
});

test('a new bookings column never reaches staff, but the owner sees it', async () => {
  await sql('ALTER TABLE bookings ADD COLUMN qa_secret text');
  try {
    await sql(`UPDATE bookings SET qa_secret = 'hidden' WHERE booking_id = $1`, [booking.booking_id]);
    const row = (await staff.get('/api/reservations?view=all')).data.reservations.find((r) => r.booking_id === booking.booking_id);
    assert.ok(!('qa_secret' in row));
    assert.ok(!('qa_secret' in (await staff.get(`/api/reservations/${booking.booking_id}`)).data.reservation));
    const o = (await staff.get('/api/stays/overview?range=today')).data;
    for (const r of [...o.arrivals, ...o.departures, ...o.staying]) assert.ok(!('qa_secret' in r));
    const ownerRow = (await owner.get('/api/reservations?view=all')).data.reservations.find((r) => r.booking_id === booking.booking_id);
    assert.equal(ownerRow.qa_secret, 'hidden');
  } finally {
    await sql('ALTER TABLE bookings DROP COLUMN qa_secret');
  }
});

test('owner and manager still get the booking source', async () => {
  for (const c of [owner, manager]) {
    const row = (await c.get('/api/reservations?view=all')).data.reservations.find((r) => r.booking_id === booking.booking_id);
    assert.equal(row.source, 'facebook');
    assert.equal((await c.get(`/api/reservations/${booking.booking_id}`)).data.reservation.source, 'facebook');
  }
});

test('staff payment response and receipt have only allow-listed keys', async () => {
  const pay = await staff.post(`/api/reservations/${booking.booking_id}/payments`, { amount: '10', payment_date: manilaToday(), payment_method: 'cash' });
  assert.equal(pay.status, 201, JSON.stringify(pay.data));
  assert.deepEqual(keys(pay.data.reservation), STAFF_RESERVATION_KEYS);
  const dup = await staff.post(`/api/reservations/${booking.booking_id}/payments`, { amount: '10', payment_date: manilaToday(), payment_method: 'cash' }, { 'Idempotency-Key': 'r7c02-dup-0001' });
  const dup2 = await staff.post(`/api/reservations/${booking.booking_id}/payments`, { amount: '10', payment_date: manilaToday(), payment_method: 'cash' }, { 'Idempotency-Key': 'r7c02-dup-0001' });
  assert.equal(dup2.data.duplicate, true);
  assert.deepEqual(keys(dup2.data.reservation), STAFF_RESERVATION_KEYS);
  assert.equal(dup.status, 201);
  const rc = (await staff.get(`/api/booking-payments/${paymentId}/receipt`)).data.receipt;
  assert.deepEqual(keys(rc), STAFF_RECEIPT_KEYS);
});

test('a failed receipt email gives staff the fixed sentence and the owner the raw text', async () => {
  const bad = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(10), check_out: d(12), guest_name: 'Fail Me', guest_email: 'x@fail-me.example.com' })).data.reservation;
  const body = { amount: '500', payment_date: manilaToday(), payment_method: 'cash', send_receipt: true };
  const s = await staff.post(`/api/reservations/${bad.booking_id}/payments`, body);
  assert.equal(s.status, 201, JSON.stringify(s.data));
  assert.equal(s.data.receipt.sent, false);
  assert.equal(s.data.receipt.error, SENTENCE);
  const o = await owner.post(`/api/reservations/${bad.booking_id}/payments`, body);
  assert.equal(o.data.receipt.sent, false);
  assert.ok(o.data.receipt.error && o.data.receipt.error !== SENTENCE, o.data.receipt.error);
});

test('a cancelled group reports the money held on its rooms; staff see no money', async () => {
  const mk = await owner.post('/api/booking-groups', { name: 'Held Group', guest: { full_name: 'Held Guest' }, rooms: [
    { unit_id: unit.unit_id, check_in: d(30), check_out: d(32) },
    { unit_id: (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'C2', unit_type: 'studio', nightly_rate: '2000', max_guests: 4, room_type: 'studio' })).data.unit.unit_id, check_in: d(30), check_out: d(32) },
  ] });
  assert.equal(mk.status, 201, JSON.stringify(mk.data));
  const gid = mk.data.group.group_id;
  const room = (await owner.get(`/api/booking-groups/${gid}`)).data.rooms[0];
  assert.equal((await owner.post(`/api/reservations/${room.booking_id}/payments`, { amount: '1000', payment_date: manilaToday(), payment_method: 'cash' })).status, 201);
  const live = (await owner.get(`/api/booking-groups/${gid}`)).data.totals;
  assert.equal(live.held, '0.00', 'a live group holds nothing back');
  assert.equal(live.amount_paid, '1000.00');
  assert.equal((await owner.post(`/api/booking-groups/${gid}/cancel`, { reason: 'Event moved' })).status, 200);
  const row = (await owner.get('/api/booking-groups?status=cancelled')).data.groups.find((g) => g.group_id === gid);
  assert.equal(row.held, '1000.00');
  assert.equal(row.total, '0.00');
  assert.equal(row.amount_paid, '0.00');
  assert.equal((await owner.get(`/api/booking-groups/${gid}`)).data.totals.held, '1000.00');
  const sRow = (await staff.get('/api/booking-groups?status=cancelled')).data.groups.find((g) => g.group_id === gid);
  assert.ok(sRow && !('held' in sRow) && !('total' in sRow));
  assert.ok(!('held' in (await staff.get(`/api/booking-groups/${gid}`)).data.totals));
});
