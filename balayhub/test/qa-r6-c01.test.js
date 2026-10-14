'use strict';

// QA round 6, lane C01 (housekeeping access, server): #37 inspection results reach only owners, managers and
// (as a pass/fail on her own jobs) the cleaner; #38 staff open only the damage and lost-item photos they filed;
// #40 a cleaner sees a guest only on a unit where she can see the job; O-c reopening or failing an older clean
// does not dirty a unit with a newer finished clean.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_01 node --test --test-concurrency=1 test/qa-r6-c01.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');

const PASSWORD = 'longenough1';
const today = manilaToday();
const d = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');

let srv; let owner; let manager; let staff; let nena; let prop;
const units = {};

async function member(email, role, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: email, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return { c, id: (await c.get('/api/auth/me')).data.user.user_id };
}

const unit = async (name) => (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '2000' })).data.unit;
const newTask = async (u, assignedTo, due = today) => (await owner.post('/api/cleaning-tasks', { unit_id: u.unit_id, due_date: due, ...(assignedTo ? { assigned_to: assignedTo } : {}) })).data.task.task_id;
const finish = async (id) => assert.equal((await owner.post(`/api/cleaning-tasks/${id}/status`, { status: 'done' })).status, 200);
const status = async (u) => (await sql('SELECT cleaning_status FROM units WHERE unit_id = $1', [u.unit_id]))[0].cleaning_status;
const board = async (who, u) => (await who.get('/api/cleaning-board')).data.units.find((x) => x.unit_id === u.unit_id);
async function inspect(id, failLast) {
  const t = (await owner.get(`/api/cleaning-tasks/${id}`)).data.task;
  const items = t.checklist.map((_, index) => ({ index, pass: !(failLast && index === t.checklist.length - 1) }));
  const r = await manager.post(`/api/cleaning-tasks/${id}/inspect`, { items });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}
const upload = (who, type, id) => who.raw('POST', `/api/files?record_type=${type}&record_id=${id}`, PNG, { 'Content-Type': 'image/png' });

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'r6c01-host@example.com', 'C01 Stays');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  manager = (await member('r6c01-mgr@example.com', 'manager', [prop.property_id])).c;
  staff = await member('r6c01-staff@example.com', 'staff', [prop.property_id]);
  nena = await member('r6c01-nena@example.com', 'cleaner', [prop.property_id]);
});
test.after(async () => { await srv.close(); });

test('#37 an inspected clean: job detail and board per role', async () => {
  units.a = await unit('A1');
  units.b = await unit('B1');
  const mine = await newTask(units.a, nena.id);
  await finish(mine);
  const result = await inspect(mine, true);
  assert.ok(result.inspection.score < 100 && result.inspection.passed === false);

  // An inspected clean that is not assigned to anyone.
  const loose = await newTask(units.b, null);
  await finish(loose);
  await inspect(loose, false);
  await sql('UPDATE cleaning_tasks SET assigned_to = NULL WHERE task_id = $1', [loose]);

  const own = (await nena.c.get(`/api/cleaning-tasks/${mine}`)).data.task;
  assert.equal(own.inspections.length, 1);
  assert.deepEqual(Object.keys(own.inspections[0]).sort(), ['created_at', 'inspection_id', 'passed']);
  const unassigned = (await nena.c.get(`/api/cleaning-tasks/${loose}`)).data.task;
  assert.deepEqual(unassigned.inspections, [], 'no inspection on a job not assigned to her');
  assert.deepEqual((await staff.c.get(`/api/cleaning-tasks/${mine}`)).data.task.inspections, []);
  const full = (await manager.get(`/api/cleaning-tasks/${mine}`)).data.task.inspections[0];
  assert.ok('score' in full && 'items' in full && 'notes' in full);

  const cleanerA = await board(nena.c, units.a);
  assert.deepEqual(Object.keys(cleanerA.last_inspection).sort(), ['at', 'passed']);
  assert.equal(cleanerA.last_inspection.passed, false);
  assert.equal((await board(nena.c, units.b)).last_inspection, null, 'an inspection on an unassigned job is not hers');

  for (const u of [units.a, units.b]) assert.equal((await board(staff.c, u)).last_inspection, null);
  const ownerA = await board(owner, units.a);
  assert.ok(ownerA.last_inspection.score < 100);
  assert.ok('score' in (await board(manager, units.a)).last_inspection);
  assert.ok('score' in (await board(owner, units.b)).last_inspection);
});

test('#40 a cleaner sees the guest on a unit only where she can see the job', async () => {
  units.c = await unit('C1');
  units.d = await unit('D1');
  const st = async (u, name) => (await owner.post('/api/reservations', { unit_id: u.unit_id, check_in: d(-1), check_out: d(2), guest_name: name, guest_email: `${name.split(' ')[0].toLowerCase()}@example.com` })).data.reservation;
  await st(units.c, 'Carla Reyes');
  await st(units.d, 'Dino Reyes');
  await newTask(units.d, nena.id, d(2));
  assert.equal((await board(nena.c, units.c)).current_stay, null, 'no job for her on C1');
  assert.equal((await board(nena.c, units.d)).current_stay.guest_first_name, 'Dino');
  for (const who of [owner, manager, staff.c]) assert.ok((await board(who, units.c)).current_stay, 'other roles still see the stay');
});

test('#38 staff open only the damage and lost-item photos they filed', async () => {
  units.e = await unit('E1');
  const task = await newTask(units.e, null);
  const stay = (await owner.post('/api/reservations', { unit_id: units.e.unit_id, check_in: d(-3), check_out: d(-1), guest_name: 'Eli Cruz', guest_email: 'eli@example.com' })).data.reservation;

  const mDamage = (await manager.post(`/api/cleaning-tasks/${task}/damage`, { description: 'Cracked glass' })).data.report.report_id;
  const mLost = (await manager.post(`/api/cleaning-tasks/${task}/lost-found`, { description: 'Watch' })).data.item.item_id;
  const mFiles = [];
  for (const [type, id] of [['damage', mDamage], ['lost_found', mLost]]) {
    const up = await upload(manager, type, id);
    assert.equal(up.status, 201, JSON.stringify(up.data));
    mFiles.push(up.data.file.file_id);
    assert.equal((await upload(staff.c, type, id)).status, 404, 'staff cannot attach to a record they did not file');
  }
  for (const f of mFiles) {
    assert.equal((await staff.c.get(`/api/files/${f}`)).status, 404);
    assert.equal((await owner.get(`/api/files/${f}`)).status, 200);
    assert.equal((await manager.get(`/api/files/${f}`)).status, 200);
  }

  // Staff's own, on a job and on a stay (no job).
  const sDamage = (await staff.c.post(`/api/cleaning-tasks/${task}/damage`, { description: 'Stained rug' })).data.report.report_id;
  const sLost = (await staff.c.post(`/api/reservations/${stay.booking_id}/lost-found`, { description: 'Scarf' })).data.item.item_id;
  const sStayDamage = (await staff.c.post(`/api/reservations/${stay.booking_id}/damage`, { description: 'Broken lamp' })).data.report.report_id;
  for (const [type, id] of [['damage', sDamage], ['lost_found', sLost], ['damage', sStayDamage]]) {
    const up = await upload(staff.c, type, id);
    assert.equal(up.status, 201, JSON.stringify(up.data));
    assert.equal((await staff.c.get(`/api/files/${up.data.file.file_id}`)).status, 200);
    assert.equal((await manager.get(`/api/files/${up.data.file.file_id}`)).status, 200);
  }
});

test('O-c reopening an older clean keeps a unit clean when a newer clean is done', async () => {
  units.f = await unit('F1');
  units.g = await unit('G1');
  const older = await newTask(units.f, null, d(-2));
  await finish(older);
  const newer = await newTask(units.f, null, d(-1));
  await finish(newer);
  assert.equal(await status(units.f), 'clean');
  assert.equal((await owner.post(`/api/cleaning-tasks/${older}/status`, { status: 'todo' })).status, 200);
  assert.equal(await status(units.f), 'clean', 'newer clean is done');

  const only = await newTask(units.g, null);
  await finish(only);
  assert.equal((await owner.post(`/api/cleaning-tasks/${only}/status`, { status: 'todo' })).status, 200);
  assert.equal(await status(units.g), 'dirty', 'no newer clean');
});

test('O-c a failed inspection of an older clean keeps a unit clean when a newer clean is done', async () => {
  units.h = await unit('H1');
  units.i = await unit('I1');
  const older = await newTask(units.h, null, d(-2));
  await finish(older);
  const newer = await newTask(units.h, null, d(-1));
  await finish(newer);
  await inspect(older, true);
  assert.equal(await status(units.h), 'clean');

  const only = await newTask(units.i, null);
  await finish(only);
  await inspect(only, true);
  assert.equal(await status(units.i), 'dirty');
});
