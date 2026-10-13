'use strict';

// Workspace-wide guest-messaging settings (discount codes, message templates)
// are owner-only. Managers may be limited to some properties, so they can read
// and use these but not change them (founder decision 2026-10-13).

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Owner Only <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

let srv; let owner; let mgr; let res; let tpl; let codeId;
const d = (n) => ical.addDays(manilaToday(), n);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Owner Only Stays');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  res = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(3), check_out: d(5), guest_name: 'Rafael Diaz', guest_email: 'rafael@example.com' })).data.reservation;

  const inv = await owner.post('/api/team/invitations', { email: 'mgr@example.com', role: 'manager', property_ids: [prop.property_id] });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  mgr = client(srv.base);
  const s = await mgr.post('/api/auth/signup', { full_name: 'Manager', email: 'mgr@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));

  tpl = (await owner.get('/api/message-templates')).data.templates.find((t) => t.system_key === 'confirmation');
  const c = await owner.post('/api/discount-codes', { code: 'BALIK10', percent_off: 10 });
  assert.equal(c.status, 201);
  codeId = c.data.code_id;
});
test.after(async () => { await srv.close(); });

test('manager can read discount codes but not create or switch them; owner can', async () => {
  const list = await mgr.get('/api/discount-codes');
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.codes.map((c) => c.code), ['BALIK10']);

  assert.equal((await mgr.post('/api/discount-codes', { code: 'MGR10', percent_off: 10 })).status, 403);
  assert.equal((await mgr.post(`/api/discount-codes/${codeId}/active`, { active: false })).status, 403);

  assert.equal((await owner.post('/api/discount-codes', { code: 'OWNER5', percent_off: 5 })).status, 201);
  assert.equal((await owner.post(`/api/discount-codes/${codeId}/active`, { active: false })).status, 200);
  const after = (await owner.get('/api/discount-codes')).data.codes;
  assert.deepEqual(after.map((c) => c.code).sort(), ['BALIK10', 'OWNER5'], 'manager attempt created nothing');
  assert.equal(after.find((c) => c.code === 'BALIK10').active, false);
});

test('manager can read and use templates but not change them; owner can', async () => {
  const list = await mgr.get('/api/message-templates');
  assert.equal(list.status, 200);
  assert.ok(list.data.templates.length > 0);

  // Using a template when messaging a guest still works.
  const r = await mgr.get(`/api/message-templates/${tpl.template_id}/render?booking_id=${res.booking_id}`);
  assert.equal(r.status, 200);
  assert.match(r.data.body, /Rafael/);
  const conv = await mgr.post(`/api/reservations/${res.booking_id}/conversation`);
  assert.equal(conv.status, 200);
  const sent = await mgr.post(`/api/inbox/${conv.data.conversation_id}/messages`, { subject: r.data.subject, body: r.data.body });
  assert.ok(sent.status >= 200 && sent.status < 300, JSON.stringify(sent.data));

  // Changing templates is owner-only.
  assert.equal((await mgr.post('/api/message-templates/language', { language: 'tl' })).status, 403);
  assert.equal((await mgr.post('/api/message-templates', { name: 'Mgr', subject: 'Hi', body: 'Hello' })).status, 403);
  assert.equal((await mgr.patch(`/api/message-templates/${tpl.template_id}`, { name: 'Hijack' })).status, 403);
  assert.equal((await mgr.post(`/api/message-templates/${tpl.template_id}/archive`)).status, 403);
  const unchanged = (await owner.get('/api/message-templates')).data.templates;
  assert.ok(unchanged.some((t) => t.template_id === tpl.template_id && t.name === tpl.name), 'manager attempts changed nothing');
  assert.ok(!unchanged.some((t) => t.name === 'Mgr'));

  // The owner can do all of it.
  const created = await owner.post('/api/message-templates', { name: 'Owner note', subject: 'Hi', body: 'Hello {{guest_first_name}}' });
  assert.equal(created.status, 201);
  assert.equal((await owner.patch(`/api/message-templates/${created.data.template.template_id}`, { name: 'Owner note 2' })).status, 200);
  assert.equal((await owner.post(`/api/message-templates/${created.data.template.template_id}/archive`)).status, 200);
  assert.equal((await owner.post('/api/message-templates/language', { language: 'tl' })).status, 200);
});
