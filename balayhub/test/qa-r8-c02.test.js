'use strict';

// QA round 8, lane C02 (workspace-audit).
// #59: a workspace save that changes nothing writes no activity row (and no update); a changed field is named, never its value.
// #60: a booking-page save names only what changed, and the PayMongo key is named, never shown.
// #63: an instructions-only manual-payment save is recorded as "instructions", not as "enabled".
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_01 node --test --test-concurrency=1 test/qa-r8-c02.test.js

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, sql } = require('./helpers');

const INSTR = 'GCash 0917 123 4567 (Maria Santos)';
const KEY = 'sk_test_c02auditKEY1234';

let srv; let owner; let orgId;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'c02@example.com', 'Audit C02 Workspace');
  orgId = (await sql('SELECT organization_id FROM users WHERE email = $1', ['c02@example.com']))[0].organization_id;
});
test.after(async () => { await srv.close(); });

// Audit rows of one action for this workspace, oldest first.
const rowsFor = (action) => sql('SELECT details FROM audit_logs WHERE organization_id = $1 AND action = $2 ORDER BY audit_id', [orgId, action]);
// The row's version id changes on every UPDATE, even one that writes the same values.
const versionOf = async () => (await sql('SELECT xmin::text AS v FROM organizations WHERE organization_id = $1', [orgId]))[0].v;

test('a workspace save that changes nothing writes no row and no update (#59)', async () => {
  const [cur] = await sql('SELECT name, business_type, guest_language FROM organizations WHERE organization_id = $1', [orgId]);
  const rows = (await rowsFor('workspace.updated')).length;
  const version = await versionOf();
  assert.equal((await owner.patch('/api/workspace', cur)).status, 200);
  assert.equal((await owner.patch('/api/workspace', {})).status, 200);
  assert.equal((await rowsFor('workspace.updated')).length, rows);
  assert.equal(await versionOf(), version, 'no UPDATE ran');
});

test('a workspace save names only the field that changed (#59)', async () => {
  const rows = (await rowsFor('workspace.updated')).length;
  assert.equal((await owner.patch('/api/workspace', { guest_language: 'tl' })).status, 200);
  const after = await rowsFor('workspace.updated');
  assert.equal(after.length, rows + 1);
  assert.deepEqual(after.at(-1).details, { fields: ['guest_language'] });

  assert.equal((await owner.patch('/api/workspace', { guest_language: 'tl' })).status, 200);
  assert.equal((await rowsFor('workspace.updated')).length, rows + 1, 'the same value again adds no row');
});

test('a booking-page save names only what changed, and the PayMongo key never appears (#60)', async () => {
  const start = (await rowsFor('direct_booking.settings_changed')).length;
  assert.equal((await owner.patch('/api/direct-booking', { intro: 'Welcome to Balay' })).status, 200);
  let rows = await rowsFor('direct_booking.settings_changed');
  assert.equal(rows.length, start + 1);
  assert.deepEqual(rows.at(-1).details, { fields: ['intro'] });

  // The same welcome text again, an empty save, and "off" while it is already off: no row.
  assert.equal((await owner.patch('/api/direct-booking', { intro: 'Welcome to Balay' })).status, 200);
  assert.equal((await owner.patch('/api/direct-booking', {})).status, 200);
  assert.equal((await owner.patch('/api/direct-booking', { enabled: false })).status, 200);
  assert.equal((await rowsFor('direct_booking.settings_changed')).length, start + 1);

  // Connecting a key is named as the key, and the key (or its shown hint) is not written anywhere in the row.
  assert.equal((await owner.patch('/api/direct-booking', { paymongo_secret_key: KEY })).status, 200);
  rows = await rowsFor('direct_booking.settings_changed');
  assert.deepEqual(rows.at(-1).details, { fields: ['paymongo_key'] });
  const text = JSON.stringify(rows.at(-1).details);
  assert.ok(!text.includes('c02auditKEY') && !text.includes('1234') && !text.includes('sk_'), text);

  // Turning the page on needs a bookable listing first (C06, K4).
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Paris 1208', unit_type: 'studio', nightly_rate: '2500', bookable_online: true });

  // Turning the page on names the switch (and the address it creates, since there was none yet).
  assert.equal((await owner.patch('/api/direct-booking', { enabled: true })).status, 200);
  rows = await rowsFor('direct_booking.settings_changed');
  assert.deepEqual([...rows.at(-1).details.fields].sort(), ['enabled', 'slug']);

  // Disconnecting names the key once; disconnecting again changes nothing.
  assert.equal((await owner.patch('/api/direct-booking', { disconnect_paymongo: true })).status, 200);
  assert.deepEqual((await rowsFor('direct_booking.settings_changed')).at(-1).details, { fields: ['paymongo_key'] });
  const count = (await rowsFor('direct_booking.settings_changed')).length;
  assert.equal((await owner.patch('/api/direct-booking', { disconnect_paymongo: true })).status, 200);
  assert.equal((await rowsFor('direct_booking.settings_changed')).length, count);
});

test('an instructions-only manual-payment save is recorded as instructions (#63)', async () => {
  assert.equal((await owner.patch('/api/workspace/manual-payments', { enabled: true, instructions: INSTR })).status, 200);
  const rows = (await rowsFor('workspace.manual_payments_updated')).length;

  assert.equal((await owner.patch('/api/workspace/manual-payments', { instructions: `${INSTR} (BPI)` })).status, 200);
  const after = await rowsFor('workspace.manual_payments_updated');
  assert.equal(after.length, rows + 1);
  assert.deepEqual(after.at(-1).details, { fields: ['instructions'] });

  assert.equal((await owner.patch('/api/workspace/manual-payments', { enabled: false })).status, 200);
  assert.deepEqual((await rowsFor('workspace.manual_payments_updated')).at(-1).details, { fields: ['enabled'] });
});
