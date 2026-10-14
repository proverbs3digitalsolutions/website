'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
// helpers sets DATABASE_URL from TEST_DATABASE_URL; load it before anything that opens the pool.
const { startServer, ownerAccount, sql } = require('./helpers');

let srv; let owner; let u1; let u2; let addonId;

// The edit rows written for this add-on, oldest first.
const edits = () => sql(`SELECT details FROM audit_logs WHERE action = 'addon.updated' AND record_id = $1 ORDER BY created_at`, [addonId]);
const updatedAt = async () => (await sql('SELECT updated_at FROM listing_addons WHERE addon_id = $1', [addonId]))[0].updated_at.getTime();

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Addon Audit');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  u1 = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', max_guests: 4 })).data.unit;
  u2 = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1202', unit_type: 'studio', nightly_rate: '1500', max_guests: 4 })).data.unit;
  const made = await owner.post('/api/addons', { name: 'Cooler', price: '500', pricing: 'per_stay', description: 'Fits a 2-bed', max_quantity: 2, unit_ids: [u1.unit_id, u2.unit_id] });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  addonId = made.data.addon.addon_id;
});
test.after(async () => { await srv.close(); });

test('a save that changes nothing writes no row and no update, even with the listings in another order', async () => {
  const before = await updatedAt();
  const res = await owner.patch(`/api/addons/${addonId}`, {
    name: 'Cooler', name_tl: '', description: 'Fits a 2-bed', price: '500', pricing: 'per_stay', max_quantity: 2,
    unit_ids: [u2.unit_id, u1.unit_id], on_booking_page: true, before_arrival: true, active: true,
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.addon.price, '500.00');
  assert.deepEqual(res.data.addon.unit_ids, [u1.unit_id, u2.unit_id], 'the stored order is kept');
  assert.deepEqual(await edits(), []);
  assert.equal(await updatedAt(), before, 'no update was written');
});

test('a price change records the field name and the add-on name, never the amount', async () => {
  const res = await owner.patch(`/api/addons/${addonId}`, { price: '650' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.addon.price, '650.00');
  const rows = await edits();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].details, { fields: ['price'], name: 'Cooler' });
});

test('saving the same price again writes nothing more', async () => {
  assert.equal((await owner.patch(`/api/addons/${addonId}`, { price: '650.00' })).status, 200);
  assert.equal((await edits()).length, 1);
});

test('dropping a listing is a real change and names only the field', async () => {
  const res = await owner.patch(`/api/addons/${addonId}`, { unit_ids: [u1.unit_id] });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const rows = await edits();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].details, { fields: ['unit_ids'], name: 'Cooler' });
});

test('an empty save writes no row and no update', async () => {
  const before = await updatedAt();
  assert.equal((await owner.patch(`/api/addons/${addonId}`, {})).status, 200);
  assert.equal((await edits()).length, 2);
  assert.equal(await updatedAt(), before);
});
