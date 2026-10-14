'use strict';

// Phase 3 housekeeping: what a cleaner may see of a task, the status board and
// calendar, inspections, the paid-clean rules, the task detail, and cleaner
// scores. The tests tell one story in order, like test/housekeeping.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

let srv; let owner; let ownerId; let orgId; let propA; let propB;
let unitA; let unitA2; let unitA3; let unitB; let cleaner; let ben;
const today = manilaToday();
const d = (n) => ical.addDays(today, n);
const ids = {};

// Invite as staff, sign up, then set the role directly (the cleaner invite
// flow is covered by its own tests).
async function member(email, fullName, role, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role: 'staff', property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: fullName, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  if (role !== 'staff') await sql('UPDATE users SET role = $2 WHERE email = $1', [email, role]);
  return { c, id: (await c.get('/api/auth/me')).data.user.user_id, name: fullName };
}

const allPass = (n, pass) => Array.from({ length: n }, (_, index) => ({ index, pass }));
const firstTwoPass = (n) => Array.from({ length: n }, (_, index) => ({ index, pass: index < 2 }));
const checklistLength = async (id) => (await owner.get(`/api/cleaning-tasks/${id}`)).data.task.checklist.length;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'phase3-host@example.com', 'Phase Three Stays');
  ownerId = (await owner.get('/api/auth/me')).data.user.user_id;
  propA = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  propB = (await owner.post('/api/properties', { property_name: 'Grass', property_type: 'condominium', address: 'Project 8 Road', city: 'Taguig', province: 'Metro Manila' })).data.property;
  orgId = (await sql('SELECT organization_id FROM properties WHERE property_id = $1', [propA.property_id]))[0].organization_id;
  const addUnit = async (p, name) => (await owner.post(`/api/properties/${p.property_id}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  unitA = await addUnit(propA, '1201');
  unitA2 = await addUnit(propA, '1202');
  unitA3 = await addUnit(propA, '1203');
  unitB = await addUnit(propB, '805');
  cleaner = await member('phase3-ana@example.com', 'Ana Dela Cruz', 'cleaner', [propA.property_id]);
  ben = await member('phase3-ben@example.com', 'Ben Other', 'staff', [propA.property_id]);
});
test.after(async () => { await srv.close(); });

test('setup: a checkout makes a clean, and other tasks cover each visibility case', async () => {
  // Maria's stay on 1201 leaves today; checking out creates the clean.
  const stay = (await owner.post('/api/reservations', { unit_id: unitA.unit_id, check_in: d(-2), check_out: d(0), guest_name: 'Maria Santos Reyes' })).data.reservation;
  await owner.post(`/api/reservations/${stay.booking_id}/stay-status`, { action: 'check_in' });
  await owner.post(`/api/reservations/${stay.booking_id}/stay-status`, { action: 'check_out' });
  ids.mine = (await sql('SELECT task_id FROM cleaning_tasks WHERE booking_id = $1', [stay.booking_id]))[0].task_id;
  assert.equal((await owner.patch(`/api/cleaning-tasks/${ids.mine}`, { assigned_to: cleaner.id })).status, 200);

  ids.outside = (await owner.post('/api/cleaning-tasks', { unit_id: unitA.unit_id, due_date: d(1), assignee_name: 'Aling Rosa' })).data.task.task_id;
  ids.unassigned = (await owner.post('/api/cleaning-tasks', { unit_id: unitA2.unit_id, due_date: d(1) })).data.task.task_id;
  ids.other = (await owner.post('/api/cleaning-tasks', { unit_id: unitA3.unit_id, due_date: d(2), assigned_to: ben.id })).data.task.task_id;
  ids.propB = (await owner.post('/api/cleaning-tasks', { unit_id: unitB.unit_id, due_date: d(0) })).data.task.task_id;

  // Ana Reyes is in 1203 now; the next guest arrives in four days.
  const now = (await owner.post('/api/reservations', { unit_id: unitA3.unit_id, check_in: d(-1), check_out: d(2), guest_name: 'Ana Reyes' })).data.reservation;
  await owner.post(`/api/reservations/${now.booking_id}/stay-status`, { action: 'check_in' });
  assert.ok((await owner.post('/api/reservations', { unit_id: unitA3.unit_id, check_in: d(4), check_out: d(6), guest_name: 'Next Guest' })).data.reservation);
});

test('cleaners see only their own and unassigned tasks, and counts and lookups follow suit', async () => {
  const seen = (await cleaner.c.get('/api/cleaning-tasks')).data;
  assert.deepEqual(seen.tasks.map((t) => t.task_id).sort(), [ids.mine, ids.unassigned].sort());
  assert.deepEqual(seen.counts, { today: 1, upcoming: 1 });
  const all = (await owner.get('/api/cleaning-tasks')).data;
  assert.deepEqual(all.counts, { today: 2, upcoming: 3 });
  for (const id of [ids.outside, ids.other, ids.propB]) {
    assert.equal((await cleaner.c.get(`/api/cleaning-tasks/${id}`)).status, 404);
  }
  assert.equal((await cleaner.c.get(`/api/cleaning-tasks/${ids.mine}`)).status, 200);
});

test('a cleaner sees the guest by first name only and cannot search by surname', async () => {
  assert.equal((await cleaner.c.get(`/api/cleaning-tasks/${ids.mine}`)).data.task.departing_guest, 'Maria');
  assert.equal((await owner.get(`/api/cleaning-tasks/${ids.mine}`)).data.task.departing_guest, 'Maria Santos Reyes');
  assert.ok(!JSON.stringify((await cleaner.c.get('/api/cleaning-tasks?view=all')).data).includes('Santos'));
  assert.deepEqual((await cleaner.c.get('/api/cleaning-tasks?q=Santos')).data.tasks, []);
  assert.ok((await owner.get('/api/cleaning-tasks?q=Santos')).data.tasks.some((t) => t.task_id === ids.mine));
});

test('cleaners cannot cancel a task or edit it', async () => {
  assert.equal((await cleaner.c.post(`/api/cleaning-tasks/${ids.mine}/status`, { status: 'cancelled' })).status, 403);
  assert.equal((await cleaner.c.patch(`/api/cleaning-tasks/${ids.mine}`, { notes: 'Mine now' })).status, 403);
  assert.equal((await cleaner.c.patch(`/api/cleaning-tasks/${ids.mine}`, { pay_amount: '1' })).status, 403);
  assert.equal((await sql('SELECT status FROM cleaning_tasks WHERE task_id = $1', [ids.mine]))[0].status, 'todo');
});

test('a cleaner finishes their own clean and sees only their own pay', async () => {
  const n = await checklistLength(ids.mine);
  for (let index = 0; index < n; index++) {
    assert.equal((await cleaner.c.post(`/api/cleaning-tasks/${ids.mine}/checklist`, { index, done: true })).status, 200);
  }
  const done = await cleaner.c.post(`/api/cleaning-tasks/${ids.mine}/status`, { status: 'done' });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(done.data.task.completed_by_name, 'Ana Dela Cruz');

  const priced = await owner.patch(`/api/cleaning-tasks/${ids.mine}`, { pay_amount: '900' });
  assert.equal(priced.status, 200);
  assert.equal(priced.data.task.pay_amount, '900.00');
  assert.equal((await owner.patch(`/api/cleaning-tasks/${ids.mine}`, { pay_amount: 'lots' })).status, 400);
  const mineView = (await cleaner.c.get(`/api/cleaning-tasks/${ids.mine}`)).data.task;
  assert.equal(mineView.pay_amount, '900.00');
  assert.equal(mineView.pay_status, 'unpaid');

  // The owner finishes an unassigned clean: it becomes the owner's, so the cleaner no longer sees it.
  assert.equal((await owner.post(`/api/cleaning-tasks/${ids.unassigned}/status`, { status: 'done' })).status, 200);
  assert.equal((await owner.patch(`/api/cleaning-tasks/${ids.unassigned}`, { pay_amount: '500' })).status, 200);
  assert.equal((await cleaner.c.get(`/api/cleaning-tasks/${ids.unassigned}`)).status, 404);
  const byId = Object.fromEntries((await cleaner.c.get('/api/cleaning-tasks?view=done')).data.tasks.map((t) => [t.task_id, t]));
  assert.equal(byId[ids.mine].pay_amount, '900.00');
  assert.equal(byId[ids.unassigned], undefined);
  const finishedByMe = (await cleaner.c.get(`/api/cleaning-tasks/${ids.mine}`)).data.task;
  assert.equal('completed_by' in finishedByMe, false, 'the internal id is never sent');
  assert.equal((await owner.get(`/api/cleaning-tasks/${ids.unassigned}`)).data.task.pay_amount, '500.00');
});

test('finishing a clean that is already done changes nothing: no new finish time, finisher or pay', async () => {
  const snapshot = async () => (await sql('SELECT completed_at, completed_by, pay_amount FROM cleaning_tasks WHERE task_id = $1', [ids.mine]))[0];
  const before = await snapshot();
  const again = await owner.post(`/api/cleaning-tasks/${ids.mine}/status`, { status: 'done' });
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(again.data.task.status, 'done');
  assert.equal(again.data.task.completed_by_name, 'Ana Dela Cruz');
  assert.equal(again.data.task.pay_amount, '900.00', 'the hand-set pay stays');
  assert.deepEqual(await snapshot(), before);
});

test('inspections are for owners and managers, on finished cleans, with every item marked', async () => {
  const n = await checklistLength(ids.mine);
  assert.equal((await cleaner.c.post(`/api/cleaning-tasks/${ids.mine}/inspect`, { items: allPass(n, true) })).status, 403);

  const notDone = await owner.post(`/api/cleaning-tasks/${ids.outside}/inspect`, { items: allPass(n, true) });
  assert.equal(notDone.status, 409);
  assert.equal(notDone.data.code, 'NOT_DONE');

  const bad = [
    {},
    { items: allPass(n - 1, true) },
    { items: [...allPass(n, true).slice(0, n - 1), { index: 0, pass: true }] },
    { items: allPass(n, true).map((x, i) => (i === 0 ? { index: 0, pass: 'yes' } : x)) },
  ];
  for (const body of bad) {
    const r = await owner.post(`/api/cleaning-tasks/${ids.mine}/inspect`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.ok(r.data.fields.items, 'the items field is named');
  }
  assert.equal((await owner.get(`/api/cleaning-tasks/${ids.mine}`)).data.task.inspections.length, 0);
});

test('a passing inspection scores 100 and marks the unit inspected; the history is newest first', async () => {
  const n = await checklistLength(ids.mine);
  const first = await owner.post(`/api/cleaning-tasks/${ids.mine}/inspect`, { items: allPass(n, true), notes: 'Spotless' });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.deepEqual(Object.keys(first.data.inspection).sort(), ['inspection_id', 'passed', 'score']);
  assert.equal(first.data.inspection.score, 100);
  assert.equal(first.data.inspection.passed, true);
  assert.equal(first.data.task.task_id, ids.mine);
  assert.equal((await sql('SELECT cleaning_status FROM units WHERE unit_id = $1', [unitA.unit_id]))[0].cleaning_status, 'inspected');

  const second = await owner.post(`/api/cleaning-tasks/${ids.mine}/inspect`, { items: allPass(n, true), notes: 'Second look' });
  assert.equal(second.status, 201);
  assert.equal((await sql('SELECT cleaning_status FROM units WHERE unit_id = $1', [unitA.unit_id]))[0].cleaning_status, 'inspected');
});

test('a failing inspection scores the passed share, reopens the clean, unticks failed items and clears unpaid pay', async () => {
  const n = await checklistLength(ids.other);
  for (let index = 0; index < n; index++) {
    assert.equal((await owner.post(`/api/cleaning-tasks/${ids.other}/checklist`, { index, done: true })).status, 200);
  }
  assert.equal((await owner.post(`/api/cleaning-tasks/${ids.other}/status`, { status: 'done' })).status, 200);
  assert.equal((await owner.patch(`/api/cleaning-tasks/${ids.other}`, { pay_amount: '300' })).data.task.pay_amount, '300.00');

  const r = await owner.post(`/api/cleaning-tasks/${ids.other}/inspect`, { items: firstTwoPass(n), notes: 'Dirty grout' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.inspection.score, Math.round((2 / n) * 100));
  assert.equal(r.data.inspection.passed, false);
  assert.equal(r.data.task.status, 'todo');
  assert.equal(r.data.task.pay_amount, null);
  assert.deepEqual(r.data.task.checklist.map((x) => x.done), Array.from({ length: n }, (_, i) => i < 2));
  assert.equal((await sql('SELECT cleaning_status FROM units WHERE unit_id = $1', [unitA3.unit_id]))[0].cleaning_status, 'dirty');
});

test('a paid clean is locked: no pay change, no status change, and no failed inspection', async () => {
  const n = await checklistLength(ids.mine);
  await sql(`UPDATE cleaning_tasks SET pay_status = 'paid', paid_on = $2, paid_method = 'cash' WHERE task_id = $1`, [ids.mine, today]);
  const pay = await owner.patch(`/api/cleaning-tasks/${ids.mine}`, { pay_amount: '950' });
  assert.equal(pay.status, 409);
  assert.equal(pay.data.code, 'PAID');
  const reopen = await owner.post(`/api/cleaning-tasks/${ids.mine}/status`, { status: 'in_progress' });
  assert.equal(reopen.status, 409);
  assert.equal(reopen.data.code, 'PAID');
  assert.equal((await owner.post(`/api/cleaning-tasks/${ids.mine}/status`, { status: 'cancelled' })).status, 409);
  const fail = await owner.post(`/api/cleaning-tasks/${ids.mine}/inspect`, { items: firstTwoPass(n) });
  assert.equal(fail.status, 409);
  assert.equal(fail.data.code, 'PAID');
  const t = (await owner.get(`/api/cleaning-tasks/${ids.mine}`)).data.task;
  assert.equal(t.status, 'done');
  assert.equal(t.pay_amount, '900.00');
  assert.equal(t.pay_status, 'paid');
});

test('reopening a finished, unpaid clean clears its pay', async () => {
  assert.equal((await owner.post(`/api/cleaning-tasks/${ids.outside}/status`, { status: 'done' })).status, 200);
  assert.equal((await owner.patch(`/api/cleaning-tasks/${ids.outside}`, { pay_amount: '300' })).data.task.pay_amount, '300.00');
  const reopened = await owner.post(`/api/cleaning-tasks/${ids.outside}/status`, { status: 'in_progress' });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.data.task.status, 'in_progress');
  assert.equal(reopened.data.task.pay_amount, null);
});

test('the task detail adds inspections, damage, lost and found and work orders; cleaners see less', async () => {
  await sql(`INSERT INTO damage_reports (organization_id, unit_id, task_id, description, estimated_cost, status, resolution_note, reported_by, resolved_by, resolved_at)
             VALUES ($1, $2, $3, 'Cracked bathroom tile', 450, 'charged', 'Charged 450 to the guest', $4, $5, now())`,
  [orgId, unitA.unit_id, ids.mine, cleaner.id, ownerId]);
  await sql(`INSERT INTO lost_found_items (organization_id, unit_id, task_id, description, found_where, found_on, status, status_note, found_by)
             VALUES ($1, $2, $3, 'Phone charger', 'Bedside table', $4, 'held', 'Guest will pick up Sunday', $5)`,
  [orgId, unitA.unit_id, ids.mine, today, cleaner.id]);
  await sql(`INSERT INTO maintenance_requests (organization_id, property_id, unit_id, title, status, cleaning_task_id, created_by)
             VALUES ($1, $2, $3, 'Aircon leaking', 'open', $4, $5)`, [orgId, propA.property_id, unitA.unit_id, ids.mine, cleaner.id]);
  await sql(`INSERT INTO files (organization_id, related_record_type, related_record_id, storage_key, file_name, mime_type, size_bytes, uploaded_by)
             SELECT $1, 'damage', report_id, 'test/crack.png', 'crack.png', 'image/png', 10, $2 FROM damage_reports WHERE task_id = $3`,
  [orgId, cleaner.id, ids.mine]);

  const o = (await owner.get(`/api/cleaning-tasks/${ids.mine}`)).data;
  assert.deepEqual(o.task.damage_reports[0].files.map((f) => f.file_name), ['crack.png']);
  assert.equal('storage_key' in o.task.damage_reports[0].files[0], false, 'the storage key is never sent');
  assert.equal(o.task.inspections.length, 2);
  assert.equal(o.task.inspections[0].notes, 'Second look', 'newest first');
  assert.equal(o.task.inspections[0].inspected_by_name, 'Maria Santos');
  assert.equal(o.task.inspections[0].items[0].pass, true);
  assert.equal(o.task.inspections[0].items[0].text, (await sql('SELECT checklist FROM cleaning_tasks WHERE task_id = $1', [ids.mine]))[0].checklist[0].text);
  assert.equal(o.task.damage_reports[0].resolution_note, 'Charged 450 to the guest');
  assert.ok('charge_id' in o.task.damage_reports[0]);
  assert.equal(o.task.lost_found[0].status_note, 'Guest will pick up Sunday');
  assert.deepEqual(Object.keys(o.task.work_orders[0]).sort(), ['request_id', 'status', 'title']);
  assert.equal(o.task.work_orders[0].title, 'Aircon leaking');

  const c = (await cleaner.c.get(`/api/cleaning-tasks/${ids.mine}`)).data;
  assert.equal(c.task.departing_guest, 'Maria');
  assert.equal(c.task.inspections.length, 2);
  const dmg = c.task.damage_reports[0];
  assert.equal(dmg.description, 'Cracked bathroom tile');
  assert.equal(dmg.files.length, 1, 'a cleaner sees the photos on a report');
  // A cleaner sees no amount, status, charge or resolution on a report.
  for (const key of ['estimated_cost', 'status', 'charge_id', 'resolution_note', 'resolved_at', 'resolved_by_name']) assert.equal(key in dmg, false, key);
  assert.equal(c.task.lost_found[0].description, 'Phone charger');
  assert.equal('status_note' in c.task.lost_found[0], false);
  assert.deepEqual(c.task.work_orders, [], 'a cleaner gets no work orders');
  assert.equal(c.task.pay_status, 'paid');
  assert.equal(c.task.pay_amount, '900.00');
  assert.equal(JSON.stringify(c).includes('Charged 450'), false);
});

test('the status board shows each unit for owners, and a cleaner only their own open task and inspections', async () => {
  const owned = (await owner.get(`/api/cleaning-board?property_id=${propA.property_id}`)).data.units;
  assert.deepEqual(owned.map((u) => u.unit_name), ['1201', '1202', '1203']);
  const byName = (units, name) => units.find((u) => u.unit_name === name);
  assert.deepEqual(Object.keys(byName(owned, '1201')).sort(), ['cleaning_status', 'cleaning_updated_at', 'current_stay', 'last_inspection',
    'next_check_in', 'open_task', 'property_id', 'property_name', 'unit_id', 'unit_name']);

  const u1201 = byName(owned, '1201');
  assert.equal(u1201.cleaning_status, 'dirty');
  assert.equal(u1201.current_stay, null);
  assert.equal(u1201.next_check_in, null);
  assert.deepEqual(u1201.open_task, { task_id: ids.outside, status: 'in_progress', assignee: 'Aling Rosa' });
  assert.equal(u1201.last_inspection.score, 100);
  assert.equal(u1201.last_inspection.passed, true);
  assert.equal(Number.isNaN(Date.parse(u1201.last_inspection.at)), false);

  const u1202 = byName(owned, '1202');
  assert.equal(u1202.cleaning_status, 'clean');
  assert.equal(u1202.open_task, null);
  assert.equal(u1202.last_inspection, null);

  const u1203 = byName(owned, '1203');
  assert.equal(u1203.cleaning_status, 'dirty');
  assert.deepEqual(u1203.current_stay, { check_in: d(-1), check_out: d(2), guest_first_name: 'Ana' });
  assert.equal(u1203.next_check_in, d(4));
  assert.deepEqual(u1203.open_task, { task_id: ids.other, status: 'todo', assignee: 'Ben Other' });
  assert.equal(u1203.last_inspection.score, Math.round((2 / (await checklistLength(ids.other))) * 100));
  assert.equal(u1203.last_inspection.passed, false);

  const mine = (await cleaner.c.get(`/api/cleaning-board?property_id=${propA.property_id}`)).data.units;
  assert.equal(byName(mine, '1201').open_task, null);
  assert.equal(byName(mine, '1201').last_inspection.passed, true);
  assert.equal('score' in byName(mine, '1201').last_inspection, false, 'a cleaner sees pass or fail, never the score');
  assert.equal(byName(mine, '1202').last_inspection, null);
  assert.equal(byName(mine, '1203').open_task, null);
  assert.equal(byName(mine, '1203').last_inspection, null);
  assert.equal(byName(mine, '1203').current_stay, null, 'no job she can see on this unit, so no guest');
  assert.deepEqual((await cleaner.c.get(`/api/cleaning-board?property_id=${propB.property_id}`)).data.units, []);

  const grass = (await owner.get(`/api/cleaning-board?property_id=${propB.property_id}`)).data.units;
  assert.equal(grass[0].open_task.task_id, ids.propB);
  assert.equal(grass[0].open_task.assignee, null);
});

test('the calendar groups tasks by day, and a cleaner sees only theirs', async () => {
  const week = Array.from({ length: 7 }, (_, i) => d(i));
  const cal = (await owner.get(`/api/cleaning-calendar?from=${d(0)}&to=${d(6)}`)).data;
  assert.deepEqual(cal.days.map((x) => x.date), week);
  const idsOn = (day) => day.tasks.map((t) => t.task_id).sort();
  assert.deepEqual(idsOn(cal.days[0]), [ids.mine, ids.propB].sort());
  assert.deepEqual(idsOn(cal.days[1]), [ids.outside, ids.unassigned].sort());
  assert.deepEqual(idsOn(cal.days[2]), [ids.other]);
  assert.deepEqual(cal.days.slice(3).map((x) => x.tasks.length), [0, 0, 0, 0]);
  assert.deepEqual(Object.keys(cal.days[2].tasks[0]).sort(), ['assigned_to', 'assigned_user_name', 'assignee_name',
    'next_check_in', 'property_id', 'status', 'task_id', 'unit_name']);
  // The owner finished the unassigned clean on day two, so it is the owner's.
  assert.deepEqual(cal.assignees.map((a) => a.cleaner_key).sort(), [`name:aling rosa`, `user:${cleaner.id}`, `user:${ben.id}`, `user:${ownerId}`].sort());

  const mine = (await cleaner.c.get(`/api/cleaning-calendar?from=${d(0)}&to=${d(6)}`)).data;
  assert.deepEqual(idsOn(mine.days[0]), [ids.mine]);
  assert.deepEqual(idsOn(mine.days[1]), []);
  assert.deepEqual(idsOn(mine.days[2]), []);
  assert.deepEqual(mine.assignees.map((a) => a.cleaner_key), [`user:${cleaner.id}`]);

  assert.equal((await owner.get(`/api/cleaning-calendar?from=${d(0)}`)).status, 400);
  assert.equal((await owner.get(`/api/cleaning-calendar?from=${d(3)}&to=${d(0)}`)).status, 400);
  assert.equal((await owner.get(`/api/cleaning-calendar?from=${d(0)}&to=${d(31)}`)).status, 400);
  assert.equal((await owner.get(`/api/cleaning-calendar?from=${d(0)}&to=${d(30)}`)).data.days.length, 31);
});

test('cleaner scores for the month count finished cleans and inspections, and cleaners cannot see them', async () => {
  const month = today.slice(0, 7);
  const { cleaners } = (await owner.get(`/api/cleaner-scores?month=${month}`)).data;
  // The owner's finished unassigned clean counts under the owner, who finished it.
  assert.deepEqual(cleaners.map((c) => c.cleaner_name), ['Ana Dela Cruz', 'Ben Other', 'Maria Santos']);
  assert.deepEqual(cleaners[0], { cleaner_key: `user:${cleaner.id}`, cleaner_name: 'Ana Dela Cruz', tasks_done: 1, inspected: 2, avg_score: 100, fails: 0 });
  const benScore = Math.round((2 / (await checklistLength(ids.other))) * 100);
  assert.deepEqual(cleaners[1], { cleaner_key: `user:${ben.id}`, cleaner_name: 'Ben Other', tasks_done: 0, inspected: 1, avg_score: benScore, fails: 1 });
  assert.deepEqual(cleaners[2], { cleaner_key: `user:${ownerId}`, cleaner_name: 'Maria Santos', tasks_done: 1, inspected: 0, avg_score: null, fails: 0 });
  assert.equal((await cleaner.c.get(`/api/cleaner-scores?month=${month}`)).status, 403);
  assert.equal((await owner.get('/api/cleaner-scores?month=2026-13')).status, 400);
});

test('a manager sees only their property on the board, calendar and scores', async () => {
  const mgr = await member('phase3-mgr@example.com', 'Max Manager', 'manager', [propB.property_id]);
  assert.equal((await mgr.c.get(`/api/cleaning-tasks/${ids.mine}`)).status, 404);
  assert.deepEqual((await mgr.c.get('/api/cleaning-board')).data.units.map((u) => u.unit_name), ['805']);
  const cal = (await mgr.c.get(`/api/cleaning-calendar?from=${d(0)}&to=${d(0)}`)).data;
  assert.deepEqual(cal.days[0].tasks.map((t) => t.task_id), [ids.propB]);
  assert.deepEqual((await mgr.c.get(`/api/cleaner-scores?month=${today.slice(0, 7)}`)).data.cleaners, []);
});

test('another workspace sees none of these tasks', async () => {
  const stranger = await ownerAccount(srv.base, 'phase3-other@example.com', 'Other Stays');
  assert.equal((await stranger.get(`/api/cleaning-tasks/${ids.mine}`)).status, 404);
  assert.equal((await stranger.post(`/api/cleaning-tasks/${ids.mine}/inspect`, { items: allPass(8, true) })).status, 404);
  assert.deepEqual((await stranger.get('/api/cleaning-board')).data.units, []);
});

test('signed-out requests are refused, and malformed input gets a 4xx, never a 500', async () => {
  const anon = client(srv.base);
  const from = d(0);
  const reads = ['/api/cleaning-board', `/api/cleaning-calendar?from=${from}&to=${from}`, '/api/cleaner-scores', `/api/cleaning-tasks/${ids.mine}`];
  for (const url of reads) assert.equal((await anon.get(url)).status, 401, url);
  assert.equal((await anon.post(`/api/cleaning-tasks/${ids.mine}/inspect`, { items: [] })).status, 401);
  assert.equal((await owner.get('/api/cleaning-board?property_id=abc')).status, 404);
  assert.equal((await owner.get('/api/cleaning-calendar?from=2026-02-30&to=2026-03-01')).status, 400);
  assert.equal((await owner.get('/api/cleaner-scores?month=oct')).status, 400);
  assert.equal((await owner.post(`/api/cleaning-tasks/${ids.mine}/inspect`, { items: 'all', notes: 'x' })).status, 400);
});

test('a clean with no checklist items cannot be inspected', async () => {
  // The API refuses an empty default checklist, so this test sets one with SQL.
  const saved = (await owner.get('/api/cleaning-checklist')).data.items;
  assert.equal((await owner.raw('PUT', '/api/cleaning-checklist', { items: [] })).status, 400);
  await sql('UPDATE organizations SET cleaning_checklist = $2 WHERE organization_id = $1', [orgId, JSON.stringify([])]);
  const t = (await owner.post('/api/cleaning-tasks', { unit_id: unitB.unit_id, due_date: d(0) })).data.task;
  assert.equal(t.checklist.length, 0);
  assert.equal((await owner.post(`/api/cleaning-tasks/${t.task_id}/status`, { status: 'done' })).status, 200);
  const r = await owner.post(`/api/cleaning-tasks/${t.task_id}/inspect`, { items: [] });
  assert.equal(r.status, 400);
  assert.ok(r.data.fields.items);
  await sql('UPDATE organizations SET cleaning_checklist = $2 WHERE organization_id = $1', [orgId, JSON.stringify(saved)]);
});
