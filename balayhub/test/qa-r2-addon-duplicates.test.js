'use strict';

// QA round 2, lane R2 addon duplicates: a stay's add-on maximum counts purchases by add-on name, so a second
// active copy of the same add-on can't be bought for a stay that already has one (guest#1). The catalogue refuses
// a second active add-on with the same name (case-insensitive, trimmed); archived ones don't count.
process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);
let srv; let owner; let orgId; let token; let booking;
let airportA; let airportB; let bedA; let bedB;

const buy = (id, quantity = 1) => client(srv.base).post(`/api/public/pay/${token}/addons`, { selections: [{ addon_id: id, quantity }] });
const listed = async () => (await client(srv.base).get(`/api/public/pay/${token}/addons`)).data.addons;
const byId = (list, id) => list.find((a) => a.addon_id === id);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'r2-addon-dupes@example.com', 'R2 Dupe Addon Stays');
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'R2 Dupe Addon Stays'`))[0].organization_id;
  const p = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const unit = (await owner.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;

  // Duplicates saved before the name check existed: written straight to the database, since the API now refuses them.
  const insert = async (name, price) => (await sql(
    `INSERT INTO listing_addons (organization_id, name, price, pricing, max_quantity) VALUES ($1, $2, $3, 'per_stay', 1) RETURNING addon_id`,
    [orgId, name, price]))[0].addon_id;
  airportA = await insert('Airport pickup', 1500);
  airportB = await insert('Airport pickup', 1500);
  bedA = (await owner.post('/api/addons', { name: 'Extra bed', price: '500', pricing: 'per_stay' })).data.addon.addon_id;
  bedB = await insert('  EXTRA bed ', 500);

  booking = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(10), check_out: d(12), guest_name: 'Ana Cruz', guest_email: 'ana@example.com', num_guests: 2 })).data.reservation;
  await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890' });
  token = (await owner.get(`/api/reservations/${booking.booking_id}/payment-link`)).data.link.split('/#/pay/')[1];
});
test.after(async () => { await srv.close(); });

test('a second active copy of an add-on is refused for a stay that already has the first: 409, and both copies show left 0', async () => {
  assert.equal((await buy(airportA)).status, 200);
  const second = await buy(airportB);
  assert.equal(second.status, 409, JSON.stringify(second.data));
  assert.equal(second.data.code, 'ADDON_LIMIT');
  assert.equal(second.data.fields.addons, 'Airport pickup is already on your bill.');
  const lines = (await sql(`SELECT COUNT(*)::int AS n FROM booking_charges WHERE booking_id = $1 AND addon_id IS NOT NULL AND voided_at IS NULL`, [booking.booking_id]))[0].n;
  assert.equal(lines, 1, 'the refused copy adds no bill line');

  const list = await listed();
  for (const id of [airportA, airportB]) {
    assert.equal(byId(list, id).bought, 1);
    assert.equal(byId(list, id).left, 0);
  }
});

test('the count is by name, ignoring case and spaces at the ends', async () => {
  assert.equal((await buy(bedA)).status, 200);
  const second = await buy(bedB);
  assert.equal(second.status, 409, JSON.stringify(second.data));
  assert.equal(second.data.code, 'ADDON_LIMIT');
  const list = await listed();
  assert.equal(byId(list, bedA).left, 0);
  assert.equal(byId(list, bedB).left, 0);
});

test('creating an add-on whose name matches an active one is refused, and the message names the one on file', async () => {
  const dupe = await owner.post('/api/addons', { name: '  airport PICKUP ', price: '900', pricing: 'per_stay' });
  assert.equal(dupe.status, 409, JSON.stringify(dupe.data));
  assert.equal(dupe.data.code, 'DUPLICATE');
  assert.deepEqual(dupe.data.fields, { name: 'You already have an add-on called Airport pickup.' });
  const rows = await sql(`SELECT COUNT(*)::int AS n FROM listing_addons WHERE organization_id = $1 AND lower(btrim(name)) = 'airport pickup'`, [orgId]);
  assert.equal(rows[0].n, 2, 'nothing is saved and the existing rows are left alone');
});

test('renaming an add-on onto an active name is refused, and its name is unchanged', async () => {
  const cooler = (await owner.post('/api/addons', { name: 'Cooler', price: '33.33', pricing: 'per_guest' })).data.addon;
  const clash = await owner.patch(`/api/addons/${cooler.addon_id}`, { name: 'airport pickup' });
  assert.equal(clash.status, 409, JSON.stringify(clash.data));
  assert.deepEqual(clash.data.fields, { name: 'You already have an add-on called Airport pickup.' });
  const after = (await owner.get('/api/addons')).data.addons.find((a) => a.addon_id === cooler.addon_id);
  assert.equal(after.name, 'Cooler');
});

test('a new add-on may take the name of an archived one', async () => {
  const old = (await owner.post('/api/addons', { name: 'Late checkout', price: '400', pricing: 'per_stay' })).data.addon;
  assert.equal((await owner.post(`/api/addons/${old.addon_id}/archive`)).status, 200);
  const fresh = await owner.post('/api/addons', { name: 'late checkout', price: '400', pricing: 'per_stay' });
  assert.equal(fresh.status, 201, JSON.stringify(fresh.data));
});
