'use strict';

// QA round 15, lane G1: guest review link keeps the share links on return, quote page uses the shared phone check,
// place-card avatar is hidden from screen readers, standalone "See all places" is a tap-size link.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const view = (f) => fs.readFileSync(path.join(__dirname, '../public/js/views', f), 'utf8');
const d = (n) => ical.addDays(manilaToday(), n);
const LINKS = [{ label: 'Google', url: 'https://g.page/balay' }];

let srv; let owner; let unit;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'g1@example.com', 'G1 Stays');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500' })).data.unit;
  await owner.patch('/api/workspace/guest-settings', { review_links: LINKS });
});
test.after(async () => { await srv.close(); });

const tokenFor = async (email, ci, co) => {
  const b = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: ci, check_out: co, guest_name: 'Mia Cruz', guest_email: email })).data.reservation;
  const token = crypto.randomBytes(24).toString('base64url');
  await sql('UPDATE bookings SET review_token = $2 WHERE booking_id = $1', [b.booking_id, token]);
  return token;
};

test('GET review: a reviewed 5-star stay still has the share links; a 3-star one has none', async () => {
  const guest = client(srv.base);
  const five = await tokenFor('five@example.com', d(-50), d(-48));
  assert.equal((await guest.post(`/api/public/review/${five}`, { rating: 5 })).status, 201);
  const g5 = await guest.get(`/api/public/review/${five}`);
  assert.equal(g5.data.reviewed, true);
  assert.deepEqual(g5.data.share_links, LINKS);
  const three = await tokenFor('three@example.com', d(-40), d(-38));
  await guest.post(`/api/public/review/${three}`, { rating: 3 });
  const g3 = await guest.get(`/api/public/review/${three}`);
  assert.equal(g3.data.reviewed, true);
  assert.equal(g3.data.share_links, undefined);
  const open = await guest.get(`/api/public/review/${await tokenFor('open@example.com', d(-30), d(-28))}`);
  assert.equal(open.data.share_links, undefined, 'not yet reviewed: no links');
});

test('scans: quote phone check, avatar aria-hidden, See all places link-tap', () => {
  const quote = view('quote.js'); const book = view('book.js'); const review = view('review.js');
  const re = (src) => src.match(/const PHONE_RE = (.*);/)?.[1];
  assert.ok(re(book) && re(book) === re(quote), 'quote.js and book.js use the same phone rule');
  assert.match(quote, /PHONE_RE\.test/);
  assert.match(quote, /Enter a valid phone number\./);
  assert.match(book, /class: `\$\{cls\} bk-noimg`, 'aria-hidden': 'true'/);
  assert.match(book, /class: 'link-tap', href: `#\/book\/\$\{params\.slug\}`\}?[^)]*See all places|link-tap[^\n]*See all places/);
  assert.match(review, /d\.share_links/);
  const seeAll = book.split('\n').filter((l) => l.includes("t('See all places')"));
  assert.equal(seeAll.length, 2);
  for (const l of seeAll) assert.match(l, /class: 'link-tap'/);
});
