'use strict';

// QA round 9, lane C05 (checkin): a blank guest row is refused at its field instead of being dropped,
// and the host note says "booked for N" when fewer names than booked guests were saved (#7).
// The view is checked by a source scan (the test runner has no DOM).

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Host <host@example.com>';
process.env.GUEST_ID_RETENTION_DAYS = '30';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
const BLANK_MSG = 'Enter the name of each guest, or remove the empty row.';
const d = (n) => ical.addDays(manilaToday(), n);

let srv; let owner; let short; let full;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Check-in Guests');
  const prop = (await owner.post('/api/properties', { property_name: 'Sunset', property_type: 'condominium', address: 'Pasig Blvd', city: 'Pasig', province: 'Metro Manila' })).data.property;
  const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '504', unit_type: 'studio', nightly_rate: '2000', max_guests: 4 })).data.unit;
  short = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(3), check_out: d(5), guest_name: 'Rafael Diaz', guest_email: 'rafael@example.com', num_guests: 3 })).data.reservation;
  full = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(20), check_out: d(22), guest_name: 'Maria Diaz', guest_email: 'maria@example.com', num_guests: 3 })).data.reservation;
});
test.after(async () => { await srv.close(); });

const tokenFor = async (bookingId) => (await owner.get(`/api/reservations/${bookingId}/checkin`)).data.link.split('/checkin/')[1];
const form = (guests) => ({ lead_name: 'Rafael Diaz', phone: '09171112222', consent: true, guests, id_photos: 1 });
const hostNotes = (bookingId) => sql(
  `SELECT m.body FROM messages m JOIN conversations c USING (conversation_id)
    WHERE c.booking_id = $1 AND m.direction = 'note' AND m.body LIKE 'The guest completed%' ORDER BY m.created_at`, [bookingId]);

test('a blank guest row is refused at its field and nothing is saved', async () => {
  const token = await tokenFor(short.booking_id);
  const guest = client(srv.base);
  for (const guests of [['', 'Ana Diaz'], ['Ana Diaz', '   ']]) {
    const res = await guest.post(`/api/public/checkin/${token}`, form(guests));
    assert.equal(res.status, 400, JSON.stringify(guests));
    assert.deepEqual(res.data.fields, { guests: BLANK_MSG });
  }
  assert.equal((await guest.get(`/api/public/checkin/${token}`)).data.registration, null);
  assert.equal((await hostNotes(short.booking_id)).length, 0, 'no note for a refused form');
});

test('fewer names than booked guests: the host note says "booked for N"', async () => {
  const token = await tokenFor(short.booking_id);
  const guest = client(srv.base);
  const ok = await guest.post(`/api/public/checkin/${token}`, form(['Ana Diaz']));
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  // The host note is sent when the first ID photo is stored (D-95).
  assert.equal((await guest.post(`/api/public/checkin/${token}/id`, PNG, { 'Content-Type': 'image/png' })).status, 201);
  const notes = await hostNotes(short.booking_id);
  assert.equal(notes.length, 1);
  assert.match(notes[0].body, /\(2 guests, booked for 3\)\.$/);
});

test('a full list of names has no "booked for" in the host note', async () => {
  const token = await tokenFor(full.booking_id);
  const guest = client(srv.base);
  const ok = await guest.post(`/api/public/checkin/${token}`, form(['Ana Diaz', 'Leo Diaz']));
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  // The host note is sent when the first ID photo is stored (D-95).
  assert.equal((await guest.post(`/api/public/checkin/${token}/id`, PNG, { 'Content-Type': 'image/png' })).status, 201);
  const notes = await hostNotes(full.booking_id);
  assert.equal(notes.length, 1);
  assert.match(notes[0].body, /\(3 guests\)\.$/);
  assert.doesNotMatch(notes[0].body, /booked for/);
});

// Source scans: the view marks a blank guest row before anything is posted, and its message has a Taglish entry.
const view = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'checkin.js'), 'utf8');
const beforePost = view.slice(0, view.indexOf('await post(`/public/checkin/'));

test('the view marks a blank guest row and refuses it before posting', () => {
  assert.match(beforePost, /problems\.guests = t\('Enter the name of each guest, or remove the empty row\.'\)/);
  assert.match(beforePost, /classList\.add\('field--invalid'\)/);
});

test('the guest-facing blank-row message has a Taglish entry on the page', () => {
  assert.match(view, /'Enter the name of each guest, or remove the empty row\.': 'Pakilagay ang pangalan ng bawat guest, o alisin ang walang laman na row\.'/);
});
