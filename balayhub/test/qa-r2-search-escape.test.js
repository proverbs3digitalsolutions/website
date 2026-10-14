'use strict';

// QA round 2 (B35): the search boxes on deposits, reviews, discount codes and unit owners match
// % and _ literally. Before the fix, q=% matched every row and q=_ matched every row with any text.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_12 node --test --test-concurrency=1 test/qa-r2-search-escape.test.js

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);

let srv; let host;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Escape Stays');
  const p = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const unit = (await host.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', security_deposit_amount: '1000' })).data.unit;

  // A deposit held for Ana Cruz.
  const ana = (await host.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(-3), check_out: d(-1), guest_name: 'Ana Cruz', guest_email: 'ana@example.com' })).data.reservation;
  assert.equal((await host.post(`/api/reservations/${ana.booking_id}/deposit`, { amount: '1000', received_date: d(-3), method: 'cash' })).status, 201);

  // A private review from Ben Reyes. The review link is normally made when the thank-you message renders; set it directly here.
  const ben = (await host.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(-10), check_out: d(-8), guest_name: 'Ben Reyes' })).data.reservation;
  const token = crypto.randomBytes(16).toString('hex');
  await sql('UPDATE bookings SET review_token = $1 WHERE booking_id = $2', [token, ben.booking_id]);
  assert.equal((await client(srv.base).post(`/api/public/review/${token}`, { rating: 4, cleanliness: 4, comment: 'Clean and quiet' })).status, 201);

  // One discount code whose description holds a real %, one that doesn't.
  assert.equal((await host.post('/api/discount-codes', { code: 'SUMMER10', description: 'Summer 10% off', percent_off: 10 })).status, 201);
  assert.equal((await host.post('/api/discount-codes', { code: 'BALIK5', description: 'Returning guests', percent_off: 5 })).status, 201);

  // Two owners; the first has a _ in her email.
  assert.equal((await host.post('/api/unit-owners', { full_name: 'Maria Santos', email: 'maria_s@example.com', management_fee_pct: '20' })).status, 201);
  assert.equal((await host.post('/api/unit-owners', { full_name: 'Jun Reyes', email: 'jun@example.com', management_fee_pct: '15' })).status, 201);
});
test.after(async () => { await srv.close(); });

test('a % in a search matches only a value that really contains one', async () => {
  assert.deepEqual((await host.get('/api/deposits?q=%25')).data.deposits, []);
  assert.equal((await host.get('/api/reviews?q=%25')).data.matched, 0);
  assert.deepEqual((await host.get('/api/unit-owners?q=%25')).data.owners, []);
  assert.deepEqual((await host.get('/api/discount-codes?q=%25')).data.codes.map((c) => c.code), ['SUMMER10']);
});

test('a _ in a search matches only a value that really contains one', async () => {
  assert.deepEqual((await host.get('/api/deposits?q=_')).data.deposits, []);
  assert.equal((await host.get('/api/reviews?q=_')).data.matched, 0);
  assert.deepEqual((await host.get('/api/discount-codes?q=_')).data.codes, []);
  assert.deepEqual((await host.get('/api/unit-owners?q=_')).data.owners.map((o) => o.full_name), ['Maria Santos']);
});

test('a normal word still matches', async () => {
  assert.deepEqual((await host.get('/api/deposits?q=Cruz')).data.deposits.map((x) => x.guest_name), ['Ana Cruz']);
  assert.deepEqual((await host.get('/api/reviews?q=Clean')).data.reviews.map((r) => r.guest_name), ['Ben Reyes']);
  assert.deepEqual((await host.get('/api/discount-codes?q=Returning')).data.codes.map((c) => c.code), ['BALIK5']);
  assert.deepEqual((await host.get('/api/unit-owners?q=Maria')).data.owners.map((o) => o.full_name), ['Maria Santos']);
});
