'use strict';
require('./helpers');
// QA round 48, HKPEOPLE (HK48-S1, D-10, D-130). GET /cleaning-assignees feeds Housekeeping's "Assigned to" filter, the calendar and both
// assign pickers. It gave a manager every active member with the ids of properties the manager cannot see. A manager is now shown only
// owners and the people who share one of their properties, with only the shared properties listed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, ownerAccount } = require('./helpers');

let srv; let owner; let ownerId;
const P = {}; const U = {}; const C = {};

async function join(email, name, role, props) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: props });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: name, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return [c, (await c.get('/api/auth/me')).data.user.user_id];
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qa-r48-hk@example.com', 'QA r48 hk');
  ownerId = (await owner.get('/api/auth/me')).data.user.user_id;
  for (const k of ['A', 'B', 'C']) {
    P[k] = (await owner.post('/api/properties', { property_name: `QA r48 hk ${k}`, property_type: 'condominium', address: `${k} St`, city: 'Pasay', province: 'Metro Manila' })).data.property.property_id;
  }
  [C.mgrA, U.mgrA] = await join('qa-r48-hk-mgr-a@example.com', 'HK Mgr A', 'manager', [P.A]);
  [C.mgrAB, U.mgrAB] = await join('qa-r48-hk-mgr-ab@example.com', 'HK Mgr AB', 'manager', [P.A, P.B]);
  [, U.mgrB] = await join('qa-r48-hk-mgr-b@example.com', 'HK Mgr B', 'manager', [P.B]);
  [C.staffA, U.staffA] = await join('qa-r48-hk-staff-a@example.com', 'HK Staff A', 'staff', [P.A]);
  [, U.staffB] = await join('qa-r48-hk-staff-b@example.com', 'HK Staff B', 'staff', [P.B]);
  [, U.cleanC] = await join('qa-r48-hk-clean-c@example.com', 'HK Cleaner C', 'cleaner', [P.C]);
});
test.after(async () => { await srv.close(); });

const byId = (rows) => Object.fromEntries(rows.map((r) => [r.user_id, r]));

test('owner sees all seven active members, with every property each one is assigned to', async () => {
  const rows = (await owner.get('/api/cleaning-assignees')).data.assignees;
  assert.equal(rows.length, 7, JSON.stringify(rows.map((r) => r.full_name)));
  assert.deepEqual(byId(rows)[U.mgrAB].property_ids.sort(), [P.A, P.B].sort());
});

test('a manager on property A sees owners and the people who share A, with shared properties only', async () => {
  const r = await C.mgrA.get('/api/cleaning-assignees');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rows = r.data.assignees;
  const ids = rows.map((x) => x.user_id);
  assert.equal(rows.length, 4, `owner, HK Mgr A, HK Mgr AB, HK Staff A only: ${JSON.stringify(rows.map((x) => x.full_name))}`);
  assert.ok(ids.includes(ownerId), 'the owner is shown');
  for (const k of ['mgrA', 'mgrAB', 'staffA']) assert.ok(ids.includes(U[k]), `${k} is shown to the A manager`);
  for (const k of ['mgrB', 'staffB', 'cleanC']) assert.ok(!ids.includes(U[k]), `${k} is hidden from the A manager`);
  const m = byId(rows);
  assert.equal(m[ownerId].property_ids, null);
  assert.deepEqual(m[U.mgrA].property_ids, [P.A]);
  assert.deepEqual(m[U.mgrAB].property_ids, [P.A], 'only the shared property is named, not B');
  assert.deepEqual(m[U.staffA].property_ids, [P.A]);
});

test('a manager on A and B sees the people who share either property, each with the shared properties', async () => {
  const r = await C.mgrAB.get('/api/cleaning-assignees');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ids = r.data.assignees.map((x) => x.user_id);
  for (const k of ['mgrA', 'mgrAB', 'mgrB', 'staffA', 'staffB']) assert.ok(ids.includes(U[k]), `${k} is shown to the A+B manager`);
  assert.ok(!ids.includes(U.cleanC), 'the cleaner on C is hidden from the A+B manager');
  assert.deepEqual(byId(r.data.assignees)[U.mgrB].property_ids, [P.B]);
});

test('staff are still refused the assignee list', async () => {
  assert.equal((await C.staffA.get('/api/cleaning-assignees')).status, 403);
});
