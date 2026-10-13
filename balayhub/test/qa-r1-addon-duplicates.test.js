'use strict';

// QA round 1, lane L27: #82 an add-on can't share a name with another ACTIVE add-on in the same
// workspace (case-insensitive, trimmed). Archived add-ons don't count.
process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, sql } = require('./helpers');

let srv; let owner; let orgId;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'addon-dupes@example.com', 'Dupe Addon Stays');
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Dupe Addon Stays'`))[0].organization_id;
});
test.after(async () => { await srv.close(); });

const add = (body) => owner.post('/api/addons', { price: '500', pricing: 'per_stay', ...body });
const named = async (name) => (await owner.get('/api/addons')).data.addons.filter((a) => a.name.trim().toLowerCase() === name.trim().toLowerCase());

test('#82 a second active add-on with the same name is refused, and nothing is saved', async () => {
  assert.equal((await add({ name: 'Airport pickup' })).status, 201);
  const dupe = await add({ name: 'Airport pickup', price: '900' });
  assert.equal(dupe.status, 409, JSON.stringify(dupe.data));
  assert.equal(dupe.data.code, 'DUPLICATE');
  assert.deepEqual(Object.keys(dupe.data.fields), ['name']);
  assert.match(dupe.data.fields.name, /active add-on/i);
  assert.equal((await named('Airport pickup')).length, 1);
});

test('#82 the duplicate check ignores case and spaces at the ends', async () => {
  const dupe = await add({ name: '  airport PICKUP ' });
  assert.equal(dupe.status, 409, JSON.stringify(dupe.data));
  assert.deepEqual(Object.keys(dupe.data.fields), ['name']);
  assert.equal((await named('Airport pickup')).length, 1);
});

test('#82 an archived add-on does not block a new one with the same name', async () => {
  const old = (await add({ name: 'Late checkout' })).data.addon;
  assert.equal((await owner.post(`/api/addons/${old.addon_id}/archive`)).status, 200);
  const fresh = await add({ name: 'Late checkout' });
  assert.equal(fresh.status, 201, JSON.stringify(fresh.data));
  assert.equal((await named('Late checkout')).length, 2);

  // Bringing the archived one back would make two active ones, so it is refused.
  const back = await owner.patch(`/api/addons/${old.addon_id}`, { active: true });
  assert.equal(back.status, 409, JSON.stringify(back.data));
  assert.deepEqual(Object.keys(back.data.fields), ['name']);
  assert.equal((await owner.post(`/api/addons/${fresh.data.addon.addon_id}/archive`)).status, 200);
  assert.equal((await owner.patch(`/api/addons/${old.addon_id}`, { active: true })).status, 200, 'once the other is archived it can come back');
});

test('#82 renaming into another active add-on name is refused; keeping or re-casing its own name is fine', async () => {
  const cooler = (await add({ name: 'Cooler' })).data.addon;
  const bed = (await add({ name: 'Extra bed' })).data.addon;

  const clash = await owner.patch(`/api/addons/${bed.addon_id}`, { name: 'cooler' });
  assert.equal(clash.status, 409, JSON.stringify(clash.data));
  assert.deepEqual(Object.keys(clash.data.fields), ['name']);
  assert.equal((await named('Extra bed')).length, 1, 'the refused rename changed nothing');

  const own = await owner.patch(`/api/addons/${cooler.addon_id}`, { name: ' COOLER ', price: '650' });
  assert.equal(own.status, 200, JSON.stringify(own.data));
  assert.equal(own.data.addon.name, 'COOLER');
  assert.equal(own.data.addon.price, '650.00');
});

test('#82 editing other fields is not blocked by an older duplicate that is already saved', async () => {
  const kept = (await add({ name: 'Breakfast for two' })).data.addon;
  // A duplicate row that predates the check, written straight to the database.
  await sql(`INSERT INTO listing_addons (organization_id, name, price, pricing) VALUES ($1, 'Breakfast for two', 120, 'per_stay')`, [orgId]);
  const edit = await owner.patch(`/api/addons/${kept.addon_id}`, { price: '180' });
  assert.equal(edit.status, 200, JSON.stringify(edit.data));
  assert.equal(edit.data.addon.price, '180.00');
});

test('#82 another workspace may use the same add-on name', async () => {
  const other = await ownerAccount(srv.base, 'addon-dupes-two@example.com', 'Second Dupe Stays');
  const r = await other.post('/api/addons', { name: 'Airport pickup', price: '500', pricing: 'per_stay' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
});
