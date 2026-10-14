'use strict';

// QA round 12, fix lane C07 (inbox). #14 a template can't be deleted while any automatic message uses it, and an
// automatic message can't point at or be turned on with a deleted template; #15 snoozed conversations leave Upcoming,
// Hosting and Mine; #16 the "all off" line; #17 the language link; #40 a mode click focuses the box; K7 stable order.
const { startServer, ownerAccount, sql, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const view = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js'), 'utf8');

let srv; let owner; let unit; let tpls;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host-r12-c07@example.com', 'Reyes Staycations');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2500' })).data.unit;
  tpls = (await owner.get('/api/message-templates')).data.templates;
});
test.after(async () => { await srv.close(); });

const mkTemplate = async (name) => (await owner.post('/api/message-templates', { name, subject: 's', body: 'b' })).data.template;
const mkAuto = (template_id, name, extra = {}) => owner.post('/api/automations', { name, template_id, trigger_event: 'booking_created', enabled: false, ...extra });

test('#14 a template used by an automatic message that is off cannot be deleted', async () => {
  const t = await mkTemplate('R12 off use');
  assert.equal((await mkAuto(t.template_id, 'R12 off message')).status, 201);
  const r = await owner.post(`/api/message-templates/${t.template_id}/archive`);
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'IN_USE');
  assert.match(r.data.error || r.data.message, /R12 off message/);
});

test('#14 an automatic message cannot be turned on, created or pointed at with a deleted template', async () => {
  const t = await mkTemplate('R12 gone');
  const live = await mkTemplate('R12 live');
  const a = (await mkAuto(live.template_id, 'R12 pointer')).data.automation;
  await sql('UPDATE message_templates SET archived = true WHERE template_id = $1', [t.template_id]);
  // An existing message left pointing at a deleted template.
  await sql('UPDATE automations SET template_id = $1 WHERE automation_id = $2', [t.template_id, a.automation_id]);
  const on = await owner.patch(`/api/automations/${a.automation_id}`, { enabled: true });
  assert.equal(on.status, 409, JSON.stringify(on.data));
  assert.equal(on.data.code, 'TEMPLATE_DELETED');
  assert.equal((await sql('SELECT enabled FROM automations WHERE automation_id = $1', [a.automation_id]))[0].enabled, false);
  const row = (await owner.get('/api/automations')).data.automations.find((x) => x.automation_id === a.automation_id);
  assert.equal(row.template_archived, true);
  // Pointing at a deleted template is a field error, on create and on edit.
  const p = await owner.patch(`/api/automations/${a.automation_id}`, { template_id: t.template_id });
  assert.equal(p.status, 400, JSON.stringify(p.data));
  assert.ok(p.data.fields.template_id);
  assert.equal((await mkAuto(t.template_id, 'R12 new')).status, 400);
  // Choosing a live template and turning it on works.
  assert.equal((await owner.patch(`/api/automations/${a.automation_id}`, { template_id: live.template_id, enabled: true })).status, 200);
  assert.equal((await owner.get('/api/automations')).data.automations.find((x) => x.automation_id === a.automation_id).template_archived, false);
});

test('#15 a conversation snoozed for 3 hours is not in Upcoming, Hosting or Mine', async () => {
  const checkIn = ical.addDays(manilaToday(), 3);
  const res = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: checkIn, check_out: ical.addDays(checkIn, 2), guest_name: 'Snooze Guest' })).data.reservation;
  const conv = (await owner.post(`/api/reservations/${res.booking_id}/conversation`)).data.conversation_id;
  const me = (await sql('SELECT user_id FROM users WHERE email = $1', ['host-r12-c07@example.com']))[0].user_id;
  await owner.patch(`/api/inbox/${conv}`, { assigned_to: me });
  const ids = async (v) => (await owner.get(`/api/inbox?view=${v}`)).data.conversations.map((c) => c.conversation_id);
  assert.ok((await ids('upcoming')).includes(conv));
  assert.ok((await ids('mine')).includes(conv));
  await owner.patch(`/api/inbox/${conv}`, { snoozed_until: new Date(Date.now() + 3 * 3600e3).toISOString() });
  for (const v of ['upcoming', 'hosting', 'mine']) assert.ok(!(await ids(v)).includes(conv), v);
  assert.ok((await ids('snoozed')).includes(conv));
});

test('K7 automatic messages with the same created_at come back in stay order, the same each time', async () => {
  const t = tpls[0].template_id;
  const mk = async (name, trigger_event) => (await mkAuto(t, name, { trigger_event, offset_days: 1 })).data.automation.automation_id;
  const a = await mk('R12 K7 z', 'after_check_out'); const b = await mk('R12 K7 y', 'before_check_in'); const c = await mk('R12 K7 x', 'check_in_day');
  await sql('UPDATE automations SET created_at = $1 WHERE automation_id = ANY($2)', ['2031-01-01T00:00:00Z', [a, b, c]]);
  const order = async () => (await owner.get('/api/automations')).data.automations.filter((x) => [a, b, c].includes(x.automation_id)).map((x) => x.automation_id);
  assert.deepEqual(await order(), [b, c, a]);
  assert.deepEqual(await order(), [b, c, a]);
});

test('#16 #17 #40 source: the all-off line, the language link, the mode click focuses the message box', () => {
  assert.match(view, /These automatic messages are ready but off\. Check each one's wording, then turn on the ones you want\./);
  assert.match(view, /automations\.every\(\(a\) => !a\.enabled\)/);
  assert.match(view, /Guest messages are in English or Taglish\. Change it in ', h\('a', \{ href: '#\/settings' \}, 'Settings, Language for guests'\)/);
  assert.match(view, /href: '#\/settings'/);
  assert.match(view, /onclick: \(\) => \{ setMode\(k\); body\.focus\(\); \}/);
  assert.match(view, /Template deleted, choose another/);
  assert.match(view, /apiFilters\(filters/);
  assert.doesNotMatch(view, /get\(`\/inbox\$\{qs\(changed\(/);
});
