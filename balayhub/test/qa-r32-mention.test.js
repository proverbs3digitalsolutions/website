'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Team Stays <host@example.com>';

// helpers must load before any app module so the test database is set first.
const { startServer, client, sql, ownerAccount } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

// QA round 32, INB-5 (D-114): a mention of someone who cannot be mentioned says what to do, and says the same to everyone
// who is not a team member of this workspace, so the refusal never tells a person whether an id exists elsewhere.
const NOT_MENTIONABLE = "That person can't be mentioned. Pick a name from the @ list.";
const mention = (u) => `@[${u.full_name}](${u.user_id})`;
const day = (n) => new Date(Date.now() + 8 * 3600000 + n * 86400000).toISOString().slice(0, 10);
const idOf = async (email) => (await sql('SELECT user_id, full_name, email FROM users WHERE lower(email) = $1', [email]))[0];

async function join(base, ownerClient, email, name, role, propertyIds) {
  const inv = await ownerClient.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  const token = decodeURIComponent(inv.data.inviteLink.split('invite=')[1]);
  const c = client(base);
  const s = await c.post('/api/auth/signup', { full_name: name, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: token });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

let srv; let owner; let conv; let mgrU; let staffU; let otherU;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-mention@example.com', 'Mention Stays');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Tower 1 - 1201', unit_type: 'studio', nightly_rate: '2500' })).data.unit;
  await join(srv.base, owner, 'mgr-mention@example.com', 'Mgr Mention', 'manager', [prop.property_id]);
  await join(srv.base, owner, 'staff-mention@example.com', 'Staff Mention', 'staff', [prop.property_id]);
  const res = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: day(2), check_out: day(4), guest_name: 'Rafael Diaz' })).data.reservation;
  conv = (await owner.post(`/api/reservations/${res.booking_id}/conversation`)).data.conversation_id;
  mgrU = await idOf('mgr-mention@example.com');
  staffU = await idOf('staff-mention@example.com');
  await ownerAccount(srv.base, 'other-mention@example.com', 'Other Mention Co');
  otherU = await idOf('other-mention@example.com');
});
test.after(async () => { await srv.close(); });

test('a mention of someone who is not on the team is refused in plain words, and nothing is saved', async () => {
  const count = async () => (await sql('SELECT COUNT(*)::int AS n FROM messages WHERE conversation_id = $1', [conv]))[0].n;
  const before = await count();
  const r = await owner.post(`/api/inbox/${conv}/messages`, { body: 'Hi @[Nobody Here](00000000-0000-0000-0000-000000000001)', note: true });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'VALIDATION');
  assert.equal(r.data.fields.body, NOT_MENTIONABLE);
  assert.equal(await count(), before, 'a refused note is not saved');
});

test('a person from another workspace gets the same sentence, so the refusal does not say whether the id exists', async () => {
  const r = await owner.post(`/api/inbox/${conv}/messages`, { body: `Hi ${mention(otherU)}`, note: true });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.body, NOT_MENTIONABLE);
});

test('a staff member is still told that only owners and managers can be mentioned', async () => {
  const r = await owner.post(`/api/inbox/${conv}/messages`, { body: `Hi ${mention(staffU)}`, note: true });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.body, 'Only owners and managers can be mentioned.');
});

test('a manager who can see the reservation can still be mentioned', async () => {
  const r = await owner.post(`/api/inbox/${conv}/messages`, { body: `Please check ${mention(mgrU)}`, note: true });
  assert.equal(r.status, 201);
  assert.deepEqual(r.data.mentions, [{ user_id: mgrU.user_id, full_name: 'Mgr Mention' }]);
});
