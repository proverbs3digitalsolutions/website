'use strict';

// QA round 7, lane C01 (audit-settings). Guide, gate pass, guest experience and supply edits write an
// activity row naming only the fields that really changed (never values), and none when nothing changed.
// The Activity screen labels those fields, "Resumed a maintenance schedule" and "Edited a cleaning task".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, ownerAccount, sql } = require('./helpers');

let srv; let owner; let orgId; let prop; let unit; let settings; let dir;
const DOOR = '48291-R7';

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-r7-c01@example.com', 'R7 C01 Co');
  orgId = (await sql('SELECT organization_id FROM users WHERE email = $1', ['owner-r7-c01@example.com']))[0].organization_id;
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  // settings.js is a browser module. Load it from a temp copy, with its browser-only imports stubbed.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r7-c01-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = {}; export async function refreshUser() {}\n');
  fs.writeFileSync(path.join(dir, 'notifications.js'), 'export async function notificationsCard() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'themeswitch.js'), 'export function themeSwitch() { return null; }\n');
  fs.copyFileSync(path.join(__dirname, '../public/js/views/settings.js'), path.join(dir, 'views', 'settings.js'));
  globalThis.Element = class { };
  settings = await import(pathToFileURL(path.join(dir, 'views', 'settings.js')).href);
});
test.after(async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const rows = (action, recordId) => sql(
  'SELECT details FROM audit_logs WHERE organization_id = $1 AND action = $2 AND ($3::text IS NULL OR record_id::text = $3) ORDER BY created_at', [orgId, action, recordId || null]);

test('guide: a save changing only Parking stores that one field; the same save again adds no row', async () => {
  const url = `/api/units/${unit.unit_id}/guide`;
  assert.equal((await owner.raw('PUT', url, { arrival: 'Lift to 12F', parking: 'B2' })).status, 200);
  const before = (await rows('guide.updated', unit.unit_id)).length;
  assert.equal((await owner.raw('PUT', url, { arrival: 'Lift to 12F', parking: 'B3' })).status, 200);
  let all = await rows('guide.updated', unit.unit_id);
  assert.equal(all.length, before + 1);
  assert.deepEqual(all[all.length - 1].details.fields, ['parking']);
  assert.equal((await owner.raw('PUT', url, { arrival: 'Lift to 12F', parking: 'B3' })).status, 200);
  all = await rows('guide.updated', unit.unit_id);
  assert.equal(all.length, before + 1, 'no change, no row');
});

test('guide: a door code save with the same code adds no row, and no row ever holds the code', async () => {
  const url = `/api/units/${unit.unit_id}/guide`;
  assert.equal((await owner.raw('PUT', url, { door_code: DOOR })).status, 200);
  const before = (await rows('guide.updated', unit.unit_id)).length;
  assert.equal((await owner.raw('PUT', url, { door_code: DOOR })).status, 200);
  const all = await rows('guide.updated', unit.unit_id);
  assert.equal(all.length, before, 'same code, no row');
  assert.deepEqual(all[all.length - 1].details.fields, ['door_code']);
  assert.ok(!JSON.stringify(all).includes(DOOR));
});

test('gate pass: changing only the notes stores that one field; the same save adds no row', async () => {
  const url = `/api/properties/${prop.property_id}/gatepass`;
  assert.equal((await owner.patch(url, { admin_email: 'admin@example.com', gatepass_days_before: 1, gatepass_notes: 'Call first' })).status, 200);
  const before = (await rows('property.gatepass_updated', prop.property_id)).length;
  assert.equal((await owner.patch(url, { admin_email: 'admin@example.com', gatepass_days_before: 1, gatepass_notes: 'Ring the bell' })).status, 200);
  let all = await rows('property.gatepass_updated', prop.property_id);
  assert.equal(all.length, before + 1);
  assert.deepEqual(all[all.length - 1].details.fields, ['gatepass_notes']);
  assert.equal((await owner.patch(url, { admin_email: 'admin@example.com', gatepass_days_before: 1, gatepass_notes: 'Ring the bell' })).status, 200);
  all = await rows('property.gatepass_updated', prop.property_id);
  assert.equal(all.length, before + 1, 'no change, no row');
});

test('guest settings: only the changed field is stored, with no values; review links count as one field', async () => {
  const links = [{ label: 'Google', url: 'https://g.page/balay' }];
  assert.equal((await owner.patch('/api/workspace/guest-settings', { returning_guest_pct: 10, abandoned_followup: false, review_links: links })).status, 200);
  const last = async () => { const a = await rows('workspace.guest_settings_updated'); return { n: a.length, d: a[a.length - 1]?.details }; };
  const base = await last();
  assert.equal((await owner.patch('/api/workspace/guest-settings', { returning_guest_pct: 15, abandoned_followup: false, review_links: links })).status, 200);
  let now = await last();
  assert.equal(now.n, base.n + 1);
  assert.deepEqual(now.d, { fields: ['returning_guest_pct'] });
  assert.equal((await owner.patch('/api/workspace/guest-settings', { returning_guest_pct: 15, review_links: links })).status, 200);
  assert.equal((await last()).n, base.n + 1, 'no change, no row');
  assert.equal((await owner.patch('/api/workspace/guest-settings', { review_links: [{ label: 'Google', url: 'https://g.page/balay2' }] })).status, 200);
  now = await last();
  assert.equal(now.n, base.n + 2);
  assert.deepEqual(now.d, { fields: ['review_links'] });
});

test('supply: changing only the par level stores that one field; the same save adds no row', async () => {
  const s = (await owner.post('/api/supplies', { property_id: prop.property_id, name: 'Towels', unit_label: 'pcs', par_level: 4 })).data.supply;
  assert.equal((await owner.patch(`/api/supplies/${s.supply_id}`, { name: 'Towels', par_level: 6 })).status, 200);
  let all = await rows('supply.updated', s.supply_id);
  assert.equal(all.length, 1);
  assert.deepEqual(all[0].details, { fields: ['par_level'] });
  assert.equal((await owner.patch(`/api/supplies/${s.supply_id}`, { name: 'Towels', par_level: 6 })).status, 200);
  all = await rows('supply.updated', s.supply_id);
  assert.equal(all.length, 1, 'no change, no row');
});

test('Activity labels: fields read as labels, unknown keys are humanised, and the new verbs exist', () => {
  assert.equal(settings.summarize({ fields: ['review_links'] }), 'Changed: Public review links');
  assert.equal(settings.summarize({ fields: ['some_new_key'] }), 'Changed: Some new key');
  assert.equal(settings.summarize({ fields: ['par_level', 'door_code'] }), 'Changed: Keep at least, Door code');
  assert.equal(settings.ACTIONS['maintenance.schedule_resumed'], 'Resumed a maintenance schedule');
  assert.equal(settings.ACTIONS['cleaning.task_updated'], 'Edited a cleaning task');
});

test('unit and property rows: changed-field lists read as labels, and old before/after rows still render', () => {
  assert.equal(settings.summarize({ fields: ['min_nights', 'city', 'checkin_time'] }), 'Changed: Minimum nights, City, Check-in time');
  assert.equal(settings.summarize({ fields: ['property_name'] }), 'Changed: Property name');
  assert.equal(settings.summarize({ before: { min_nights: 1, city: 'Taguig' }, after: { min_nights: 2, city: 'Taguig' } }), 'Changed: Minimum nights');
});
