'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

// QA round 11, lane C03. #1 overpaid receipt line, #38 one 400 with every error, #39 quote refuses 1900,
// #5 guest-count text, K7 booking locks the unit row.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_01 node --test --test-concurrency=1 test/qa-r11-c03.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const receipts = require('../src/lib/receipts');
const { validate } = require('../src/lib/validate');

let srv; let owner; let prop; let unit;
const d = (k) => ical.addDays(manilaToday(), k);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qar11c03@example.com', 'QA R11 C03');
  prop = (await owner.post('/api/properties', { property_name: 'R11 Place', property_type: 'condominium', address: '1 Test St, Pasig', city: 'Pasig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'R11 Loft', unit_type: 'studio', nightly_rate: '4200', max_guests: 4, room_type: 'studio' })).data.unit;
});
test.after(async () => { await srv.close(); });

const text = async (paid, from) => {
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(from), check_out: d(from + 1), guest_name: 'Guest', accommodation_total: '4200', cleaning_fee: '0' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const [{ payment_id }] = await sql(
    `INSERT INTO booking_payments (organization_id, booking_id, amount, payment_method, payment_date, receipt_number)
     SELECT organization_id, booking_id, $2, 'cash', current_date, 'R11-' || substr(md5(random()::text), 1, 6) FROM bookings WHERE booking_id = $1 RETURNING payment_id`,
    [r.data.reservation.booking_id, paid]);
  return receipts.receiptText(await receipts.receiptData(payment_id));
};

test('#1 an overpaid receipt says Overpaid by, not a zero balance', async () => {
  const t = await text('5000', 200);
  assert.match(t, /Overpaid by: ₱800\.00/);
  assert.doesNotMatch(t, /Remaining balance: ₱0\.00/);
});

test('#1 an underpaid receipt still says Remaining balance', async () => {
  assert.match(await text('1000', 210), /Remaining balance: ₱3,200\.00/);
});

test('#5 int message replaces the generic text', () => {
  const spec = { n: { type: 'int', min: 1, message: 'X' } };
  for (const v of ['2.5', 0]) assert.throws(() => validate({ n: v }, spec), (e) => e.extra.fields.n === 'X');
});

test('#38 check() messages join the same 400 and never replace a field error', () => {
  const spec = { a: { type: 'int', label: 'A' }, check_out: { type: 'string' } };
  assert.throws(() => validate({ a: 'x', check_out: 'q' }, spec, { check: () => ({ check_out: 'Y', a: 'ignored' }) }),
    (e) => e.status === 400 && e.extra.fields.check_out === 'Y' && e.extra.fields.a === 'A must be a whole number.');
  assert.deepEqual(validate({ a: 1 }, spec, { check: () => null }).a, 1);
});

test('#38 POST /reservations: inverted dates and a negative total report both', async () => {
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(30), check_out: d(28), guest_name: 'G', accommodation_total: '-5' });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.check_out, 'Check-out must be after check-in.');
  assert.ok(r.data.fields.accommodation_total);
});

test('#39 the quote refuses 1900 dates', async () => {
  const r = await owner.get(`/api/reservations/quote?unit_id=${unit.unit_id}&check_in=1900-01-01&check_out=1900-01-03`);
  assert.equal(r.status, 400);
  assert.ok(r.data.fields.check_in);
});

test('#5 POST /quotes with 0 guests', async () => {
  const r = await owner.post('/api/quotes', { unit_id: unit.unit_id, check_in: d(40), check_out: d(41), num_guests: 0, guest_name: 'Q', accommodation_total: '4200', pay_type: 'full' });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.num_guests, 'Enter a whole number of guests, 1 or more.');
});

test('K7 POST and PATCH /reservations lock the unit row and re-check leases inside the transaction', () => {
  const src = fs.readFileSync(require.resolve('../src/routes/stays.js'), 'utf8');
  for (const [route, end] of [["router.post('/reservations', managers", "router.patch('/reservations/:id'"], ["router.patch('/reservations/:id', managers", "router.post('/reservations/:id/cancel'"]]) {
    const body = src.slice(src.indexOf(route), src.indexOf(end));
    const tx = body.slice(body.indexOf('await tx('));
    assert.match(tx, /FROM units WHERE unit_id = \$1 FOR UPDATE/, route);
    assert.match(tx, /assertStayAllowed\([^)]*, db\)/, route);
  }
});
