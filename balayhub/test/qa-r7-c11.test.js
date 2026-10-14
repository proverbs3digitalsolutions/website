'use strict';

// QA round 7, C11 quotes (#18 / K1). A listing with no nightly rate must never price a new quote at PHP 0:
// the price preview answers missing_rates, the Accommodation box stays empty for the host to type, and no
// rate-card button offers 0 or nothing. Server checks run on this lane's own database (balayhub_test_r2_08).
// The screen rule loads from a temp copy with a stub app.js (as test/qa-r6-c18.test.js does), so it runs in Node.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);
const read = (f) => fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8');

let srv; let owner; let priced; let unpriced;
let dir; let quotes;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'quote-r7-c11@example.com', 'Harbor R7 C11');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Paranaque', province: 'Metro Manila' })).data.property;
  const mk = async (unit_name, nightly_rate) => (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name, unit_type: 'studio', nightly_rate, cleaning_fee: '500', max_guests: 4, description: 'Sea view.', bookable_online: true, min_nights: 2,
  })).data.unit;
  priced = await mk('Azure 301', '2500');
  unpriced = await mk('Azure 302', undefined);

  globalThis.Element = class { }; // ui.js names the DOM Element class at load time; a stub is enough here
  globalThis.document = { documentElement: {} };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r7-c11-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'i18n.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: null };\n');
  fs.copyFileSync(path.join(__dirname, '../public/js/views/quotes.js'), path.join(dir, 'views', 'quotes.js'));
  quotes = await import(pathToFileURL(path.join(dir, 'views', 'quotes.js')));
});
test.after(async () => { fs.rmSync(dir, { recursive: true, force: true }); await srv.close(); });

test('the price preview answers missing_rates for a listing with no nightly rate, and not for a priced one', async () => {
  const dates = `check_in=${d(5)}&check_out=${d(7)}`;
  const none = await owner.get(`/api/units/${unpriced.unit_id}/price-preview?${dates}`);
  assert.equal(none.status, 200, JSON.stringify(none.data));
  assert.equal(none.data.missing_rates, true);
  const ok = await owner.get(`/api/units/${priced.unit_id}/price-preview?${dates}`);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.missing_rates, false);
  assert.equal(ok.data.accommodation_total, '5000.00');
});

test('a stay with one night that has no rate is missing_rates too, even when the other nights are priced', async () => {
  await sql('INSERT INTO nightly_rates (unit_id, rate_date, price) VALUES ($1, $2, 2500)', [unpriced.unit_id, d(5)]);
  const r = await owner.get(`/api/units/${unpriced.unit_id}/price-preview?check_in=${d(5)}&check_out=${d(7)}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.missing_rates, true);
  assert.equal(r.data.accommodation_total, '2500.00', 'the priced night is still counted, the missing one is not');
});

test('a rate-card price is only a price above 0 from a stay with rates for every night', () => {
  assert.equal(quotes.rateStay({ missing_rates: true, accommodation_total: '0.00' }), null);
  assert.equal(quotes.rateStay({ missing_rates: false, accommodation_total: '0.00' }), null, 'never 0');
  assert.equal(quotes.rateStay({ missing_rates: false, accommodation_total: '2500.00' }), '2500.00');
});

test('the rate-card offer is for a price the box does not already hold; an unreadable box counts as different', () => {
  assert.equal(quotes.rateOffer('2500', '2500.00'), false, 'the box already holds the rate');
  assert.equal(quotes.rateOffer('2500.00', '2500.00'), false);
  assert.equal(quotes.rateOffer('3000', '2500.00'), true);
  assert.equal(quotes.rateOffer('1,5', '2500.00'), true, 'a box that is not an amount is different');
  assert.equal(quotes.rateOffer('', '2500.00'), true);
  assert.equal(quotes.rateOffer('3000', null), false, 'no rate for some nights: nothing to offer');
  assert.equal(quotes.rateOffer('3000', '0.00'), false, 'never offers 0');
});

test('the preview screen names the missing rate and keeps the rate-card button label', () => {
  const src = read('views/quotes.js');
  assert.match(src, /This listing has no nightly rate for some nights\. Enter the total yourself\./);
  assert.match(src, /p\.missing_rates\s*\n?\s*\?/);
  assert.match(src, /Use rate-card price/);
});

test('the preview fills and offers only through the rate helpers, and an empty Accommodation box shows no total', () => {
  const src = read('views/quotes.js');
  assert.match(src, /const stay = rateStay\(p\);/);
  assert.match(src, /el\('accommodation_total'\)\.value = stay \?\? ''/);
  assert.match(src, /useRate\.hidden = !rateOffer\(el\('accommodation_total'\)\.value, stay\)/);
  assert.match(src, /stayBox === '' \? NaN/);
});
