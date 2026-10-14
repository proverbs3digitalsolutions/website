'use strict';

// QA round 5, lane C07. #8 (O-i): a guest's add-on list shows each name once, using the oldest active copy
// (the copies came from runs before the name rule). #14: "Most a guest can add" of 0 is refused, not saved as 1.
process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
// helpers sets DATABASE_URL from TEST_DATABASE_URL; load it before anything that opens the pool.
const { startServer, ownerAccount, sql, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const addons = require('../src/lib/addons');
const { pool } = require('../src/db');

const d = (n) => ical.addDays(manilaToday(), n);

let srv; let owner; let unit; let orgId;
const ids = {};

// The guest lists: the booking page and the before-arrival page both call listAddonsForUnit.
const shown = (context, bookingId = null) => addons.listAddonsForUnit(pool, orgId, unit.unit_id, context, bookingId);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'addon-guest@example.com', 'Guest Addon Stays');
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Guest Addon Stays'`))[0].organization_id;
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500', max_guests: 4 })).data.unit;

  // Copies left by runs before the name rule. The API refuses these now, so they are written straight to the database
  // with set creation times. The copy at A2 differs only in case and spaces. A0 is the oldest of all, but archived.
  const copy = async (key, name, hoursAgo, active = true) => {
    const [row] = await sql(
      `INSERT INTO listing_addons (organization_id, name, price, pricing, max_quantity, active, created_at)
       VALUES ($1, $2, 1500, 'per_stay', 1, $3, now() - make_interval(hours => $4::int)) RETURNING addon_id`,
      [orgId, name, active, hoursAgo]);
    ids[key] = row.addon_id;
  };
  await copy('A0', 'Airport pickup', 4, false);
  await copy('A1', 'Airport pickup', 3);
  await copy('A2', '  airport PICKUP ', 2);
  await copy('A3', 'Airport pickup', 1);
  ids.B = (await owner.post('/api/addons', { name: 'Breakfast for two', price: '600', pricing: 'per_stay', max_quantity: 2 })).data.addon.addon_id;
});
test.after(async () => { await srv.close(); });

test('#8 the owner catalogue still lists every copy, so the extra ones can be archived', async () => {
  const { addons: all } = (await owner.get('/api/addons')).data;
  assert.equal(all.filter((a) => a.name.trim().toLowerCase() === 'airport pickup').length, 4);
});

test('#8 the booking and before-arrival lists show each name once, using the oldest active copy', async () => {
  for (const context of ['booking', 'before_arrival']) {
    const rows = await shown(context);
    assert.deepEqual(rows.map((r) => r.name), ['Airport pickup', 'Breakfast for two'], context);
    assert.equal(rows[0].addon_id, ids.A1, `${context} shows the oldest active copy, not the archived one`);
  }
});

test('#8 a copy bought on a stay counts against the copy shown, because the count is by name', async () => {
  const r = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(20), check_out: d(22), guest_name: 'Ana Cruz', guest_email: 'ana@example.com', num_guests: 2 })).data.reservation;
  // The newest copy (A3, maximum one) is bought; the copy shown (A1) must report that its one place is taken.
  const { items } = await addons.priceAddons(pool, { orgId, unitId: unit.unit_id, nights: 2, guests: 2, selections: [{ addon_id: ids.A3, quantity: 1 }], context: 'booking' });
  await addons.createAddonCharges(pool, r.booking_id, items, null);
  const [first] = await shown('before_arrival', r.booking_id);
  assert.equal(first.addon_id, ids.A1);
  assert.equal(first.bought, 1, 'the newer copy\'s purchase counts');
  assert.equal(first.left, 0, 'so the copy shown has nothing left');
});

test('#8 archiving the copy shown brings up the next copy, and an archived copy never shows', async () => {
  assert.equal((await owner.post(`/api/addons/${ids.A1}/archive`)).status, 200);
  assert.equal((await shown('booking'))[0].addon_id, ids.A2);
  assert.equal((await owner.post(`/api/addons/${ids.A2}/archive`)).status, 200);
  const after = await shown('booking');
  assert.equal(after[0].addon_id, ids.A3);
  assert.deepEqual(after.map((r) => r.name), ['Airport pickup', 'Breakfast for two']);
});

test('#14 a maximum of 0 is refused at its field, and nothing is saved', async () => {
  for (const max_quantity of [0, '0']) {
    const r = await owner.post('/api/addons', { name: 'Extra pillow', price: '100', pricing: 'per_stay', max_quantity });
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.deepEqual(Object.keys(r.data.fields), ['max_quantity']);
    assert.equal(r.data.fields.max_quantity, 'Maximum quantity must be at least 1.');
  }
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM listing_addons WHERE organization_id = $1 AND name = 'Extra pillow'`, [orgId]))[0].n, 0);
});

test('#14 the add-on form sends the maximum as typed; only a blank box means the default of one', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'addons.js'), 'utf8');
  // The old `Number(...) || 1` turned a typed 0 into 1 with no message.
  assert.doesNotMatch(src, /Number\(d\.max_quantity\)/, 'a typed 0 must not become 1 in the browser');
  assert.match(src, /max_quantity:\s*d\.max_quantity\.trim\(\) \|\| 1/, 'the typed value is sent; a blank box means one');
});
