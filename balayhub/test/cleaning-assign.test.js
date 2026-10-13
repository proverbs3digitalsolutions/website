'use strict';

// Cleaning tasks can only be assigned to team members who can see the task's
// property: owners always, managers and staff only when assigned to it.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, ownerAccount, manilaToday } = require('./helpers');

let srv; let owner; let ownerId; let propA; let propB; let unitA; let task;
const members = {};

async function invite(email, fullName, role, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: fullName, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return (await c.get('/api/auth/me')).data.user.user_id;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'assign-host@example.com', 'Assign Stays');
  ownerId = (await owner.get('/api/auth/me')).data.user.user_id;
  propA = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  propB = (await owner.post('/api/properties', { property_name: 'Grass', property_type: 'condominium', address: 'Project 8 Road', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unitA = (await owner.post(`/api/properties/${propA.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  members.staffA = await invite('staff-a@example.com', 'Staff Azure', 'staff', [propA.property_id]);
  members.staffB = await invite('staff-b@example.com', 'Staff Grass', 'staff', [propB.property_id]);
  members.managerB = await invite('manager-b@example.com', 'Manager Grass', 'manager', [propB.property_id]);
  const r = await owner.post('/api/cleaning-tasks', { unit_id: unitA.unit_id, due_date: manilaToday() });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  task = r.data.task;
});
test.after(async () => { await srv.close(); });

const notAssigned = "This team member isn't assigned to Azure. Add them to the property in Settings → Team first, or pick someone else.";

test('the owner can always be assigned', async () => {
  const r = await owner.patch(`/api/cleaning-tasks/${task.task_id}`, { assigned_to: ownerId });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.task.assigned_to, ownerId);
});

test('staff assigned to the property can be assigned, on update and on create', async () => {
  const r = await owner.patch(`/api/cleaning-tasks/${task.task_id}`, { assigned_to: members.staffA });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.task.assigned_to, members.staffA);
  const c = await owner.post('/api/cleaning-tasks', { unit_id: unitA.unit_id, due_date: manilaToday(), assigned_to: members.staffA });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  assert.equal(c.data.task.assigned_to, members.staffA);
});

test('staff not assigned to the property get a 400 on the assignee field', async () => {
  const r = await owner.patch(`/api/cleaning-tasks/${task.task_id}`, { assigned_to: members.staffB });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.assigned_to, notAssigned);
  const c = await owner.post('/api/cleaning-tasks', { unit_id: unitA.unit_id, due_date: manilaToday(), assigned_to: members.staffB });
  assert.equal(c.status, 400);
  assert.equal(c.data.fields.assigned_to, notAssigned);
  assert.equal((await owner.get(`/api/cleaning-tasks/${task.task_id}`)).data.task.assigned_to, members.staffA, 'unchanged');
});

test('managers not assigned to the property get a 400 on the assignee field', async () => {
  const r = await owner.patch(`/api/cleaning-tasks/${task.task_id}`, { assigned_to: members.managerB });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.assigned_to, notAssigned);
});

test('a cleaner without a login can be assigned', async () => {
  const r = await owner.patch(`/api/cleaning-tasks/${task.task_id}`, { assigned_to: null, assignee_name: 'Aling Rosa' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.task.assigned_to, null);
  assert.equal(r.data.task.assignee_name, 'Aling Rosa');
});

test('clearing the assignee is allowed', async () => {
  const r = await owner.patch(`/api/cleaning-tasks/${task.task_id}`, { assigned_to: null, assignee_name: null });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.task.assigned_to, null);
  assert.equal(r.data.task.assignee_name, null);
});

test('the assignee list says which properties each member can take tasks for', async () => {
  const { assignees } = (await owner.get('/api/cleaning-assignees')).data;
  const byId = Object.fromEntries(assignees.map((a) => [a.user_id, a]));
  assert.equal(byId[ownerId].property_ids, null);
  assert.deepEqual(byId[members.staffA].property_ids, [propA.property_id]);
  assert.deepEqual(byId[members.managerB].property_ids, [propB.property_id]);
});
