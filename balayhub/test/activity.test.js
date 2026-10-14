'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const activity = require('../src/lib/activity');

const d = (n) => ical.addDays(manilaToday(), n);
const PROPERTY = { property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' };

let srv; let owner; let manager; let staff; let res; let outside;

async function invite(email, role, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', {
    full_name: email, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

const activityOf = (bookingId, c = owner) => c.get(`/api/reservations/${bookingId}/activity`);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'activity@example.com', 'Activity Stays');
  const azure = (await owner.post('/api/properties', { property_name: 'Azure', ...PROPERTY })).data.property;
  const azureUnit = (await owner.post(`/api/properties/${azure.property_id}/units`, {
    unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500',
  })).data.unit;
  const bayside = (await owner.post('/api/properties', {
    property_name: 'Bayside', ...PROPERTY, address: 'Roxas Blvd', city: 'Pasay',
  })).data.property;
  const baysideUnit = (await owner.post(`/api/properties/${bayside.property_id}/units`, {
    unit_name: 'B1', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500',
  })).data.unit;
  manager = await invite('activity-manager@example.com', 'manager', [azure.property_id]);
  staff = await invite('activity-staff@example.com', 'staff', [azure.property_id]);
  res = (await owner.post('/api/reservations', {
    unit_id: azureUnit.unit_id, check_in: d(10), check_out: d(12),
    guest_name: 'Ana Cruz', guest_email: 'ana@example.com', guest_phone: '0917 123 4567',
  })).data.reservation;
  outside = (await owner.post('/api/reservations', {
    unit_id: baysideUnit.unit_id, check_in: d(10), check_out: d(12), guest_name: 'Ben Lim',
  })).data.reservation;
});
test.after(async () => { await srv.close(); });

test('create, payment, charge and refund each read as a plain sentence, newest first', async () => {
  const id = res.booking_id;
  assert.equal((await owner.post(`/api/reservations/${id}/charges`, { category: 'late_checkout', description: 'Late check-out', unit_price: '500' })).status, 201);
  assert.equal((await owner.post(`/api/reservations/${id}/payments`, { amount: '1000', payment_date: manilaToday(), payment_method: 'gcash' })).status, 201);
  assert.equal((await owner.post(`/api/reservations/${id}/refunds`, {
    amount: '200', refund_date: manilaToday(), method: 'gcash', reason: 'Late check-out waived',
  })).status, 201);

  const r = await activityOf(id);
  assert.equal(r.status, 200);
  assert.equal(r.data.items.length, 4, JSON.stringify(r.data.items));
  const [refund, payment, charge, created] = r.data.items;

  assert.equal(refund.text, 'Recorded a refund of ₱200.00 by GCash');
  assert.equal(refund.kind, 'refund');
  assert.equal(refund.who, 'Maria Santos');
  assert.match(payment.text, /^Recorded a payment of ₱1,000\.00 \(receipt AR-\d{6}\)$/);
  assert.equal(payment.kind, 'payment');
  assert.equal(charge.text, 'Added a charge for late check-out: ₱500.00');
  assert.equal(charge.kind, 'charge');
  assert.match(created.text, /^Created reservation \S+ \(\d{1,2} \w{3} \d{4} to \d{1,2} \w{3} \d{4}\)$/);
  assert.equal(created.kind, 'booking');
  assert.match(created.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('a voided payment still reads, found through the payment record', async () => {
  const pay = await owner.post(`/api/reservations/${res.booking_id}/payments`, { amount: '300', payment_date: manilaToday(), payment_method: 'cash' });
  assert.equal(pay.status, 201);
  const voided = await owner.post(`/api/booking-payments/${pay.data.payment_id}/void`, { reason: 'Entered twice' });
  assert.equal(voided.status, 200, JSON.stringify(voided.data));
  const texts = (await activityOf(res.booking_id)).data.items.map((i) => i.text);
  assert.ok(texts.includes('Voided a payment of ₱300.00: Entered twice'), texts.join('\n'));
});

test('staff are refused with 403 before any data is read', async () => {
  assert.equal((await activityOf(res.booking_id, staff)).status, 403);
});

test('another workspace gets 404 for the same reservation', async () => {
  const other = await ownerAccount(srv.base, 'activity-other@example.com', 'Other Workspace');
  const r = await activityOf(res.booking_id, other);
  assert.equal(r.status, 404);
  assert.equal(r.data.items, undefined);
});

test('a manager sees their own property and gets 404 outside it', async () => {
  assert.equal((await activityOf(res.booking_id, manager)).status, 200);
  assert.equal((await activityOf(outside.booking_id, manager)).status, 404);
});

test('signed-out callers get 401, and a bad id gets 404', async () => {
  assert.equal((await activityOf(res.booking_id, client(srv.base))).status, 401);
  assert.equal((await activityOf('not-a-uuid')).status, 404);
});

test('no tokens, links, emails or phone numbers appear in the text', async () => {
  const link = (await owner.post(`/api/reservations/${res.booking_id}/checkin/new-link`, {})).data.link;
  const guide = (await owner.post(`/api/reservations/${res.booking_id}/guide-link`, {})).data.url;
  const r = await activityOf(res.booking_id);
  assert.equal(r.status, 200);
  const all = JSON.stringify(r.data.items);
  assert.match(all, /Replaced the guest check-in link/);
  assert.match(all, /Shared the guidebook link with the guest/);
  for (const url of [link, guide]) assert.ok(!all.includes(url.split('/').pop()), 'a link token leaked into the activity text');
  assert.doesNotMatch(all, /ana@example\.com/);
  assert.doesNotMatch(all, /9171234/);
});

test('money reads with commas and two decimals; quantity multiplies the unit price', () => {
  assert.deepEqual(activity.describe({
    action: 'reservation.charge_added', details: { category: 'early_checkin', quantity: 2, unit_price: '350.50' },
  }), { kind: 'charge', text: 'Added a charge for early check-in: ₱701.00 (2 × ₱350.50)' });
});

test('free text loses emails and phone numbers; gate-pass recipients are never read', () => {
  assert.equal(activity.describe({
    action: 'reservation.charge_voided', details: { amount: '500', reason: 'Call 0917 123 4567 or ana@example.com' },
  }).text, 'Voided a charge of ₱500.00: Call or');
  assert.equal(activity.describe({ action: 'gatepass.sent', details: { to: 'ana@example.com', ok: true } }).text, 'Sent the gate pass by email');
});

test('deposits, damage, cleaning, lost and found and online bookings read from their real detail fields', () => {
  const cases = [
    [{ action: 'deposit.settled', details: { status: 'partly_refunded', refund: '1500.00', deduction: '500.00' } },
      'payment', 'Settled the security deposit: returned ₱1,500.00, kept ₱500.00'],
    [{ action: 'damage.charged', details: { booking_id: 'b', charge_id: 'c', amount: '750' } }, 'charge', 'Charged ₱750.00 to the guest'],
    [{ action: 'cleaning.inspected', details: { score: 80, passed: true } }, 'cleaning', 'Inspected the cleaning: passed (score 80)'],
    [{ action: 'lost_found.updated', details: { from: 'held', to: 'returned' } }, 'other', 'Changed a lost-and-found item from held to returned'],
    [{ action: 'reservation.updated', details: { before: {}, after: { check_in: '2026-03-12', notes: 'x' } } }, 'booking', 'Changed the reservation: check in, notes'],
    [{ action: 'reservation.booked_online', details: { amount: '1000.00', pay_type: 'deposit' } }, 'booking', 'Booked online and paid ₱1,000.00 now'],
    [{ action: 'reservation.balance_paid_online', details: { amount: '500.00', booking_id: 'b' } }, 'payment', 'Paid ₱500.00 of the balance online'],
    [{ action: 'payment_proof.submitted', details: { booking_id: 'b', amount: '1000', method: 'gcash' } }, 'payment', 'Sent a payment proof of ₱1,000.00 by GCash'],
    [{ action: 'payment_proof.withdrawn', details: { booking_id: 'b' } }, 'payment', 'Withdrew a payment proof'],
    [{ action: 'gatepass.sent', details: { to: 'ana@example.com', ok: false } }, 'guest', 'Could not send the gate pass by email'],
  ];
  for (const [row, kind, text] of cases) {
    assert.deepEqual(activity.describe(row), { kind, text }, row.action);
  }
  assert.equal(activity.whoOf({ action: 'reservation.booked_online', actor_name: null }), 'Guest');
  assert.equal(activity.whoOf({ action: 'payment_proof.withdrawn', actor_name: null }), 'Guest', 'a guest withdrawing a proof is the Guest');
});

test('unknown actions read as a sentence; unsigned rows say who did them', () => {
  assert.deepEqual(activity.describe({ action: 'billing.paid_out', details: null }), { kind: 'other', text: 'Billing paid out' });
  assert.equal(activity.whoOf({ action: 'reservation.charge_added', actor_name: null }), 'Guest');
  assert.equal(activity.whoOf({ action: 'cleaning.task_done', actor_name: null }), 'BalayHub');
  assert.equal(activity.whoOf({ action: 'owner_portal.block_created', actor_name: null }), 'Owner');
});
