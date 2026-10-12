'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const housekeeping = require('../src/lib/housekeeping');

let srv; let owner; let prop; let prop2; let unit; let unit2; let staff;
const today = manilaToday();
const d = (n) => ical.addDays(today, n);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Clean Stays');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  prop2 = (await owner.post('/api/properties', { property_name: 'Grass', property_type: 'condominium', address: 'Project 8 Road', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  unit2 = (await owner.post(`/api/properties/${prop2.property_id}/units`, { unit_name: '805', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const inv = await owner.post('/api/team/invitations', { email: 'cleaner@example.com', role: 'staff', property_ids: [prop.property_id] });
  staff = client(srv.base);
  const s = await staff.post('/api/auth/signup', { full_name: 'Nene Cleaner', email: 'cleaner@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201);
});
test.after(async () => { await srv.close(); });

let task;
test('checking out creates a cleaning task with the workspace checklist', async () => {
  const r = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(-2), check_out: d(0), guest_name: 'Leaving Today' })).data.reservation;
  const next = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(1), check_out: d(3), guest_name: 'Next Guest' })).data.reservation;
  assert.ok(next);
  await owner.post(`/api/reservations/${r.booking_id}/stay-status`, { action: 'check_in' });
  await owner.post(`/api/reservations/${r.booking_id}/stay-status`, { action: 'check_out' });
  await owner.post(`/api/reservations/${r.booking_id}/stay-status`, { action: 'undo_check_out' });
  await owner.post(`/api/reservations/${r.booking_id}/stay-status`, { action: 'check_out' });
  const list = await owner.get('/api/cleaning-tasks?view=today');
  assert.equal(list.data.tasks.length, 1, 'one task per stay even after re-checkout');
  task = list.data.tasks[0];
  assert.equal(task.unit_name, '1201');
  assert.equal(task.next_check_in, d(1));
  assert.equal(task.departing_guest, 'Leaving Today');
  assert.ok(task.checklist.length >= 5);
  assert.equal(Number(task.done_count), 0);
  assert.equal(Number(list.data.counts.today), 1);
});

test('scheduler creates tasks for today and tomorrow departures only, and cancels for cancelled stays', async () => {
  const tomorrow = (await owner.post('/api/reservations', { unit_id: unit2.unit_id, check_in: d(-1), check_out: d(1), guest_name: 'Tomorrow' })).data.reservation;
  const later = (await owner.post('/api/reservations', { unit_id: unit2.unit_id, check_in: d(5), check_out: d(7), guest_name: 'Later' })).data.reservation;
  assert.ok(later);
  assert.equal(await housekeeping.createDueTasks(), 1);
  assert.equal(await housekeeping.createDueTasks(), 0, 'idempotent');
  const t = await sql('SELECT status FROM cleaning_tasks WHERE booking_id = $1', [tomorrow.booking_id]);
  assert.equal(t[0].status, 'todo');
  await owner.post(`/api/reservations/${tomorrow.booking_id}/cancel`, { reason: 'guest cancelled' });
  await housekeeping.createDueTasks();
  assert.equal((await sql('SELECT status FROM cleaning_tasks WHERE booking_id = $1', [tomorrow.booking_id]))[0].status, 'cancelled');
});

test('cleaners see only their properties, tick the checklist, upload photos, and finishing marks the listing clean', async () => {
  const mine = await staff.get('/api/cleaning-tasks');
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.data.tasks.map((t) => t.unit_name), ['1201']);
  const other = await sql('SELECT task_id FROM cleaning_tasks WHERE unit_id = $1', [unit2.unit_id]);
  assert.equal((await staff.get(`/api/cleaning-tasks/${other[0].task_id}`)).status, 404);
  assert.equal((await staff.patch(`/api/cleaning-tasks/${task.task_id}`, { assignee_name: 'x' })).status, 403);
  assert.equal((await staff.post(`/api/cleaning-tasks/${task.task_id}/status`, { status: 'cancelled' })).status, 403);

  const tick = await staff.post(`/api/cleaning-tasks/${task.task_id}/checklist`, { index: 0, done: true });
  assert.equal(tick.status, 200);
  assert.equal(tick.data.task.status, 'in_progress');
  assert.equal(Number(tick.data.task.done_count), 1);
  assert.equal((await staff.post(`/api/cleaning-tasks/${task.task_id}/checklist`, { index: 99, done: true })).status, 400);

  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
  const up = await staff.raw('POST', `/api/files?record_type=cleaning&record_id=${task.task_id}`, png, { 'Content-Type': 'image/png', 'X-File-Name': 'bathroom.png' });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.equal((await staff.get(`/api/cleaning-tasks/${task.task_id}`)).data.files.length, 1);

  assert.equal((await sql('SELECT cleaning_status FROM units WHERE unit_id = $1', [unit.unit_id]))[0].cleaning_status, 'dirty');
  const done = await staff.post(`/api/cleaning-tasks/${task.task_id}/status`, { status: 'done' });
  assert.equal(done.data.task.status, 'done');
  assert.equal(done.data.task.completed_by_name, 'Nene Cleaner');
  assert.equal((await sql('SELECT cleaning_status FROM units WHERE unit_id = $1', [unit.unit_id]))[0].cleaning_status, 'clean');
  assert.equal((await staff.post(`/api/cleaning-tasks/${task.task_id}/checklist`, { index: 1, done: true })).status, 409);
});

test('owners assign tasks, add manual tasks and edit the checklist', async () => {
  const people = (await owner.get('/api/cleaning-assignees')).data.assignees;
  const cleaner = people.find((p) => p.full_name === 'Nene Cleaner');
  const t = await owner.post('/api/cleaning-tasks', { unit_id: unit.unit_id, due_date: d(2), assigned_to: cleaner.user_id, notes: 'Deep clean' });
  assert.equal(t.status, 201);
  assert.equal(t.data.task.assigned_user_name, 'Nene Cleaner');
  const p = await owner.patch(`/api/cleaning-tasks/${t.data.task.task_id}`, { assignee_name: 'Aling Rosa' });
  assert.equal(p.data.task.assignee_name, 'Aling Rosa');
  assert.equal(p.data.task.assigned_to, null);
  assert.equal((await owner.patch(`/api/cleaning-tasks/${t.data.task.task_id}`, { assigned_to: '00000000-0000-0000-0000-000000000000' })).status, 400);

  assert.equal((await owner.raw('PUT', '/api/cleaning-checklist', { items: ['Beds', ' ', 'Bathroom'] })).data.items.length, 2);
  assert.equal((await staff.raw('PUT', '/api/cleaning-checklist', { items: ['x'] })).status, 403);
  assert.equal((await owner.raw('PUT', '/api/cleaning-checklist', { items: 'nope' })).status, 400);
  const t2 = await owner.post('/api/cleaning-tasks', { unit_id: unit2.unit_id, due_date: d(3) });
  assert.deepEqual(t2.data.task.checklist.map((x) => x.text), ['Beds', 'Bathroom']);

  // Marking a listing clean finishes its due tasks.
  const t3 = await owner.post('/api/cleaning-tasks', { unit_id: unit2.unit_id, due_date: d(0) });
  await owner.post(`/api/units/${unit2.unit_id}/cleaning`, { status: 'clean' });
  assert.equal((await sql('SELECT status FROM cleaning_tasks WHERE task_id = $1', [t3.data.task.task_id]))[0].status, 'done');
  assert.equal((await sql('SELECT status FROM cleaning_tasks WHERE task_id = $1', [t2.data.task.task_id]))[0].status, 'todo', 'future task untouched');

  const stranger = await ownerAccount(srv.base, 'x@example.com', 'Other');
  assert.equal((await stranger.get(`/api/cleaning-tasks/${t.data.task.task_id}`)).status, 404);
  assert.equal((await stranger.post(`/api/cleaning-tasks/${t.data.task.task_id}/status`, { status: 'done' })).status, 404);
});
