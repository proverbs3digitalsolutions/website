'use strict';

// QA r6 lane C22: house rules (BACKEND-SCHEMA 6.2: staff No, cleaner No) and a payment's internal
// idempotency key never reach a staff response. Owners and managers keep the rules; no role sees the key.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const PASSWORD = 'longenough1';
const d = (n) => ical.addDays(manilaToday(), n);
const RULES = 'No smoking. Quiet hours after 10 pm.';
const CONTACT = ['guest_email', 'guest_phone', 'guest_vip', 'guest_do_not_rebook', 'previous_stays', 'review'];

let srv; let owner; let manager; let staff; let prop; let booking; let paymentId;

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
  owner = await ownerAccount(srv.base, 'r6c22-owner@example.com', 'R6 C22');
  prop = (await owner.post('/api/properties', { property_name: 'R6 C22 House', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'B1', unit_type: 'studio', nightly_rate: '2000', max_guests: 4, room_type: 'studio' })).data.unit;
  manager = await accept('r6c22-mgr@example.com', 'manager', 'R6 Manager');
  staff = await accept('r6c22-staff@example.com', 'staff', 'R6 Staff');
  booking = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(0), check_out: d(2), guest_name: 'Rita Rules' })).data.reservation;
  assert.ok(booking);
  await sql('UPDATE bookings SET rules_accepted_at = now(), rules_text = $2 WHERE booking_id = $1', [booking.booking_id, RULES]);
  const pay = await owner.post(`/api/reservations/${booking.booking_id}/payments`, { amount: '1000', payment_date: manilaToday(), payment_method: 'cash' }, { 'Idempotency-Key': 'r6c22-pay-0001' });
  assert.equal(pay.status, 201, JSON.stringify(pay.data));
  paymentId = pay.data.payment_id;
});
test.after(async () => { await srv.close(); });

test('staff reservation list has no house rules', async () => {
  const rows = (await staff.get('/api/reservations?view=all')).data.reservations;
  const row = rows.find((r) => r.booking_id === booking.booking_id);
  assert.ok(row);
  assert.ok(!('rules_text' in row));
  assert.ok(!('rules_accepted_at' in row));
});

test('staff reservation detail has no house rules and no payment idempotency key', async () => {
  const r = (await staff.get(`/api/reservations/${booking.booking_id}`)).data;
  assert.ok(!('rules_text' in r.reservation));
  assert.ok(!('rules_accepted_at' in r.reservation));
  const pay = r.payments.find((p) => p.payment_id === paymentId);
  assert.ok(pay);
  assert.ok(!('idempotency_key' in pay));
});

test('staff home overview has no house rules', async () => {
  const o = (await staff.get('/api/stays/overview?range=today')).data;
  const rows = [...o.arrivals, ...o.departures, ...o.staying];
  assert.ok(rows.some((r) => r.booking_id === booking.booking_id));
  for (const r of rows) {
    assert.ok(!('rules_text' in r));
    assert.ok(!('rules_accepted_at' in r));
  }
});

test('staff reservation export and receipt carry no house rules or idempotency key', async () => {
  const csv = (await staff.get('/api/reservations/export?view=all')).data;
  assert.ok(!csv.includes(RULES));
  const receipt = (await staff.get(`/api/booking-payments/${paymentId}/receipt`)).data.receipt;
  assert.ok(!('idempotency_key' in receipt));
  assert.ok(!('rules_text' in receipt));
});

test('staff recording a payment gets the reservation without house rules or guest contact details', async () => {
  const p = await staff.post(`/api/reservations/${booking.booking_id}/payments`, { amount: '100', payment_date: manilaToday(), payment_method: 'cash' });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  for (const k of ['rules_text', 'rules_accepted_at', ...CONTACT]) assert.ok(!(k in p.data.reservation), k);
});

test('owner and manager keep the house rules, and no role gets the payment idempotency key', async () => {
  for (const c of [owner, manager]) {
    const detail = (await c.get(`/api/reservations/${booking.booking_id}`)).data;
    assert.equal(detail.reservation.rules_text, RULES);
    assert.ok(detail.reservation.rules_accepted_at);
    for (const p of detail.payments) assert.ok(!('idempotency_key' in p));

    const list = (await c.get('/api/reservations?view=all')).data.reservations;
    assert.equal(list.find((r) => r.booking_id === booking.booking_id).rules_text, RULES);

    const o = (await c.get('/api/stays/overview?range=today')).data;
    assert.equal(o.arrivals.find((r) => r.booking_id === booking.booking_id).rules_text, RULES);

    const receipt = (await c.get(`/api/booking-payments/${paymentId}/receipt`)).data.receipt;
    assert.ok(!('idempotency_key' in receipt));
  }
});

test('manager PATCH response keeps the house rules', async () => {
  const r = await manager.patch(`/api/reservations/${booking.booking_id}`, { notes: 'Late arrival' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.reservation.rules_text, RULES);
});
