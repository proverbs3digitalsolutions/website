'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

// QA round 12, lane C12. K11: staff never get the building admin email or the gate pass settings on a property;
// owners and managers keep them. Cleaners stay blocked.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_06 node --test --test-concurrency=1 test/qa-r12-c12.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');

const KEYS = ['admin_email', 'gatepass_enabled', 'gatepass_days_before', 'gatepass_attach_ids', 'gatepass_authorized_by', 'gatepass_notes'];
let srv; let owner; let prop; const who = {};

async function invite(role, email) {
  const inv = await owner.post('/api/team/invitations', { email, role: role === 'cleaner' ? 'staff' : role, property_ids: [prop.property_id] });
  const c = client(srv.base);
  const r = await c.post('/api/auth/signup', { full_name: role, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  if (role === 'cleaner') await sql(`UPDATE users SET role = 'cleaner' WHERE email = $1`, [email]);
  return c;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qar12c12@example.com', 'QA R12 C12');
  prop = (await owner.post('/api/properties', { property_name: 'Gate Court', property_type: 'apartment', address: '1 Gate St', city: 'Quezon City', province: 'Metro Manila' })).data.property;
  await sql(`UPDATE properties SET admin_email = 'admin@gate.example', gatepass_enabled = true, gatepass_authorized_by = 'Mr Admin', gatepass_notes = 'Gate 2' WHERE property_id = $1`, [prop.property_id]);
  who.staff = await invite('staff', 'qar12c12-staff@example.com');
  who.manager = await invite('manager', 'qar12c12-manager@example.com');
  who.cleaner = await invite('cleaner', 'qar12c12-cleaner@example.com');
});
test.after(async () => { await srv.close(); });

const has = (p) => KEYS.filter((k) => k in p);

test('staff get none of the six admin and gate pass keys on the property or the list', async () => {
  const one = await who.staff.get(`/api/properties/${prop.property_id}`);
  assert.equal(one.status, 200);
  assert.deepEqual(has(one.data.property), []);
  assert.ok(Array.isArray(one.data.units));
  const list = await who.staff.get('/api/properties');
  assert.equal(list.status, 200);
  const row = list.data.properties.find((p) => p.property_id === prop.property_id);
  assert.ok(row);
  assert.deepEqual(has(row), []);
});

test('owner and manager keep all six keys, with the stored values', async () => {
  for (const c of [owner, who.manager]) {
    const one = await c.get(`/api/properties/${prop.property_id}`);
    assert.deepEqual(has(one.data.property), KEYS);
    assert.equal(one.data.property.admin_email, 'admin@gate.example');
    const row = (await c.get('/api/properties')).data.properties.find((p) => p.property_id === prop.property_id);
    assert.deepEqual(has(row), KEYS);
  }
});

test('a cleaner never gets the keys', async () => {
  const one = await who.cleaner.get(`/api/properties/${prop.property_id}`);
  if (one.status === 200) assert.deepEqual(has(one.data.property), []);
  else assert.ok([401, 403, 404].includes(one.status), String(one.status));
});
