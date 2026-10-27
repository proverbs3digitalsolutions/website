'use strict';
require('./helpers');
// QA round 49, MENTIONSCOPE (carry 15, D-131 (f), D-10, D-130 (a)). A refusal names only people the caller may see: a manager
// who mentions or assigns a person outside their properties gets the answer an unknown id gets, not that person's name.
// People the caller may see are still named, and an owner is unchanged.
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

let srv; let owner; let mgrA; let mgrAB; let staff; let convA; let unitA; const ids = {};
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qa-r49-mentionscope@example.com', 'QA r49 mentionscope');
  const prop = async (n) => {
    const r = await owner.post('/api/properties', { property_name: n, property_type: 'condominium', address: `${n} St`, city: 'Taguig', province: 'Metro Manila' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.property.property_id;
  };
  const propA = await prop('QA r49 mentionscope A');
  const propB = await prop('QA r49 mentionscope B');
  const propC = await prop('QA r49 mentionscope C');
  unitA = (await owner.post(`/api/properties/${propA}/units`, { unit_name: 'QA r49 mentionscope A 1', unit_type: 'studio', nightly_rate: '2500' })).data.unit;
  mgrA = await join(srv.base, owner, 'qa-r49-mentionscope-mgr-a@example.com', 'Mgr A', 'manager', [propA]);
  mgrAB = await join(srv.base, owner, 'qa-r49-mentionscope-mgr-ab@example.com', 'Mgr AB', 'manager', [propA, propB]);
  await join(srv.base, owner, 'qa-r49-mentionscope-mgr-b@example.com', 'Mgr B', 'manager', [propB]);
  await join(srv.base, owner, 'qa-r49-mentionscope-mgr-c@example.com', 'Mgr C', 'manager', [propC]);
  staff = await join(srv.base, owner, 'qa-r49-mentionscope-staff@example.com', 'Staff A', 'staff', [propA]);
  for (const a of (await owner.get('/api/inbox/assignees')).data.assignees) ids[a.full_name] = a.user_id;
  const res = (await owner.post('/api/reservations', { unit_id: unitA.unit_id, check_in: day(2), check_out: day(4), guest_name: 'QA r49 mentionscope guest' })).data.reservation;
  convA = (await owner.post(`/api/reservations/${res.booking_id}/conversation`)).data.conversation_id;
});
test.after(async () => { await srv.close(); });

const note = (c, who) => c.post(`/api/inbox/${convA}/messages`, { note: true, body: `hi @[${who}](${ids[who]})` });
const GENERAL = "That person can't be mentioned. Pick a name from the @ list.";
const NOT_IN_WORKSPACE = 'Choose an owner or manager in this workspace.';
const CANT_SEE_PROPERTY = "This person can't see this reservation's property.";

test('C7: a manager who mentions a person outside their properties gets the general answer, not the name', async () => {
  const b = await note(mgrA, 'Mgr B');
  assert.equal(b.status, 400);
  assert.equal(b.data.fields.body, GENERAL);
  assert.equal((await note(mgrA, 'Mgr C')).data.fields.body, GENERAL);
});

test('C7: a person the caller may see is still named, and a note on their property saves', async () => {
  assert.equal((await note(mgrAB, 'Mgr B')).data.fields.body, "Mgr B can't see this reservation");
  assert.equal((await note(owner, 'Mgr C')).data.fields.body, "Mgr C can't see this reservation");
  assert.equal((await note(mgrA, 'Mgr AB')).status, 201);
});

test('C7: assigning a person outside the caller\'s properties gets the not-in-workspace answer', async () => {
  const r = await mgrA.patch(`/api/inbox/${convA}`, { assigned_to: ids['Mgr B'] });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.assigned_to, NOT_IN_WORKSPACE);
});

test('C7: assigning a person the caller may see, but who cannot see the property, still says so', async () => {
  const r = await mgrAB.patch(`/api/inbox/${convA}`, { assigned_to: ids['Mgr B'] });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.assigned_to, CANT_SEE_PROPERTY);
});

test('C7: an owner assigns a manager who can see the property, and staff still cannot reach the inbox', async () => {
  assert.equal((await owner.patch(`/api/inbox/${convA}`, { assigned_to: ids['Mgr AB'] })).status, 200);
  assert.equal((await staff.post(`/api/inbox/${convA}/messages`, { note: true, body: 'hi' })).status, 403);
});
