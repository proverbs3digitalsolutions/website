'use strict';
require('./helpers');
// QA round 48, QUOTEYEAR (D-130): a quote is capped at one year like a reservation, even when the host types the price by hand.
// A check-out that makes a 367-night quote is refused on Check-out with the reservation sentence and saves no row; 366 nights is still saved.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, sql, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);
const ONE_YEAR = 'Stays are limited to one year.';
let srv; let owner; let unit;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qa-r48-quoteyear@example.com', 'QA r48 quote year');
  const prop = (await owner.post('/api/properties', { property_name: 'QA r48 quote year P', property_type: 'condominium', address: 'P St', city: 'Pasay', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'QA r48 quote year 1', unit_type: 'studio', nightly_rate: '2500', max_guests: 4 })).data.unit;
});
test.after(async () => { await srv.close(); });

// A quote with a typed accommodation price (the host typed it by hand, so the price check is not in play).
const body = (ci, co) => ({ unit_id: unit.unit_id, check_in: ci, check_out: co, num_guests: 2, guest_name: 'QA r48 quote year guest', accommodation_total: '1000', pay_type: 'full' });
const quoteRows = async () => (await sql('SELECT COUNT(*)::int AS n FROM booking_quotes WHERE unit_id = $1', [unit.unit_id]))[0].n;

test('a quote for 367 nights is refused on check-out even with a typed price, and saves no row', async () => {
  const before = await quoteRows();
  const r = await owner.post('/api/quotes', body(d(1), d(368)));
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.check_out, ONE_YEAR);
  assert.equal(await quoteRows(), before);
});

test('a quote for exactly one year (366 nights) is still saved', async () => {
  const r = await owner.post('/api/quotes', body(d(1), d(367)));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.quote.check_out, d(367));
});

test('the order check still wins: a check-out before check-in gets its own sentence, not the one-year one', async () => {
  const r = await owner.post('/api/quotes', body(d(5), d(2)));
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.check_out, 'Choose a check-out date after check-in.');
});
