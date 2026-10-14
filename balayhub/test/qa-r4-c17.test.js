'use strict';

// QA round 4, lane C17 directbooking: the public quote refuses more guests than the listing allows, the same as
// checkout does, so a quote never says a place is available for a group it can't take (public#27).
process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);
const SLUG = 'r4-c17-quote';
let srv; let unit;

test.before(async () => {
  srv = await startServer();
  const owner = await ownerAccount(srv.base, 'r4-c17-quote@example.com', 'R4 Quote Limit Stays');
  const p = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${p.property_id}/units`, {
    unit_name: 'Paris 1208', unit_type: 'studio', nightly_rate: '2500', max_guests: 4, bookable_online: true, min_nights: 2,
  })).data.unit;
  // Turning the page on needs a PayMongo key, which this quote test doesn't touch, so the flag is set directly.
  await sql(`UPDATE organizations SET booking_enabled = true, booking_slug = $1 WHERE name = 'R4 Quote Limit Stays'`, [SLUG]);
});
test.after(async () => { await srv.close(); });

const quote = (guests) => client(srv.base).get(`/api/public/book/${SLUG}/units/${unit.unit_id}/quote?check_in=${d(5)}&check_out=${d(7)}&guests=${guests}`);

test('public quote refuses more guests than the listing allows, with the checkout message (public#27)', async () => {
  const over = await quote(9);
  assert.equal(over.status, 400, JSON.stringify(over.data));
  assert.deepEqual(over.data.fields, { guests: 'This place allows up to 4 guests.' });
  assert.equal((await quote(4)).status, 200, 'the maximum itself is allowed');
  assert.equal((await quote(1)).status, 200);
  assert.equal((await quote(5)).status, 400, 'one over the maximum is refused');
});
