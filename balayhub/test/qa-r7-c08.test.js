'use strict';

// QA round 7, lane C08 (properties): unit and property edits write an activity row only for fields that
// really changed (K11, N13), and the Add unit form in a short-term or Both workspace asks for a base
// nightly rate (#19, source scan: properties.js imports the signed-in user from app.js).
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_06 node --test --test-concurrency=1 test/qa-r7-c08.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ownerAccount, sql } = require('./helpers');

const VIEW = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'properties.js'), 'utf8');

let srv; let owner; let prop; let unit;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'properties-r7-08@example.com', 'Properties R7');
  prop = (await owner.post('/api/properties', { property_name: 'Audit Plain', property_type: 'condominium', address: '1 Audit Street', city: 'Makati', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: 'Room A', unit_type: 'room', monthly_rent: '4200.00', checkin_time: '14:00', min_nights: 1,
  })).data.unit;
});
test.after(async () => { await srv.close(); });

const rows = (action, id) => sql(
  `SELECT details FROM audit_logs WHERE action = $1 AND record_id = $2 ORDER BY audit_id`, [action, id]);

test('a unit PATCH that repeats 14:00 and 4200 and changes min_nights logs only min_nights', async () => {
  const r = await owner.patch(`/api/units/${unit.unit_id}`, { checkin_time: '14:00', monthly_rent: 4200, min_nights: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const logged = await rows('unit.updated', unit.unit_id);
  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0].details, { fields: ['min_nights'] });
});

test('the same unit PATCH again writes no activity row', async () => {
  const r = await owner.patch(`/api/units/${unit.unit_id}`, { checkin_time: '14:00', monthly_rent: '4200.00', min_nights: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await rows('unit.updated', unit.unit_id)).length, 1);
});

test('a property PATCH with the same name writes no row; a real change logs only that field', async () => {
  let r = await owner.patch(`/api/properties/${prop.property_id}`, { property_name: 'Audit Plain' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await rows('property.updated', prop.property_id)).length, 0);
  r = await owner.patch(`/api/properties/${prop.property_id}`, { property_name: 'Audit Plain', city: 'Pasig' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const logged = await rows('property.updated', prop.property_id);
  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0].details, { fields: ['city'] });
});

test('the Add unit form asks for a required nightly rate unless the workspace is long-term', () => {
  assert.match(VIEW, /name: 'nightly_rate', label: 'Base nightly rate \(₱\)', type: 'money', required: true/);
  assert.match(VIEW, /business_type !== 'long_term'/);
});
