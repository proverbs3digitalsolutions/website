'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

// QA round 9, C01 (balance-server). #1 the guest balance counts refunds everywhere (one shared fragment in
// src/lib/balance.js); CSV Refunded column; #3 booking source; #11 automation names are unique; K1 a group rename
// writes one audit row that every room's timeline shows once; #22 server peso text keeps two decimals.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_01 node --test --test-concurrency=1 test/qa-r9-c01.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);
const PROPERTY = { property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' };
let srv; let owner; let unit; let unit2;
let n = 0;

async function directStay(unitId = unit.unit_id, extra = {}) {
  n += 2;
  const r = await owner.post('/api/reservations', { unit_id: unitId, check_in: d(40 + n), check_out: d(41 + n), guest_name: 'Ana Cruz', accommodation_total: '600', cleaning_fee: '0', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.reservation.booking_id;
}
const pay = (id, amount) => owner.post(`/api/reservations/${id}/payments`, { amount, payment_date: manilaToday(), payment_method: 'cash' });
const refund = (id, amount) => owner.post(`/api/reservations/${id}/refunds`, { amount, refund_date: manilaToday(), method: 'cash', reason: 'Test' });
const balance = async (id) => (await owner.get(`/api/reservations/${id}`)).data.reservation.balance;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'c01r9@example.com', 'C01 R9 Balance');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', ...PROPERTY })).data.property;
  const add = async (name) => (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '600', cleaning_fee: '0', max_guests: 4 })).data.unit;
  unit = await add('Unit 101');
  unit2 = await add('Unit 102');
});
test.after(async () => { await srv.close(); });

test('#1 a refund past the overpayment shows the money owed again, and voiding it takes it back', async () => {
  const id = await directStay();
  assert.equal((await pay(id, '1000')).status, 201);
  assert.equal(await balance(id), '-400.00');
  const full = await refund(id, '1000');
  assert.equal(full.status, 201, JSON.stringify(full.data));
  assert.equal(await balance(id), '600.00');
  assert.equal((await owner.post(`/api/refunds/${full.data.refund.refund_id}/void`, { reason: 'Mistake' })).status, 200);
  assert.equal(await balance(id), '-400.00');
  assert.equal((await refund(id, '400')).status, 201);
  assert.equal(await balance(id), '0.00');
});

test('#1 after the refund a 600 payment saves, the pay link asks for 600, the CSV has Refunded and Balance', async () => {
  const id = await directStay();
  await pay(id, '1000');
  await refund(id, '1000');
  await sql(`UPDATE organizations SET manual_payments_enabled = true WHERE name = 'C01 R9 Balance'`);
  const link = await owner.get(`/api/reservations/${id}/payment-link`);
  assert.equal(link.status, 200, JSON.stringify(link.data));
  assert.equal(Number(link.data.balance), 600);
  const guestPage = await fetch(`${srv.base}/api/public/pay/${link.data.link.split('/').pop()}`).then((r) => r.json());
  assert.equal(guestPage.balance_due, '600.00');
  const csv = (await owner.get('/api/reservations/export?view=all')).data;
  const lines = String(csv).split('\r\n');
  assert.match(lines[0], /Total,Paid,Refunded,Balance$/);
  const code = (await owner.get(`/api/reservations/${id}`)).data.reservation.confirmation_code;
  const row = lines.find((l) => l.includes(code)).split(',');
  assert.equal(row.at(-3), '1000.00');
  assert.equal(row.at(-2), '1000.00');
  assert.equal(row.at(-1), '600.00');
  assert.equal((await pay(id, '600')).status, 201);
  assert.equal(await balance(id), '0.00');
});

test('#1 a refund of 400 on a 400 overpayment leaves nothing owed; the unpaid list follows the balance', async () => {
  const id = await directStay();
  await pay(id, '1000');
  await refund(id, '400');
  assert.equal(await balance(id), '0.00');
  await refund(id, '600');
  assert.equal(await balance(id), '600.00');
  const unpaid = (await owner.get('/api/reservations?view=unpaid')).data.reservations;
  assert.ok(unpaid.some((r) => r.booking_id === id));
});

test('#1 the group summary and the receipt count refunds', async () => {
  const a = await directStay(unit.unit_id);
  const b = await directStay(unit2.unit_id);
  const g = await owner.post('/api/booking-groups', { name: 'Reunion', guest: { full_name: 'Ana Cruz' }, rooms: [
    { unit_id: unit.unit_id, check_in: d(300), check_out: d(301), accommodation_total: '600' },
    { unit_id: unit2.unit_id, check_in: d(300), check_out: d(301), accommodation_total: '600' }] });
  assert.equal(g.status, 201, JSON.stringify(g.data));
  const rooms = (await owner.get(`/api/booking-groups/${g.data.group.group_id}`)).data.rooms;
  await pay(rooms[0].booking_id, '1000');
  await refund(rooms[0].booking_id, '1000');
  const totals = (await owner.get(`/api/booking-groups/${g.data.group.group_id}`)).data.totals;
  assert.equal(totals.balance, '1200.00'); // both rooms still owe 600
  assert.ok(a && b);
  const payId = (await sql('SELECT payment_id FROM booking_payments WHERE booking_id = $1', [rooms[0].booking_id]))[0].payment_id;
  const rc = (await owner.get(`/api/booking-payments/${payId}/receipt`)).data.receipt;
  assert.equal(rc.balance_after, '600.00');
});

test('no other file writes the balance formula', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const hits = walk(path.join(__dirname, '..', 'src')).filter((f) => f.endsWith('.js') && fs.readFileSync(f, 'utf8').includes('channel_fee END - COALESCE'));
  assert.deepEqual(hits.map((f) => path.basename(f)).filter((f) => f !== 'balance.js'), []);
  assert.equal(typeof require('../src/routes/balancepay').BALANCE, 'string');
});

test('#3 source: a direct booking keeps it; unknown and non-direct are refused', async () => {
  const id = await directStay(unit.unit_id, { source: 'messenger' });
  assert.equal((await owner.get(`/api/reservations/${id}`)).data.reservation.source, 'messenger');
  const bad = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(500), check_out: d(501), guest_name: 'X', accommodation_total: '600', source: 'walk_in' });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.fields.source, 'Choose where they booked from the list.');
  const quote = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(500), check_out: d(501), guest_name: 'X', accommodation_total: '600', source: 'quote' });
  assert.equal(quote.status, 400);
  const air = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(500), check_out: d(501), guest_name: 'X', accommodation_total: '600', channel: 'airbnb', source: 'facebook' });
  assert.equal(air.status, 400);
  assert.equal(air.data.fields.source, 'Only direct bookings have a source.');
  const patch = await owner.patch(`/api/reservations/${id}`, { source: 'viber' });
  assert.equal(patch.status, 200, JSON.stringify(patch.data));
  assert.equal(patch.data.reservation.source, 'viber');
  const clear = await owner.patch(`/api/reservations/${id}`, { source: '' });
  assert.equal(clear.status, 200);
  assert.equal(clear.data.reservation.source, null);
});

test('#11 automation names are unique (case and spaces ignored); renaming to itself is fine', async () => {
  const t = await owner.get('/api/message-templates');
  const templateId = (t.data.templates || [])[0].template_id;
  const base = { template_id: templateId, trigger_event: 'check_in_day', send_time: '10:00' };
  const a = await owner.post('/api/automations', { ...base, name: 'Welcome note' });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  const dup = await owner.post('/api/automations', { ...base, name: '  welcome NOTE ' });
  assert.equal(dup.status, 400);
  assert.equal(dup.data.code, 'VALIDATION');
  assert.equal(dup.data.fields.name, 'You already have an automatic message called "Welcome note".');
  const b = await owner.post('/api/automations', { ...base, name: 'Second note' });
  assert.equal(b.status, 201);
  const clash = await owner.patch(`/api/automations/${b.data.automation.automation_id}`, { name: 'WELCOME note' });
  assert.equal(clash.status, 400);
  assert.equal((await owner.patch(`/api/automations/${a.data.automation.automation_id}`, { name: 'Welcome note' })).status, 200);
});

test('K1 a group rename writes one row; each room timeline shows it once', async () => {
  const g = await owner.post('/api/booking-groups', { name: 'Wedding', guest: { full_name: 'Ana Cruz' }, rooms: [
    { unit_id: unit.unit_id, check_in: d(700), check_out: d(702), accommodation_total: '1200' },
    { unit_id: unit2.unit_id, check_in: d(700), check_out: d(702), accommodation_total: '1200' }] });
  assert.equal(g.status, 201, JSON.stringify(g.data));
  const gid = g.data.group.group_id;
  const timeline = async (bid) => (await owner.get(`/api/reservations/${bid}/activity`)).data.items.length;
  const rooms = (await owner.get(`/api/booking-groups/${gid}`)).data.rooms;
  const before = await Promise.all(rooms.map((r) => timeline(r.booking_id)));
  assert.equal((await owner.patch(`/api/booking-groups/${gid}`, { name: 'Wedding party' })).status, 200);
  const rows = await sql(`SELECT record_type, record_id, details FROM audit_logs WHERE action = 'booking_group.updated' AND details->>'group_id' = $1`, [gid]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].record_type, 'booking_group');
  assert.equal(rows[0].record_id, gid);
  assert.deepEqual(rows[0].details.fields, ['name']);
  const after = await Promise.all(rooms.map((r) => timeline(r.booking_id)));
  assert.deepEqual(after.map((v, i) => v - before[i]), [1, 1]);
});

test('#22 balancepay host text keeps two decimals', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'balancepay.js'), 'utf8');
  assert.equal(/toLocaleString\('en-PH'\)/.test(src), false);
  const { fmtPeso } = require('../src/lib/messaging');
  assert.equal(fmtPeso('2805.5'), '₱2,805.50');
});
