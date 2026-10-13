'use strict';

// Phase 1 integration: refund idempotency, the manual-only pay link and the
// cancellation policy variable in guest messages.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, sql, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const messaging = require('../src/lib/messaging');

const d = (n) => ical.addDays(manilaToday(), n);
let srv; let owner; let unit; let res;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'p1int@example.com', 'Integration Stays');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '701', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500' })).data.unit;
  res = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(20), check_out: d(22), guest_name: 'Ana Cruz', guest_email: 'ana@example.com' })).data.reservation;
  assert.ok(res, 'reservation created');
  await owner.post(`/api/reservations/${res.booking_id}/payments`, { amount: '3000', payment_date: manilaToday(), payment_method: 'gcash' });
});
test.after(async () => { await srv.close(); });

const refund = (key, amount = '500.00') => owner.post(`/api/reservations/${res.booking_id}/refunds`,
  { amount, refund_date: manilaToday(), method: 'gcash', reason: 'Cancelled by guest' }, key ? { 'Idempotency-Key': key } : undefined);
const refundCount = async () => Number((await sql('SELECT count(*) FROM booking_refunds WHERE booking_id = $1', [res.booking_id]))[0].count);

test('refund idempotency: the same key records once and replays the first refund', async () => {
  const first = await refund('refund-key-0001');
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const again = await refund('refund-key-0001');
  assert.equal(again.status, 200);
  assert.equal(again.data.duplicate, true);
  assert.equal(again.data.refund.refund_id, first.data.refund.refund_id);
  assert.equal(await refundCount(), 1);
  // A retry does not use up the refundable cap a second time.
  assert.equal((await owner.get(`/api/reservations/${res.booking_id}/refunds`)).data.refundable, '2500.00');
});

test('refund idempotency: a new key records a new refund, a bad key is refused, no key still works', async () => {
  assert.equal((await refund('refund-key-0002')).status, 201);
  assert.equal(await refundCount(), 2);
  const bad = await refund('short');
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error?.code ?? bad.data.code, 'BAD_REQUEST');
  assert.equal((await refund(null, '100.00')).status, 201);
  assert.equal(await refundCount(), 3);
});

test('refund idempotency: a key used on one reservation is refused on another and shows nothing of the first', async () => {
  const first = await refund('refund-key-0003');
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const other = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(30), check_out: d(32), guest_name: 'Ben Lim', guest_email: 'ben@example.com' })).data.reservation;
  assert.ok(other, 'second reservation created');
  assert.equal((await owner.post(`/api/reservations/${other.booking_id}/payments`, { amount: '1000', payment_date: manilaToday(), payment_method: 'gcash' })).status, 201);
  const reused = await owner.post(`/api/reservations/${other.booking_id}/refunds`,
    { amount: '100.00', refund_date: manilaToday(), method: 'gcash', reason: 'Other stay' }, { 'Idempotency-Key': 'refund-key-0003' });
  assert.equal(reused.status, 409, JSON.stringify(reused.data));
  assert.equal(reused.data.code, 'IDEMPOTENCY_KEY_USED');
  assert.equal(JSON.stringify(reused.data).includes(first.data.refund.refund_id), false, 'the first reservation\'s refund is not shown');
  assert.equal(Number((await sql('SELECT count(*) FROM booking_refunds WHERE booking_id = $1', [other.booking_id]))[0].count), 0);
  // The same key on the first reservation still replays its own refund.
  const again = await refund('refund-key-0003');
  assert.equal(again.data.duplicate, true);
  assert.equal(again.data.refund.refund_id, first.data.refund.refund_id);
});

test('migration 028: the idempotency index is unique and partial (null keys are free)', async () => {
  const [{ indexdef }] = await sql(`SELECT indexdef FROM pg_indexes WHERE indexname = 'booking_refunds_idem_uq'`);
  assert.match(indexdef, /UNIQUE/);
  assert.match(indexdef, /idempotency_key IS NOT NULL/);
});

const ctxFor = async () => {
  await sql('UPDATE bookings SET pay_token = NULL WHERE booking_id = $1', [res.booking_id]);
  return messaging.bookingContext(res.booking_id);
};

test('{{payment_link}} is empty with neither PayMongo nor manual payments', async () => {
  const ctx = await ctxFor();
  assert.equal(ctx.pay_token, null);
  assert.equal(messaging.variables(ctx).payment_link, '');
});

test('{{payment_link}} works with manual payments only, and goes away when they are turned off', async () => {
  const on = await owner.patch('/api/workspace/manual-payments', { enabled: true, instructions: 'GCash 0917 123 4567 (Maria Santos)' });
  assert.equal(on.status, 200, JSON.stringify(on.data));
  const ctx = await ctxFor();
  assert.ok(ctx.pay_token, 'a pay token is created');
  const link = messaging.variables(ctx).payment_link;
  assert.match(link, /GCash, Maya or bank transfer/);
  assert.ok(link.endsWith(`/#/pay/${ctx.pay_token}`), link);
  // Nothing to pay: no link.
  assert.equal(messaging.variables({ ...ctx, balance: '0.00' }).payment_link, '');
  await owner.patch('/api/workspace/manual-payments', { enabled: false, instructions: '' });
  assert.equal(messaging.variables(await messaging.bookingContext(res.booking_id)).payment_link, '');
});

test('{{cancellation_policy}} is registered, empty when unset, and follows the guest language', async () => {
  assert.ok(messaging.VARIABLE_NAMES.includes('cancellation_policy'));
  assert.equal(messaging.variables(await messaging.bookingContext(res.booking_id)).cancellation_policy, '');
  await sql(`UPDATE units SET cancellation_policy = 'moderate' WHERE unit_id = $1`, [unit.unit_id]);
  const en = messaging.variables(await messaging.bookingContext(res.booking_id)).cancellation_policy;
  assert.match(en, /Full refund if you cancel at least 5 days/);
  await sql(`UPDATE organizations SET guest_language = 'tl' WHERE organization_id = (SELECT organization_id FROM bookings WHERE booking_id = $1)`, [res.booking_id]);
  assert.match(messaging.variables(await messaging.bookingContext(res.booking_id)).cancellation_policy, /araw/);
  await sql(`UPDATE units SET cancellation_policy = 'custom', cancellation_policy_text = 'Bawal ang refund sa Holy Week.' WHERE unit_id = $1`, [unit.unit_id]);
  assert.equal(messaging.variables(await messaging.bookingContext(res.booking_id)).cancellation_policy, 'Bawal ang refund sa Holy Week.');
  assert.equal(messaging.render('Policy: {{cancellation_policy}}', messaging.variables(await messaging.bookingContext(res.booking_id))), 'Policy: Bawal ang refund sa Holy Week.');
});
