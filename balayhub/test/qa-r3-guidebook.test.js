'use strict';

// QA round 3, lane C21 (N1): a guest who opens the guidebook link before its window is told the date
// it opens, instead of "ask your host for a new link". Bad, cancelled and ended links keep the old 404.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Host <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const ical = require('../src/lib/ical');
const guidebook = require('../src/lib/guidebook');

const TOKEN_RE = /^https?:\/\/[^/]+\/#\/guide\/([A-Za-z0-9_-]{32})$/;
const NOT_AVAILABLE = 'This guidebook is not available for this stay. Please ask your host for a new link.';
const WIFI = 'Azure-5G-secret';
const PROPERTY = 'Azure Window';
const GUEST_TEXT = 'Rafael Diaz';

const today = guidebook.manilaToday();
const d = (n) => ical.addDays(today, n);

let srv; let owner; let guest; let prop; let seq = 0;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qa-r3-guide-owner@example.com', 'Guide Window');
  guest = client(srv.base);
  prop = (await owner.post('/api/properties', {
    property_name: PROPERTY, property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila',
  })).data.property;
});

test.after(async () => { await srv.close(); });

// A confirmed stay on its own listing (the database refuses overlapping stays on one listing), with its
// guide link. Dates are moved after creation, as the existing guidebook tests do.
async function linkFor(checkIn, checkOut) {
  seq += 1;
  const [u] = await sql(
    `INSERT INTO units (property_id, unit_name, unit_type, nightly_rate, max_guests, checkin_time, checkout_time,
                        wifi_name, wifi_password)
     VALUES ($1, $2, 'studio', 2000, 4, '14:00', '12:00', 'Azure-Net', $3)
     RETURNING unit_id`, [prop.property_id, `W${seq}`, WIFI]);
  const slot = 60 + seq * 4;
  const r = await owner.post('/api/reservations', {
    unit_id: u.unit_id, check_in: d(slot), check_out: d(slot + 2), guest_name: GUEST_TEXT,
    guest_email: 'rafael@example.com', num_guests: 2, send_confirmation: false,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.reservation.booking_id;
  await sql('UPDATE bookings SET check_in = $2, check_out = $3 WHERE booking_id = $1', [id, checkIn, checkOut]);
  const link = await owner.post(`/api/reservations/${id}/guide-link`);
  assert.equal(link.status, 200, JSON.stringify(link.data));
  return { id, token: TOKEN_RE.exec(link.data.url)[1], listing: `W${seq}` };
}

test('before the window: 409 GUIDE_NOT_YET with the date it opens (check-in minus 14 days), and nothing about the stay', async () => {
  const far = await linkFor(d(30), d(32));
  const r = await guest.get(`/api/public/guide/${far.token}`);
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'GUIDE_NOT_YET');
  assert.equal(r.data.opens_on, d(16));
  assert.deepEqual(Object.keys(r.data).sort(), ['code', 'error', 'opens_on']);
  const text = JSON.stringify(r.data);
  for (const secret of [PROPERTY, far.listing, 'Azure-Net', WIFI, 'Rafael', 'Diaz']) {
    assert.ok(!text.includes(secret), `no ${secret} before the window`);
  }
});

test('the opening date follows the stay, one day at a time, and the window itself opens on that day', async () => {
  const soon = await linkFor(d(15), d(17));
  const r = await guest.get(`/api/public/guide/${soon.token}`);
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.opens_on, d(1));

  const opensToday = await linkFor(d(14), d(16));
  const open = await guest.get(`/api/public/guide/${opensToday.token}`);
  assert.equal(open.status, 200, JSON.stringify(open.data));
  assert.equal(open.data.secrets_from, d(13));
});

test('a stay inside its window still opens the guidebook', async () => {
  const x = await linkFor(d(1), d(3));
  const r = await guest.get(`/api/public/guide/${x.token}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.wifi_password, WIFI);
});

test('a cancelled stay before its window keeps the old "not available" 404, not the opening date', async () => {
  const x = await linkFor(d(30), d(32));
  await sql(`UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE booking_id = $1`, [x.id]);
  const r = await guest.get(`/api/public/guide/${x.token}`);
  assert.equal(r.status, 404, JSON.stringify(r.data));
  assert.equal(r.data.error, NOT_AVAILABLE);
  assert.equal('opens_on' in r.data, false);
});

test('bad tokens and ended windows keep the same "not available" 404', async () => {
  const bad = await guest.get('/api/public/guide/short');
  const unknown = await guest.get(`/api/public/guide/${'A'.repeat(32)}`);
  const ended = await linkFor(d(-5), d(-3));
  const over = await guest.get(`/api/public/guide/${ended.token}`);
  for (const r of [bad, unknown, over]) {
    assert.equal(r.status, 404, JSON.stringify(r.data));
    assert.equal(r.data.error, NOT_AVAILABLE);
    assert.equal('opens_on' in r.data, false);
  }
  assert.deepEqual(bad.data, unknown.data);
});

test('guest page: a Taglish opening line that names the date, and the "Your guidebook" title', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/guide.js'), 'utf8');
  const en = 'Your guidebook opens on {date}. Come back then; this same link will work.';
  assert.ok(src.includes(`t('${en}'`), 'the page asks for the opening line through t()');
  assert.match(src, /'Your guidebook opens on \{date\}\. Come back then; this same link will work\.': 'Magbubukas ang guidebook mo sa \{date\}\./);
  assert.match(src, /err\.code === 'GUIDE_NOT_YET'/);
  assert.match(src, /err\.data\?\.opens_on/);
  assert.match(src, /t\('Your guidebook'\)/);
});

test('guest route: the early answer is GUIDE_NOT_YET with opens_on (source check)', () => {
  const route = fs.readFileSync(path.join(__dirname, '../src/routes/guidebook.js'), 'utf8');
  assert.match(route, /GUIDE_NOT_YET/);
  assert.match(route, /opens_on/);
});
