'use strict';

// QA round 8, C12 quotes (#14, K19). A quote can't have more guests than its listing allows: the server refuses
// it at the Guests field, as reservations and the booking page do, and the quote form checks it before posting.
// A rate-card offer is hidden whenever the price it came from is no longer on screen (a failed check, or cleared dates).
// Server checks run on this lane's own database (balayhub_test_r2_11).

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

let srv; let owner; let unit; let dir; let quotes;

// The body the host screen sends for a 2-night quote on the test listing (max 4 guests).
const body = (over = {}) => ({
  unit_id: unit.unit_id, check_in: d(5), check_out: d(7), num_guests: 2, guest_name: 'Juan Dela Cruz',
  accommodation_total: '5000', pay_type: 'full', ...over,
});

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'quote-r8-c12@example.com', 'Harbor R8 C12');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Paranaque', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: 'Azure 301', unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, description: 'Sea view.', bookable_online: true, min_nights: 2,
  })).data.unit;

  globalThis.Element = class { }; // ui.js names the DOM Element class at load time; a stub is enough here
  globalThis.document = { documentElement: {} };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r8-c12-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'i18n.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: null };\n');
  fs.copyFileSync(path.join(__dirname, '../public/js/views/quotes.js'), path.join(dir, 'views', 'quotes.js'));
  quotes = await import(pathToFileURL(path.join(dir, 'views', 'quotes.js')));
});
test.after(async () => { fs.rmSync(dir, { recursive: true, force: true }); await srv.close(); });

test('a quote for more guests than the listing allows is refused at the Guests field, and nothing is saved', async () => {
  const before = (await sql('SELECT COUNT(*)::int AS n FROM booking_quotes'))[0].n;
  const r = await owner.post('/api/quotes', body({ num_guests: 5 }));
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.deepEqual(r.data.fields, { num_guests: 'This listing allows up to 4 guests.' });
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM booking_quotes'))[0].n, before, 'no quote row was written');
});

test('a quote for exactly the listing maximum is accepted', async () => {
  const r = await owner.post('/api/quotes', body({ num_guests: 4 }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.quote.num_guests, 4);
});

test('the listing limit is read from the listing list, and is none when the listing has no limit', () => {
  assert.equal(quotes.guestLimit([{ unit_id: 'a', max_guests: 4 }, { unit_id: 'b', max_guests: null }], 'a'), 4);
  assert.equal(quotes.guestLimit([{ unit_id: 'a', max_guests: 4 }, { unit_id: 'b', max_guests: null }], 'b'), null);
  assert.equal(quotes.guestLimit([{ unit_id: 'a', max_guests: 4 }], ''), null, 'no listing picked yet');
});

test('the Guests box stops at the listing maximum and the form refuses more before it posts', () => {
  const src = read('views/quotes.js');
  assert.match(src, /el\('num_guests'\)\.max = String\(guestLimit\(listings, el\('unit_id'\)\.value\) \|\| 50\);/);
  assert.match(src, /if \(n === 'unit_id'\) \{ drawAddons\(\); fitGuests\(\); \}/);
  assert.match(src, /const cap = guestLimit\(listings, d\.unit_id\);\s*\n\s*if \(cap && Number\(d\.num_guests\) > cap\)/);
  assert.match(src, /const m = `This listing allows up to \$\{cap\} guests\.`; throw new ApiError\(m, \{ status: 400, fields: \{ num_guests: m \} \}\);/);
});

test('a preview that cannot be priced, or has no dates to price, hides the rate-card offer before anything else', () => {
  const src = read('views/quotes.js');
  const load = src.slice(src.indexOf('async function loadPreview()'), src.indexOf("for (const n of ['unit_id'"));
  const hide = load.indexOf('useRate.hidden = true;');
  assert.ok(hide > -1, 'loadPreview hides the offer');
  assert.ok(hide < load.indexOf('try {'), 'the hide runs before the price is asked for, so a failed check leaves no offer');
  assert.ok(hide < load.indexOf("if (!unit ||"), 'the hide also runs when the dates are cleared');
});

test('a listing with no guest limit takes any party size the form allows', async () => {
  await sql('UPDATE units SET max_guests = NULL WHERE unit_id = $1', [unit.unit_id]);
  const r = await owner.post('/api/quotes', body({ num_guests: 10 }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
});
