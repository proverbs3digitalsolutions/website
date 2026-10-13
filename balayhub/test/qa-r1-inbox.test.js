'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Reyes Staycations <host@example.com>';
process.env.ANTHROPIC_API_KEY = 'test-key';

// QA round 1, inbox lane: #15 send-later reason, #16 unknown template variables, #17 AI error copy, #18 staff mention copy.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.anthropic.com/')) return new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 401, headers: { 'content-type': 'application/json' } });
  return realFetch(url, opts);
};

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

let srv; let owner; let conv;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Reyes Staycations');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2500' })).data.unit;
  const today = manilaToday();
  const res = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: ical.addDays(today, 2), check_out: ical.addDays(today, 4), guest_name: 'Rafael Diaz', guest_email: 'rafael@example.com' })).data.reservation;
  conv = (await owner.post(`/api/reservations/${res.booking_id}/conversation`)).data.conversation_id;
  const inv = await owner.post('/api/team/invitations', { email: 'staff@example.com', role: 'staff', property_ids: [prop.property_id] });
  await client(srv.base).post('/api/auth/signup', { full_name: 'Sam Tan', email: 'staff@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
});
test.after(async () => { await srv.close(); });

test('#16 templates with unknown {{variables}} are refused, naming them', async () => {
  const bad = await owner.post('/api/message-templates', { name: 'Typo', subject: 'Hi {{guestname}}', body: 'Policy: {{cancelation_policy}} and {{guest_first_name}}' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.fields.body, /cancelation_policy/);
  assert.doesNotMatch(bad.data.fields.body, /guest_first_name/);
  assert.match(bad.data.fields.subject, /guestname/);
  const ok = await owner.post('/api/message-templates', { name: 'Fine', subject: 'Hi {{guest_first_name}}', body: 'Code {{ confirmation_code }}' });
  assert.equal(ok.status, 201);
  const patch = await owner.patch(`/api/message-templates/${ok.data.template.template_id}`, { body: 'Oops {{nope}}' });
  assert.equal(patch.status, 400);
  assert.match(patch.data.fields.body, /nope/);
});

test('#15 send-later more than a year ahead names the field', async () => {
  const r = await owner.post(`/api/inbox/${conv}/messages`, { body: 'hi', send_at: new Date(Date.now() + 800 * 86400000).toISOString() });
  assert.equal(r.status, 400);
  assert.match(r.data.fields.send_at, /year ahead/);
});

test('#17 AI key problems never show the env var name to the host', async () => {
  const bad = await owner.post(`/api/inbox/${conv}/ai-draft`, {});
  assert.equal(bad.status, 502);
  assert.doesNotMatch(bad.data.error, /ANTHROPIC|API_KEY|key/i);
});

test('#18 mentioning a staff member explains who can be mentioned', async () => {
  const [{ user_id: staffId }] = await sql("SELECT user_id FROM users WHERE email = 'staff@example.com'");
  const r = await owner.post(`/api/inbox/${conv}/messages`, { body: `hello @[Sam Tan](${staffId})`, note: true });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.body, 'Only owners and managers can be mentioned.');
  const unknown = await owner.post(`/api/inbox/${conv}/messages`, { body: 'hello @[Nobody](00000000-0000-4000-8000-000000000000)', note: true });
  assert.equal(unknown.status, 400);
});
