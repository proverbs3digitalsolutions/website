'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Reyes Staycations <host@example.com>';

// QA round 7, inbox lane (C07): #16 an automation edit logs the fields that changed, by name, and nothing when no value
// changed; #17 a listing or property id this workspace does not have is ignored in the list, as a bad id is, and the
// inbox view drops it before the first load; #15 the Listing option is the unit name, with the property added only when
// two listings share a name (source scan).

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js'), 'utf8');
const d = (n) => ical.addDays(manilaToday(), n);
const ids = (rows) => rows.map((c) => c.conversation_id).sort();
const UNKNOWN = '00000000-0000-0000-0000-000000000000';

let srv; let owner; let unit; let unit2; let prop; let otherUnit; let otherProp; let tplId; let convA; let convB;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Reyes Staycations');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const prop2 = (await owner.post('/api/properties', { property_name: 'Grass', property_type: 'condominium', address: 'Project 8', city: 'Quezon City', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  unit2 = (await owner.post(`/api/properties/${prop2.property_id}/units`, { unit_name: '805', unit_type: 'studio', nightly_rate: '1500' })).data.unit;
  const resA = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(2), check_out: d(4), guest_name: 'Ana Cruz', guest_email: 'ana@example.com' })).data.reservation;
  const resB = (await owner.post('/api/reservations', { unit_id: unit2.unit_id, check_in: d(2), check_out: d(4), guest_name: 'Ben Reyes', guest_email: 'ben@example.com' })).data.reservation;
  convA = (await owner.post(`/api/reservations/${resA.booking_id}/conversation`)).data.conversation_id;
  convB = (await owner.post(`/api/reservations/${resB.booking_id}/conversation`)).data.conversation_id;
  tplId = (await owner.get('/api/message-templates')).data.templates[0].template_id;

  // A second workspace with its own listing: a real id, but not this workspace's.
  const other = await ownerAccount(srv.base, 'other@example.com', 'Other Co');
  otherProp = (await other.post('/api/properties', { property_name: 'Elsewhere', property_type: 'condominium', address: 'Makati Ave', city: 'Makati', province: 'Metro Manila' })).data.property;
  otherUnit = (await other.post(`/api/properties/${otherProp.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '1800' })).data.unit;
});
test.after(async () => { await srv.close(); });

test('#16 an automation edit logs the one field that changed, by name; a save with no change adds no row', async () => {
  const made = await owner.post('/api/automations', { name: 'Days test', template_id: tplId, trigger_event: 'before_check_in', offset_days: 2, send_time: '10:00', enabled: false });
  assert.equal(made.status, 201);
  const id = made.data.automation.automation_id;
  const rows = () => sql(`SELECT details FROM audit_logs WHERE action = 'automation.updated' AND record_id = $1 ORDER BY created_at`, [id]);

  assert.equal((await owner.patch(`/api/automations/${id}`, { offset_days: 5 })).status, 200);
  assert.deepEqual((await rows()).map((r) => r.details), [{ fields: ['offset_days'], name: 'Days test' }]);

  // The same number again, and the stored values sent back (the time comes back with seconds), change nothing.
  assert.equal((await owner.patch(`/api/automations/${id}`, { offset_days: 5 })).status, 200);
  assert.equal((await owner.patch(`/api/automations/${id}`, { name: 'Days test', trigger_event: 'before_check_in', send_time: '10:00', enabled: false })).status, 200);
  assert.equal((await rows()).length, 1);

  assert.equal((await owner.patch(`/api/automations/${id}`, { send_time: '14:30' })).status, 200);
  assert.deepEqual((await rows()).at(-1).details, { fields: ['send_time'], name: 'Days test' });
  const stored = await sql('SELECT offset_days, to_char(send_time, \'HH24:MI\') AS send_time FROM automations WHERE automation_id = $1', [id]);
  assert.deepEqual(stored[0], { offset_days: 5, send_time: '14:30' }, 'the saved values are the ones written');
});

test('#17 a listing or property id this workspace does not have is ignored in the list, as a bad id is', async () => {
  const all = ids((await owner.get('/api/inbox')).data.conversations);
  assert.deepEqual(all, [convA, convB].sort());
  for (const q of [`unit_id=${UNKNOWN}`, `property_id=${UNKNOWN}`, `unit_id=${otherUnit.unit_id}`, `property_id=${otherProp.property_id}`]) {
    const r = await owner.get(`/api/inbox?${q}`);
    assert.equal(r.status, 200, q);
    assert.deepEqual(ids(r.data.conversations), all, q);
  }
  // A listing of this workspace still filters the list.
  assert.deepEqual(ids((await owner.get(`/api/inbox?unit_id=${unit.unit_id}`)).data.conversations), [convA]);
  assert.deepEqual(ids((await owner.get(`/api/inbox?property_id=${prop.property_id}`)).data.conversations), [convA]);
});

test('#15 the Listing option is the unit name, and adds the property only when two listings share a name', () => {
  assert.match(src, /const repeated = new Set\(stUnits\.map\(\(u\) => u\.unit_name\)\.filter\(\(n, i, all\) => all\.indexOf\(n\) !== i\)\);/);
  assert.match(src, /options: stUnits\.map\(\(u\) => \[u\.unit_id, repeated\.has\(u\.unit_name\) \? `\$\{u\.unit_name\} · \$\{u\.property_name \|\| ''\}` : u\.unit_name\]\)/);
});

test('#17 the inbox view drops a listing or property the workspace does not list before the first load', () => {
  const loaded = src.indexOf('const [counts, status, { properties }, { units }');
  const dropUnit = src.indexOf("if (!stUnits.some((u) => u.unit_id === filters.unit_id)) filters.unit_id = '';");
  const dropProperty = src.indexOf("if (!properties.some((p) => p.property_id === filters.property_id)) filters.property_id = '';");
  assert.ok(dropUnit > loaded, 'listing check runs after the lists load');
  assert.ok(dropProperty > loaded, 'property check runs after the lists load');
  assert.ok(dropUnit < src.indexOf('const bar = filterBar({') && dropProperty < src.indexOf('const bar = filterBar({'), 'before the filter bar is built');
});
