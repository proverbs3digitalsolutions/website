'use strict';
require('./helpers');
// QA round 50, STAFFSCOPE (carry 16(a), D-130, D-131, D-132). A mention refusal names only people the caller may see: a manager
// who mentions staff on another property gets the answer an unknown id gets, not the staff sentence. Staff the caller may see
// still get the staff sentence, and an owner sees every staff member, as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, ownerAccount, manilaToday } = require('./helpers');

const day = (n) => new Date(Date.parse(`${manilaToday()}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
async function join(base, ownerClient, email, name, role, propertyIds) {
  const inv = await ownerClient.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const token = decodeURIComponent(inv.data.inviteLink.split('invite=')[1]);
  const c = client(base);
  const s = await c.post('/api/auth/signup', { full_name: name, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: token });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

let srv; let owner; let mgrA; let convA; const ids = {};
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qa-r50-staffscope@example.com', 'QA r50 staffscope');
  const prop = async (n) => {
    const r = await owner.post('/api/properties', { property_name: n, property_type: 'condominium', address: `${n} St`, city: 'Taguig', province: 'Metro Manila' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.property.property_id;
  };
  const propA = await prop('QA r50 staffscope A');
  const propB = await prop('QA r50 staffscope B');
  const unitA = (await owner.post(`/api/properties/${propA}/units`, { unit_name: 'QA r50 staffscope A 1', unit_type: 'studio', nightly_rate: '2500' })).data.unit;
  mgrA = await join(srv.base, owner, 'qa-r50-staffscope-mgr-a@example.com', 'Mgr A', 'manager', [propA]);
  await join(srv.base, owner, 'qa-r50-staffscope-staff-a@example.com', 'Staff A', 'staff', [propA]);
  await join(srv.base, owner, 'qa-r50-staffscope-staff-b@example.com', 'Staff B', 'staff', [propB]);
  for (const m of (await owner.get('/api/team')).data.members || []) ids[m.full_name] = m.user_id;
  assert.ok(ids['Staff A'] && ids['Staff B'], JSON.stringify(ids));
  const res = (await owner.post('/api/reservations', { unit_id: unitA.unit_id, check_in: day(2), check_out: day(4), guest_name: 'QA r50 staffscope guest' })).data.reservation;
  convA = (await owner.post(`/api/reservations/${res.booking_id}/conversation`)).data.conversation_id;
});
test.after(async () => { await srv.close(); });

const note = (c, who) => c.post(`/api/inbox/${convA}/messages`, { note: true, body: `hi @[${who}](${ids[who]})` });
const GENERAL = "That person can't be mentioned. Pick a name from the @ list.";
const STAFF = 'Only owners and managers can be mentioned.';

test('C5: a manager who mentions staff on another property gets the general answer, not the staff sentence', async () => {
  const r = await note(mgrA, 'Staff B');
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.body, GENERAL);
});

test('C5: staff the caller may see still get the staff sentence, and an owner sees every staff member', async () => {
  assert.equal((await note(mgrA, 'Staff A')).data.fields.body, STAFF);
  assert.equal((await note(owner, 'Staff A')).data.fields.body, STAFF);
  assert.equal((await note(owner, 'Staff B')).data.fields.body, STAFF);
});

test('C5: an id that is not in this workspace gets the general answer, as before', async () => {
  const r = await owner.post(`/api/inbox/${convA}/messages`, { note: true, body: 'hi @[Nobody](9f1c2d3e-4a5b-4c6d-8e7f-000000000001)' });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.body, GENERAL);
});
