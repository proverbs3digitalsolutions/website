'use strict';
require('./helpers');
// QA round 48, INBOXPEOPLE (D-10, D-130): without a conversation, a manager's people list holds the owners and the people who share one of
// the manager's properties, never the whole team. With a conversation, the list is still the people who can see that conversation's property.
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

let srv; let owner; let mgrA; let mgrAB; let mgrB; let staffA; let convA;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qa-r48-inboxpeople@example.com', 'QA r48 inboxpeople');
  const propA = (await owner.post('/api/properties', { property_name: 'QA r48 inboxpeople A', property_type: 'condominium', address: 'A St', city: 'Taguig', province: 'Metro Manila' })).data.property.property_id;
  const propB = (await owner.post('/api/properties', { property_name: 'QA r48 inboxpeople B', property_type: 'condominium', address: 'B St', city: 'Taguig', province: 'Metro Manila' })).data.property.property_id;
  const unitA = (await owner.post(`/api/properties/${propA}/units`, { unit_name: 'QA r48 inboxpeople A 1', unit_type: 'studio', nightly_rate: '2500' })).data.unit;
  mgrA = await join(srv.base, owner, 'qa-r48-inboxpeople-mgr-a@example.com', 'Mgr A', 'manager', [propA]);
  mgrAB = await join(srv.base, owner, 'qa-r48-inboxpeople-mgr-ab@example.com', 'Mgr AB', 'manager', [propA, propB]);
  mgrB = await join(srv.base, owner, 'qa-r48-inboxpeople-mgr-b@example.com', 'Mgr B', 'manager', [propB]);
  staffA = await join(srv.base, owner, 'qa-r48-inboxpeople-staff-a@example.com', 'Staff A', 'staff', [propA]);
  const res = (await owner.post('/api/reservations', { unit_id: unitA.unit_id, check_in: day(2), check_out: day(4), guest_name: 'QA r48 inboxpeople guest' })).data.reservation;
  convA = (await owner.post(`/api/reservations/${res.booking_id}/conversation`)).data.conversation_id;
});
test.after(async () => { await srv.close(); });

const names = (r) => r.data.assignees.map((a) => a.full_name);

test('owner sees every owner and manager when no conversation is open', async () => {
  assert.deepEqual(names(await owner.get('/api/inbox/assignees')), ['Maria Santos', 'Mgr A', 'Mgr AB', 'Mgr B']);
});

test('a manager of one property sees the owner and the managers on that property, not the other property', async () => {
  assert.deepEqual(names(await mgrA.get('/api/inbox/assignees')), ['Maria Santos', 'Mgr A', 'Mgr AB']);
});

test('a manager of two properties sees every manager, since each shares one of them', async () => {
  assert.deepEqual(names(await mgrAB.get('/api/inbox/assignees')), ['Maria Santos', 'Mgr A', 'Mgr AB', 'Mgr B']);
});

test('a manager of the other property sees the owner and the managers on it', async () => {
  assert.deepEqual(names(await mgrB.get('/api/inbox/assignees')), ['Maria Santos', 'Mgr AB', 'Mgr B']);
});

test('with a conversation, the list is the people who can see its property', async () => {
  assert.deepEqual(names(await owner.get(`/api/inbox/assignees?conversation_id=${convA}`)), ['Maria Santos', 'Mgr A', 'Mgr AB']);
  assert.deepEqual(names(await mgrA.get(`/api/inbox/assignees?conversation_id=${convA}`)), ['Maria Santos', 'Mgr A', 'Mgr AB']);
  assert.equal((await mgrB.get(`/api/inbox/assignees?conversation_id=${convA}`)).status, 404, 'a conversation outside their properties');
});

test('staff get no assignee list', async () => {
  assert.equal((await staffA.get('/api/inbox/assignees')).status, 403);
});
