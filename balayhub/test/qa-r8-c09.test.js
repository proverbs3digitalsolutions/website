'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Reyes Staycations <host@example.com>';

// QA round 8, inbox lane (C09): N33 a template save that changes nothing writes no row, and a changed field is logged by
// name; K21 an `assigned` id this workspace does not have is ignored, as a bad id is; N7 automations that share a
// created_at come back in one fixed order (by id); #11 the composer's Message guest / Internal note switch is two toggle
// buttons with aria-pressed, not a tab list (source scan); D-81 the scheduled-message Cancel, failed-message Retry and
// long-message Show more links name their message (source scan).

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
const OWNER_EMAIL = 'host-r8-c09@example.com';
const OTHER_EMAIL = 'other-r8-c09@example.com';

let srv; let owner; let conv; let tplId; let ownerId; let otherId;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, OWNER_EMAIL, 'Reyes Staycations');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const res = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(2), check_out: d(4), guest_name: 'Ana Cruz', guest_email: 'ana@example.com' })).data.reservation;
  conv = (await owner.post(`/api/reservations/${res.booking_id}/conversation`)).data.conversation_id;
  tplId = (await owner.get('/api/message-templates')).data.templates[0].template_id;
  ownerId = (await sql('SELECT user_id FROM users WHERE email = $1', [OWNER_EMAIL]))[0].user_id;
  await ownerAccount(srv.base, OTHER_EMAIL, 'Other Co');
  otherId = (await sql('SELECT user_id FROM users WHERE email = $1', [OTHER_EMAIL]))[0].user_id;
});
test.after(async () => { await srv.close(); });

test('N33 a template save that changes nothing writes no row; a changed subject is logged by name', async () => {
  const made = await owner.post('/api/message-templates', { name: 'Round 8 note', subject: 'Welcome', body: 'Hello there' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.template.template_id;
  const rows = () => sql(`SELECT details FROM audit_logs WHERE action = 'template.updated' AND record_id = $1 ORDER BY created_at`, [id]);

  assert.equal((await owner.patch(`/api/message-templates/${id}`, { name: 'Round 8 note', subject: 'Welcome', body: 'Hello there' })).status, 200);
  assert.equal((await rows()).length, 0, 'the same text writes no row');

  assert.equal((await owner.patch(`/api/message-templates/${id}`, { subject: 'Welcome back' })).status, 200);
  assert.deepEqual((await rows()).map((r) => r.details), [{ fields: ['subject'], name: 'Round 8 note' }]);
  assert.equal((await owner.patch(`/api/message-templates/${id}`, { subject: 'Welcome back' })).status, 200);
  assert.equal((await rows()).length, 1, 'saving the same subject again adds no row');
  assert.equal((await sql('SELECT subject FROM message_templates WHERE template_id = $1', [id]))[0].subject, 'Welcome back');
});

test('K21 an assigned id this workspace does not have is ignored, and a real assignee still filters', async () => {
  const all = ids((await owner.get('/api/inbox')).data.conversations);
  assert.deepEqual(all, [conv]);
  for (const q of [`assigned=${UNKNOWN}`, `assigned=${otherId}`]) {
    const r = await owner.get(`/api/inbox?${q}`);
    assert.equal(r.status, 200, q);
    assert.deepEqual(ids(r.data.conversations), all, `${q} changes nothing`);
  }
  assert.equal((await owner.patch(`/api/inbox/${conv}`, { assigned_to: ownerId })).status, 200);
  assert.deepEqual(ids((await owner.get(`/api/inbox?assigned=${ownerId}`)).data.conversations), [conv]);
  assert.deepEqual(ids((await owner.get('/api/inbox?assigned=unassigned')).data.conversations), []);
});

test('N7 automations that share a created_at come back in one fixed order, by id', async () => {
  const orgId = (await sql('SELECT organization_id FROM users WHERE user_id = $1', [ownerId]))[0].organization_id;
  // Inserted out of id order, all with one created_at: the list must order them by id, not by insertion.
  const tied = ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
  for (const [i, id] of tied.entries()) {
    await sql(`INSERT INTO automations (automation_id, organization_id, template_id, name, trigger_event, offset_days, send_time, enabled)
               VALUES ($1, $2, $3, $4, 'before_check_in', 1, '10:00', false)`, [id, orgId, tplId, `Tie ${i}`]);
  }
  await sql('UPDATE automations SET created_at = $1 WHERE organization_id = $2', ['2026-01-01T00:00:00Z', orgId]);
  const listed = (await owner.get('/api/automations')).data.automations.map((a) => a.automation_id).filter((id) => tied.includes(id));
  assert.deepEqual(listed, [...tied].sort());
});

test('#11 the Message guest and Internal note switch is two toggle buttons, not a tab list (source scan)', () => {
  assert.doesNotMatch(src, /role: 'tab(list)?'/, 'no tab or tablist roles in the view');
  assert.match(src, /const modeTabs = h\('div', \{ class: 'tabs tabs--compact' \},/);
  assert.match(src, /type: 'button', 'aria-pressed': String\(k === mode\),/);
  assert.match(src, /\[\.\.\.modeTabs\.children\]\.forEach\(\(b, i\) => b\.setAttribute\('aria-pressed', String\(i === \(k === 'note' \? 1 : 0\)\)\)\);/);
});

test('D-81 the Cancel, Retry and Show more links name their message, not just their verb (source scan)', () => {
  assert.match(src, /'aria-label': `Cancel the message scheduled for \$\{fmtDateTime\(m\.scheduled_at\)\}`/);
  assert.match(src, /'aria-label': `Retry sending the message from \$\{fmtDateTime\(m\.created_at\)\}`/);
  assert.match(src, /toggle\.setAttribute\('aria-label', `\$\{toggle\.textContent\} of the message from \$\{fmtDateTime\(m\.sent_at \|\| m\.created_at\)\}`\);/);
});
