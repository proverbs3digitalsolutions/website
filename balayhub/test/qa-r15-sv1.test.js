'use strict';

// QA round 15, lane SV1 (cleaner supplies and the due date in the assignment alert, server).
// A cleaner reads the supplies for the property of a job they can see, through the job's own route.
// The property-wide supplies list is for owners, managers and staff. The assignment alert names its
// due date in words ("Due Oct 16, 2026"), not the stored YYYY-MM-DD text.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const push = require('../src/lib/push');

const PASSWORD = 'longenough1';
const ok = (r, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};
const SUPPLY_KEYS = ['low', 'name', 'on_hand', 'par_level', 'property_id', 'property_name', 'supply_id', 'unit_label'];

let srv; let owner; let manager; let staff; let rosa; let dan;
let prop; let otherProp; let unit; let unitTwo; let unitThree; let otherUnit;
let soap; let rosaTask; let danTask; let openTask; let cancelledTask; let otherTask;

// A team member who signed up through a real invitation, as cleaner-role.test.js does.
async function member(role, email, name, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  ok(await c.post('/api/auth/signup', {
    full_name: name, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  }), 201);
  const [{ user_id }] = await sql('SELECT user_id FROM users WHERE email = $1', [email]);
  return { c, user_id };
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'sv1-owner@example.com', 'SV1 Stays');
  prop = ok(await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' }), 201).property;
  otherProp = ok(await owner.post('/api/properties', { property_name: 'Grass', property_type: 'condominium', address: 'Project 8 Road', city: 'Taguig', province: 'Metro Manila' }), 201).property;
  const unitAt = async (propertyId, unitName) => ok(await owner.post(`/api/properties/${propertyId}/units`, { unit_name: unitName, unit_type: 'studio', nightly_rate: '2000' }), 201).unit;
  unit = await unitAt(prop.property_id, '1201');
  unitTwo = await unitAt(prop.property_id, '1202');
  unitThree = await unitAt(prop.property_id, '1203');
  otherUnit = await unitAt(otherProp.property_id, '2F');
  manager = await member('manager', 'sv1-manager@example.com', 'Ana Manager', [prop.property_id]);
  staff = await member('staff', 'sv1-staff@example.com', 'Ben Staff', [prop.property_id]);
  rosa = await member('cleaner', 'sv1-rosa@example.com', 'Aling Rosa', [prop.property_id]);
  dan = await member('cleaner', 'sv1-dan@example.com', 'Kuya Dan', [prop.property_id]);

  soap = ok(await owner.post('/api/supplies', { property_id: prop.property_id, name: 'Soap', unit_label: 'bars', par_level: 5, on_hand: 3 }), 201).supply;
  ok(await owner.post('/api/supplies', { property_id: prop.property_id, name: 'Bleach', par_level: 2, on_hand: 1 }), 201);
  ok(await owner.post('/api/supplies', { property_id: otherProp.property_id, name: 'Sponge', par_level: 2, on_hand: 4 }), 201);

  rosaTask = ok(await owner.post('/api/cleaning-tasks', { unit_id: unit.unit_id, due_date: manilaToday(), assigned_to: rosa.user_id }), 201).task;
  danTask = ok(await owner.post('/api/cleaning-tasks', { unit_id: unitTwo.unit_id, due_date: manilaToday(), assigned_to: dan.user_id }), 201).task;
  openTask = ok(await owner.post('/api/cleaning-tasks', { unit_id: unitThree.unit_id, due_date: manilaToday() }), 201).task;
  otherTask = ok(await owner.post('/api/cleaning-tasks', { unit_id: otherUnit.unit_id, due_date: manilaToday() }), 201).task;
  cancelledTask = ok(await owner.post('/api/cleaning-tasks', { unit_id: unit.unit_id, due_date: manilaToday(), assigned_to: rosa.user_id }), 201).task;
  ok(await owner.post(`/api/cleaning-tasks/${cancelledTask.task_id}/status`, { status: 'cancelled' }));
});
test.after(async () => { await srv.close(); });

test('the property supplies list is refused to a cleaner and open to owners, managers and staff', async () => {
  const refused = await rosa.c.get('/api/supplies');
  assert.equal(refused.status, 403, JSON.stringify(refused.data));
  assert.equal(refused.data.code, 'CLEANER_FORBIDDEN');
  ok(await owner.get('/api/supplies'));
  ok(await manager.c.get('/api/supplies'));
  ok(await staff.c.get('/api/supplies'));
});

test('a cleaner reads the supplies of their own job, in the same row shape as the list', async () => {
  const mine = ok(await rosa.c.get(`/api/cleaning-tasks/${rosaTask.task_id}/supplies`));
  assert.deepEqual(Object.keys(mine), ['supplies']);
  assert.deepEqual(mine.supplies.map((s) => s.name), ['Bleach', 'Soap'], 'the property only, by name');
  assert.deepEqual(Object.keys(mine.supplies[0]).sort(), SUPPLY_KEYS);
  const list = ok(await owner.get(`/api/supplies?property_id=${prop.property_id}`));
  assert.deepEqual(mine.supplies, list.supplies);
  assert.equal(mine.supplies.find((s) => s.supply_id === soap.supply_id).on_hand, 3);
});

test('a cleaner gets 404 for another cleaner\'s job, a job at another property, or no such job', async () => {
  assert.equal((await rosa.c.get(`/api/cleaning-tasks/${danTask.task_id}/supplies`)).status, 404);
  assert.equal((await rosa.c.get(`/api/cleaning-tasks/${otherTask.task_id}/supplies`)).status, 404);
  assert.equal((await rosa.c.get(`/api/cleaning-tasks/${crypto.randomUUID()}/supplies`)).status, 404);
});

test('an unassigned job is open to any cleaner at the property, and a cancelled job still lists its supplies', async () => {
  ok(await dan.c.get(`/api/cleaning-tasks/${openTask.task_id}/supplies`));
  ok(await rosa.c.get(`/api/cleaning-tasks/${cancelledTask.task_id}/supplies`));
});

test('owners, managers and staff read the job supplies for tasks at their properties only', async () => {
  for (const c of [owner, manager.c, staff.c]) ok(await c.get(`/api/cleaning-tasks/${rosaTask.task_id}/supplies`));
  assert.equal((await manager.c.get(`/api/cleaning-tasks/${otherTask.task_id}/supplies`)).status, 404);
});

test('the assignment alert gives the due date in words', async () => {
  const sent = [];
  const real = push.notify;
  push.notify = async (org, type, args) => { sent.push(args); return 1; };
  try {
    const t = ok(await owner.post('/api/cleaning-tasks', { unit_id: unitThree.unit_id, due_date: '2026-10-16' }), 201).task;
    sent.length = 0;
    ok(await owner.patch(`/api/cleaning-tasks/${t.task_id}`, { assigned_to: rosa.user_id }));
  } finally {
    push.notify = real;
  }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'Cleaning assigned to you: 1203');
  assert.equal(sent[0].body, 'Due Oct 16, 2026');
  assert.equal(sent[0].userId, rosa.user_id);
});
