'use strict';

// QA round 6, lane C07 (notify-prefs).
// #9: PATCH /api/account/notify-prefs accepted `property_ids: []`. That saved an empty list, and push.allowed()
// then refuses every property, so the person got no property alerts at all. It now refuses an empty list with
// 400 on `property_ids` and saves nothing. `null` still means every property.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_05 node --test --test-concurrency=1 test/qa-r6-c07.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');

const EMPTY = 'Pick at least one property, or choose all properties.';
const EMAIL = 'c07-owner@example.com';

let srv; let owner; let propA; let propB;
const prefsOf = async () => (await sql('SELECT notify_prefs FROM users WHERE email = $1', [EMAIL]))[0].notify_prefs;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, EMAIL, 'Notify C07');
  const add = async (name, address) => (await owner.post('/api/properties', { property_name: name, property_type: 'condominium', address, city: 'Taguig', province: 'Metro Manila' })).data.property;
  propA = await add('Azure C07', 'Bicutan Ave');
  propB = await add('Birch C07', 'Lower Bicutan Rd');
});
test.after(async () => { await srv.close(); });

test('an empty property list is refused and the saved choice is kept', async () => {
  assert.equal((await owner.patch('/api/account/notify-prefs', { property_ids: [propA.property_id] })).status, 200);
  const before = await prefsOf();
  const r = await owner.patch('/api/account/notify-prefs', { property_ids: [] });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.property_ids, EMPTY);
  assert.deepEqual(await prefsOf(), before, 'nothing is saved');
  assert.deepEqual((await owner.get('/api/account/notify-prefs')).data.property_ids, [propA.property_id]);
});

test('one visible property saves as the only choice', async () => {
  const r = await owner.patch('/api/account/notify-prefs', { property_ids: [propB.property_id] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.property_ids, [propB.property_id]);
  assert.deepEqual((await prefsOf()).property_ids, [propB.property_id]);
});

test('null chooses every property again', async () => {
  const r = await owner.patch('/api/account/notify-prefs', { property_ids: null });
  assert.equal(r.status, 200);
  assert.equal(r.data.property_ids, null);
  assert.equal('property_ids' in (await prefsOf()), false);
});
