'use strict';

// QA round 11, C06 (direct booking server): a guest count is checked against the listing's own limit
// before the generic 50 (#8), and a booking page can't be turned on with no listing ticked (K4).
process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);
const KEY = 'sk_test_c06KEY1234567890';
let srv; let owner; let propertyId; let capped; let open; let slug;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'r11-c06@example.com', 'R11 C06 Stays');
  const p = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  propertyId = p.property_id;
  capped = (await owner.post(`/api/properties/${p.property_id}/units`, {
    unit_name: 'Paris 1208', unit_type: 'studio', nightly_rate: '2500', max_guests: 4, bookable_online: true, min_nights: 2,
  })).data.unit;
  // No max_guests: the 50 guest cap applies.
  open = (await owner.post(`/api/properties/${p.property_id}/units`, {
    unit_name: 'Hall 1', unit_type: 'studio', nightly_rate: '2000', bookable_online: true, min_nights: 2,
  })).data.unit;
  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: KEY, enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  slug = r.data.url.split('/#/book/')[1];
});
test.after(async () => { await srv.close(); });

const quote = (unit, guests) => client(srv.base).get(`/api/public/book/${slug}/units/${unit.unit_id}/quote?check_in=${d(5)}&check_out=${d(7)}&guests=${guests}`);
const checkout = (unit, num_guests) => client(srv.base).post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, {
  check_in: d(5), check_out: d(7), num_guests, name: 'Juan Dela Cruz', email: 'juan@example.com', phone: '09171234567', pay: 'full', consent: true,
});

test('public quote: the listing limit is named, not the generic 50 (#8)', async () => {
  const over = await quote(capped, 100);
  assert.equal(over.status, 400, JSON.stringify(over.data));
  assert.deepEqual(over.data.fields, { guests: 'This place allows up to 4 guests.' });
  assert.equal((await quote(capped, 5)).status, 400, 'one over the listing limit is refused');
  assert.equal((await quote(capped, 4)).status, 200, 'the listing limit itself is allowed');
  const fraction = await quote(capped, 2.5);
  assert.equal(fraction.status, 400, 'a fraction of a guest is refused');
  assert.ok(fraction.data.fields.guests, 'and the field is named');
});

test('public quote: with no listing limit, 50 guests are allowed and 51 are refused (#8)', async () => {
  assert.equal((await quote(open, 50)).status, 200, 'the 50 cap itself is allowed');
  const over = await quote(open, 60);
  assert.equal(over.status, 400, JSON.stringify(over.data));
  assert.deepEqual(over.data.fields, { guests: 'Guests must be at most 50.' });
});

test('public checkout: the same guest limits, checked before any payment starts (#8)', async () => {
  const over = await checkout(capped, 100);
  assert.equal(over.status, 400, JSON.stringify(over.data));
  assert.deepEqual(over.data.fields, { num_guests: 'This place allows up to 4 guests.' });
  const noLimit = await checkout(open, 60);
  assert.equal(noLimit.status, 400, JSON.stringify(noLimit.data));
  assert.deepEqual(noLimit.data.fields, { num_guests: 'Guests must be at most 50.' });
});

test('a booking page with no listing ticked cannot be turned on; turning it off is never refused (K4)', async () => {
  const empty = await ownerAccount(srv.base, 'r11-c06-empty@example.com', 'R11 C06 Empty');
  const p = (await empty.post('/api/properties', { property_name: 'Lone', property_type: 'condominium', address: 'Ortigas', city: 'Pasig', province: 'Metro Manila' })).data.property;
  const unit = (await empty.post(`/api/properties/${p.property_id}/units`, { unit_name: 'Hidden 1', unit_type: 'studio', nightly_rate: '2000' })).data.unit;

  const noKey = await empty.patch('/api/direct-booking', { enabled: true });
  assert.equal(noKey.status, 409);
  assert.equal(noKey.data.code, 'NO_PAYMONGO', 'the PayMongo check still comes first');

  assert.equal((await empty.patch('/api/direct-booking', { paymongo_secret_key: KEY })).status, 200);
  const refused = await empty.patch('/api/direct-booking', { enabled: true });
  assert.equal(refused.status, 409, JSON.stringify(refused.data));
  assert.equal(refused.data.code, 'NO_LISTING');
  assert.equal(refused.data.error, 'Tick at least one listing for your booking page first.');
  const [row] = await sql(`SELECT booking_enabled, booking_slug FROM organizations WHERE name = 'R11 C06 Empty'`);
  assert.equal(row.booking_enabled, false, 'nothing is written on a refusal');
  assert.equal(row.booking_slug, null, 'and no address is assigned');

  await sql('UPDATE units SET bookable_online = true WHERE unit_id = $1', [unit.unit_id]);
  const ok = await empty.patch('/api/direct-booking', { enabled: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));

  await sql('UPDATE units SET bookable_online = false WHERE unit_id = $1', [unit.unit_id]);
  assert.equal((await empty.patch('/api/direct-booking', { enabled: false })).status, 200, 'turning off is never refused');
  assert.equal((await empty.patch('/api/direct-booking', { enabled: false })).status, 200, 'and again, with no listing');
});

test('a manager still cannot change the booking page', async () => {
  const inv = await owner.post('/api/team/invitations', { email: 'r11-c06-mgr@example.com', role: 'manager', property_ids: [propertyId] });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const mgr = client(srv.base);
  const s = await mgr.post('/api/auth/signup', { full_name: 'Manager', email: 'r11-c06-mgr@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  assert.equal((await mgr.patch('/api/direct-booking', { enabled: false })).status, 403);
});
