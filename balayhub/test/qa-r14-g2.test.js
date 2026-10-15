'use strict';

// QA round 14, lane G2 (#8): a check-in registration needs at least one ID photo, checked on the
// client and on the server. The view is checked by a source scan (the test runner has no DOM).

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Host <host@example.com>';
process.env.GUEST_ID_RETENTION_DAYS = '30';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const MSG = 'Add a photo of a valid ID for at least one guest.';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
const d = (n) => ical.addDays(manilaToday(), n);
const form = (extra = {}) => ({ lead_name: 'Rafael Diaz', phone: '09171112222', consent: true, guests: [], ...extra });

let srv; let owner; let unit;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Check-in IDs');
  const prop = (await owner.post('/api/properties', { property_name: 'Sunset', property_type: 'condominium', address: 'Pasig Blvd', city: 'Pasig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '504', unit_type: 'studio', nightly_rate: '2000', max_guests: 4 })).data.unit;
});
test.after(async () => { await srv.close(); });

let n = 0;
async function newStay() {
  n += 1;
  const r = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(3 + n * 3), check_out: d(5 + n * 3), guest_name: 'Rafael Diaz', guest_email: 'rafael@example.com', num_guests: 2 })).data.reservation;
  const token = (await owner.get(`/api/reservations/${r.booking_id}/checkin`)).data.link.split('/checkin/')[1];
  return { r, token };
}

test('no photo and none stored: 400 on id_photos, nothing saved', async () => {
  const { r, token } = await newStay();
  const g = client(srv.base);
  for (const extra of [{}, { id_photos: 0 }, { id_photos: 'x' }]) {
    const res = await g.post(`/api/public/checkin/${token}`, form(extra));
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.equal(res.data.code, 'VALIDATION');
    assert.deepEqual(res.data.fields, { id_photos: MSG });
  }
  assert.equal((await sql('SELECT 1 FROM guest_registrations WHERE booking_id = $1', [r.booking_id])).length, 0);
});

test('other problems and the missing photo come back in one pass', async () => {
  const { token } = await newStay();
  const res = await client(srv.base).post(`/api/public/checkin/${token}`, { lead_name: 'Rafael Diaz', phone: '09171112222' });
  assert.equal(res.status, 400);
  assert.equal(res.data.fields.id_photos, MSG);
  assert.ok(res.data.fields.consent);
});

test('id_photos of 1 or more is accepted', async () => {
  const { token } = await newStay();
  const res = await client(srv.base).post(`/api/public/checkin/${token}`, form({ id_photos: 1 }));
  assert.equal(res.status, 200, JSON.stringify(res.data));
});

test('a registration that already has a stored ID can be edited without sending another', async () => {
  const { token } = await newStay();
  const g = client(srv.base);
  assert.equal((await g.post(`/api/public/checkin/${token}`, form({ id_photos: 1 }))).status, 200);
  assert.equal((await g.post(`/api/public/checkin/${token}/id`, PNG, { 'Content-Type': 'image/png' })).status, 201);
  assert.equal((await g.post(`/api/public/checkin/${token}`, form({ lead_name: 'Rafael D.' }))).status, 200);
});

test('a registration saved but with no stored ID still needs a photo on the next save', async () => {
  const { token } = await newStay();
  const g = client(srv.base);
  assert.equal((await g.post(`/api/public/checkin/${token}`, form({ id_photos: 1 }))).status, 200);
  const again = await g.post(`/api/public/checkin/${token}`, form());
  assert.equal(again.status, 400);
  assert.equal(again.data.fields.id_photos, MSG);
});

const view = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'checkin.js'), 'utf8');
const beforePost = view.slice(0, view.indexOf('await post(`/public/checkin/'));

test('the view refuses a missing ID photo before posting, and sends the count', () => {
  assert.match(beforePost, /!picked\.length && !\(r\?\.id_count > 0\)/);
  assert.match(beforePost, /problems\.id_photos = t\('Add a photo of a valid ID for at least one guest\.'\)/);
  assert.match(view, /id_photos: picked\.length/);
});

test('the new sentence has a Taglish entry and the Valid ID heading is marked required', () => {
  assert.match(view, /'Add a photo of a valid ID for at least one guest\.': 'Mag-upload ng litrato ng valid ID ng kahit isang guest\.'/);
  assert.match(view, /h\('span', \{ class: 'req', 'aria-hidden': 'true' \}, '\* '\)/);
});

test('a guest who already registered sees "Your check-in details", not "Please register"', () => {
  assert.match(view, /s\.closed \? t\('Guest registration'\) : \(s\.checked_in \|\| r\) \? t\('Your check-in details'\)/);
});
