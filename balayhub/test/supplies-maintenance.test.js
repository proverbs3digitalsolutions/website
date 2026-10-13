'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { runSchedules } = require('../src/lib/maintschedule');

const today = manilaToday();
const d = (n) => ical.addDays(today, n);
// The date `day` in the month `months` from March of this year: onDay(0, 10) is 10 March.
const onDay = (months, day) => new Date(Date.UTC(+today.slice(0, 4), 2 + months, day)).toISOString().slice(0, 10);
// The schedule tests replay March with 15 March as "now", in this year, so they stay valid in later years.
const NOW_DAY = onDay(0, 15);
// A Manila-time moment on a date, e.g. manila(onDay(0, 10), '01:00:00').
const manila = (date, time) => new Date(`${date}T${time}+08:00`);
const ok = (r, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};

let srv; let owner; let manager; let staff; let cleaner; let other;
let prop; let prop2; let unit; let unit2;
let toiletPaper; let bleach; let trashBags; let aircon; let tank;
let cleanerTask; let staffTask; let openTask; let cancelledTask; let propTwoTask;

// A team member who signed up through a real invitation.
async function teamMember(role, email, name, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.ok(inv.data.inviteLink, JSON.stringify(inv.data));
  const c = client(srv.base);
  ok(await c.post('/api/auth/signup', {
    full_name: name, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  }), 201);
  const [{ user_id }] = await sql('SELECT user_id FROM users WHERE email = $1', [email]);
  return { c, user_id, name };
}

// Cleaners are the team role 'cleaner'; the invite is sent as staff, then the role is set.
async function cleanerMember(email, name, propertyIds) {
  const m = await teamMember('staff', email, name, propertyIds);
  await sql(`UPDATE users SET role = 'cleaner' WHERE user_id = $1`, [m.user_id]);
  return m;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-supplies@example.com', 'Sup Maint Co');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  prop2 = (await owner.post('/api/properties', { property_name: 'Grass', property_type: 'condominium', address: 'Project 8 Road', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  unit2 = (await owner.post(`/api/properties/${prop2.property_id}/units`, { unit_name: '805', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  manager = await teamMember('manager', 'manager-supplies@example.com', 'Ana Manager', [prop.property_id]);
  staff = await teamMember('staff', 'staff-supplies@example.com', 'Ben Staff', [prop.property_id]);
  cleaner = await cleanerMember('cleaner-supplies@example.com', 'Nene Cleaner', [prop.property_id]);
  other = await ownerAccount(srv.base, 'other-supplies@example.com', 'Other Co');
});
test.after(async () => { await srv.close(); });

test('owners add supplies; the list shows par, on hand and low stock', async () => {
  toiletPaper = ok(await owner.post('/api/supplies', { property_id: prop.property_id, name: 'Toilet paper', unit_label: 'rolls', par_level: 10, on_hand: 4 }), 201).supply;
  assert.deepEqual(Object.keys(toiletPaper).sort(), ['low', 'name', 'on_hand', 'par_level', 'property_id', 'property_name', 'supply_id', 'unit_label']);
  assert.equal(toiletPaper.low, true);
  assert.equal(toiletPaper.property_name, 'Azure');
  bleach = ok(await owner.post('/api/supplies', { property_id: prop.property_id, name: 'Bleach', par_level: 2 }), 201).supply;
  assert.equal(bleach.unit_label, 'pcs');
  assert.equal(bleach.on_hand, 0);
  const dup = await owner.post('/api/supplies', { property_id: prop.property_id, name: 'toilet PAPER', par_level: 1 });
  assert.equal(dup.status, 400);
  assert.ok(dup.data.fields.name);
  assert.equal((await owner.post('/api/supplies', { property_id: prop.property_id, name: 'Soap' })).status, 400, 'par level is required');
  assert.deepEqual(ok(await owner.get('/api/supplies')).supplies.map((s) => s.name), ['Bleach', 'Toilet paper']);
  assert.equal(ok(await staff.c.get('/api/supplies')).supplies.length, 2);
  assert.equal(ok(await other.get('/api/supplies')).supplies.length, 0);
});

test('low stock filter, the Home count, and property scoping', async () => {
  trashBags = ok(await owner.post('/api/supplies', { property_id: prop2.property_id, name: 'Trash bags', par_level: 2, on_hand: 5 }), 201).supply;
  assert.equal(trashBags.low, false);
  assert.deepEqual(ok(await owner.get('/api/supplies?low=1')).supplies.map((s) => s.name), ['Bleach', 'Toilet paper']);
  assert.equal(ok(await owner.get('/api/supplies/low-count')).count, 2);
  assert.equal(ok(await manager.c.get('/api/supplies/low-count')).count, 2);
  assert.equal((await staff.c.get('/api/supplies/low-count')).status, 403);
  assert.equal((await cleaner.c.get('/api/supplies/low-count')).status, 403);
  assert.equal(ok(await staff.c.get('/api/supplies')).supplies.length, 2, 'staff see only their property');
  assert.equal((await staff.c.post('/api/supplies', { property_id: prop.property_id, name: 'Soap', par_level: 1 })).status, 403);
  assert.equal(ok(await owner.get(`/api/supplies?property_id=${prop2.property_id}`)).supplies.length, 1);
  assert.equal((await owner.get('/api/supplies?property_id=not-a-uuid')).status, 404);
});

test('owners edit supplies; on hand only changes through movements', async () => {
  const p = ok(await manager.c.patch(`/api/supplies/${toiletPaper.supply_id}`, { par_level: 3 }));
  assert.equal(p.supply.par_level, 3);
  assert.equal(p.supply.low, false, '4 on hand is no longer below par 3');
  assert.equal(ok(await owner.patch(`/api/supplies/${toiletPaper.supply_id}`, { on_hand: 99 })).supply.on_hand, 4);
  assert.equal((await owner.patch(`/api/supplies/${toiletPaper.supply_id}`, { name: '' })).status, 400);
  assert.equal((await owner.patch(`/api/supplies/${toiletPaper.supply_id}`, { par_level: null })).status, 400);
  assert.equal((await owner.patch(`/api/supplies/${bleach.supply_id}`, { name: 'Toilet paper' })).status, 400);
  assert.equal((await staff.c.patch(`/api/supplies/${toiletPaper.supply_id}`, { par_level: 1 })).status, 403);
});

test('movements change on hand, never below zero, and every change is logged', async () => {
  const move = (body, id = toiletPaper.supply_id) => owner.post(`/api/supplies/${id}/movements`, body);
  let s = ok(await move({ kind: 'used', quantity: 3, note: 'Guest 2B' })).supply;
  assert.equal(s.on_hand, 1);
  assert.equal(s.low, true);
  s = ok(await move({ kind: 'restocked', quantity: 5 })).supply;
  assert.equal(s.on_hand, 6);
  s = ok(await move({ kind: 'count', quantity: 2, note: 'Shelf count' })).supply;
  assert.equal(s.on_hand, 2);
  s = ok(await move({ kind: 'used', quantity: 10 })).supply;
  assert.equal(s.on_hand, 0, 'never below zero');
  const logs = await sql('SELECT kind, quantity, note FROM supply_movements WHERE supply_id = $1 ORDER BY created_at', [toiletPaper.supply_id]);
  assert.deepEqual(logs.map((l) => l.kind), ['count', 'used', 'restocked', 'count', 'used'], 'opening count, then each movement');
  assert.equal(logs[1].note, 'Guest 2B');
  assert.match(logs[4].note, /Asked for 10, only 2 on hand/);
  assert.equal((await move({ kind: 'used', quantity: 0 })).status, 400);
  assert.equal((await move({ kind: 'sold', quantity: 1 })).status, 400);
  assert.equal((await staff.c.post(`/api/supplies/${toiletPaper.supply_id}/movements`, { kind: 'used', quantity: 1 })).status, 403);
  assert.equal((await other.post(`/api/supplies/${toiletPaper.supply_id}/movements`, { kind: 'used', quantity: 1 })).status, 404);
  assert.equal(ok(await move({ kind: 'count', quantity: 0 })).supply.on_hand, 0, 'a count can set zero');
});

test('simultaneous restocks are not lost', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => owner.post(`/api/supplies/${bleach.supply_id}/movements`, { kind: 'restocked', quantity: 1 })));
  for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.data));
  const [row] = await sql('SELECT on_hand FROM supplies WHERE supply_id = $1', [bleach.supply_id]);
  assert.equal(row.on_hand, 8);
});

test('archiving hides a supply and frees its name', async () => {
  assert.deepEqual(ok(await owner.post(`/api/supplies/${bleach.supply_id}/archive`)), { ok: true });
  assert.equal(ok(await owner.get('/api/supplies')).supplies.some((s) => s.supply_id === bleach.supply_id), false);
  assert.equal((await owner.post(`/api/supplies/${bleach.supply_id}/movements`, { kind: 'used', quantity: 1 })).status, 404);
  assert.equal((await staff.c.post(`/api/supplies/${toiletPaper.supply_id}/archive`)).status, 403);
  bleach = ok(await owner.post('/api/supplies', { property_id: prop.property_id, name: 'Bleach', par_level: 2 }), 201).supply;
});

test('cleaners record supplies on their own and unassigned tasks, and the rules hold', async () => {
  const task = async (body) => ok(await owner.post('/api/cleaning-tasks', { unit_id: unit.unit_id, ...body }), 201).task;
  cleanerTask = await task({ due_date: d(1), assigned_to: cleaner.user_id });
  staffTask = await task({ due_date: d(2), assigned_to: staff.user_id });
  openTask = await task({ due_date: d(3) });
  cancelledTask = await task({ due_date: d(4), assigned_to: cleaner.user_id });
  ok(await owner.post(`/api/cleaning-tasks/${cancelledTask.task_id}/status`, { status: 'cancelled' }));
  propTwoTask = ok(await owner.post('/api/cleaning-tasks', { unit_id: unit2.unit_id, due_date: d(5) }), 201).task;
  const use = (taskId, items, c = cleaner.c) => c.post(`/api/cleaning-tasks/${taskId}/supplies`, { items });

  let r = await use(cleanerTask.task_id, [{ supply_id: toiletPaper.supply_id, kind: 'restocked', quantity: 3 }]);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.supplies[0].on_hand, 3);
  r = await use(cleanerTask.task_id, [{ supply_id: toiletPaper.supply_id, kind: 'used', quantity: 1 }]);
  assert.equal(r.data.supplies[0].on_hand, 2);
  const [mv] = await sql('SELECT task_id FROM supply_movements WHERE supply_id = $1 ORDER BY created_at DESC LIMIT 1', [toiletPaper.supply_id]);
  assert.equal(mv.task_id, cleanerTask.task_id);
  assert.equal(ok(await use(openTask.task_id, [{ supply_id: toiletPaper.supply_id, kind: 'used', quantity: 1 }])).supplies[0].on_hand, 1, 'unassigned task is theirs to work');

  assert.equal((await use(staffTask.task_id, [{ supply_id: toiletPaper.supply_id, kind: 'used', quantity: 1 }])).status, 404, "someone else's task");
  assert.equal((await use(cancelledTask.task_id, [{ supply_id: toiletPaper.supply_id, kind: 'used', quantity: 1 }])).status, 409);
  assert.equal((await other.post(`/api/cleaning-tasks/${cleanerTask.task_id}/supplies`, { items: [{ supply_id: toiletPaper.supply_id, kind: 'used', quantity: 1 }] })).status, 404);
  assert.equal((await use(cleanerTask.task_id, [{ supply_id: trashBags.supply_id, kind: 'used', quantity: 1 }])).status, 400, 'a property they are not on');
  assert.equal((await owner.post(`/api/cleaning-tasks/${propTwoTask.task_id}/supplies`, { items: [{ supply_id: toiletPaper.supply_id, kind: 'used', quantity: 1 }] })).status, 400, 'supply from another property');
  assert.equal((await use(cleanerTask.task_id, [])).status, 400);
  assert.equal((await use(cleanerTask.task_id, [{ supply_id: toiletPaper.supply_id, kind: 'count', quantity: 1 }])).status, 400, 'cleaners cannot count');
  assert.equal((await use(cleanerTask.task_id, [{ supply_id: toiletPaper.supply_id, kind: 'used', quantity: 0 }])).status, 400);
});

test('a bad line in a multi-item request changes nothing', async () => {
  const [before] = await sql('SELECT on_hand FROM supplies WHERE supply_id = $1', [toiletPaper.supply_id]);
  const r = await cleaner.c.post(`/api/cleaning-tasks/${cleanerTask.task_id}/supplies`, { items: [
    { supply_id: toiletPaper.supply_id, kind: 'used', quantity: 1 },
    { supply_id: trashBags.supply_id, kind: 'used', quantity: 1 },
  ] });
  assert.equal(r.status, 400);
  const [after] = await sql('SELECT on_hand FROM supplies WHERE supply_id = $1', [toiletPaper.supply_id]);
  assert.equal(after.on_hand, before.on_hand);
});

test('work orders from a task become maintenance requests linked to it', async () => {
  const r = await cleaner.c.post(`/api/cleaning-tasks/${cleanerTask.task_id}/work-order`, { title: 'Shower head leaking', description: 'Drips all night', priority: 'high' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual(Object.keys(r.data.request).sort(), ['cleaning_task_id', 'priority', 'request_id', 'status', 'title']);
  assert.equal(r.data.request.cleaning_task_id, cleanerTask.task_id);
  assert.equal(r.data.request.status, 'open');
  const [row] = await sql('SELECT * FROM maintenance_requests WHERE request_id = $1', [r.data.request.request_id]);
  assert.equal(row.reported_by, 'Nene Cleaner');
  assert.equal(row.unit_id, unit.unit_id);
  assert.equal(row.property_id, prop.property_id);
  assert.equal(row.schedule_id, null);
  const listed = ok(await owner.get('/api/maintenance')).requests.find((x) => x.request_id === r.data.request.request_id);
  assert.equal(listed.cleaning_task_id, cleanerTask.task_id);
  assert.equal(ok(await owner.get(`/api/maintenance/${r.data.request.request_id}`)).request.cleaning_task_id, cleanerTask.task_id);

  const noPriority = await cleaner.c.post(`/api/cleaning-tasks/${cleanerTask.task_id}/work-order`, { title: 'Door' });
  assert.equal(noPriority.status, 400);
  assert.ok(noPriority.data.fields.priority);
  assert.equal((await cleaner.c.post(`/api/cleaning-tasks/${cancelledTask.task_id}/work-order`, { title: 'Door', priority: 'low' })).status, 409);
  assert.equal((await cleaner.c.post(`/api/cleaning-tasks/${staffTask.task_id}/work-order`, { title: 'Door', priority: 'low' })).status, 404);
  assert.equal((await other.post(`/api/cleaning-tasks/${cleanerTask.task_id}/work-order`, { title: 'Door', priority: 'low' })).status, 404);
});

test('recurring schedules: create, list with names, validate, pause and resume', async () => {
  aircon = ok(await owner.post('/api/maintenance-schedules', { property_id: prop.property_id, unit_id: unit.unit_id, title: 'Aircon cleaning', description: 'Clean the coils', every_n: 3, every_unit: 'months', next_due: today, priority: 'medium' }), 201).schedule;
  assert.equal(aircon.property_name, 'Azure');
  assert.equal(aircon.unit_name, '1201');
  assert.equal(aircon.active, true);
  assert.equal(aircon.every_n, 3);
  tank = ok(await manager.c.post('/api/maintenance-schedules', { property_id: prop.property_id, title: 'Water tank check', every_n: 30, every_unit: 'days', next_due: d(10), priority: 'low' }), 201).schedule;
  assert.equal(tank.unit_name, null, 'property-wide schedule has no unit');
  const list = ok(await staff.c.get('/api/maintenance-schedules')).schedules;
  assert.equal(list.length, 2);
  assert.ok(list.every((s) => s.property_name === 'Azure'));
  assert.equal(list.find((s) => s.schedule_id === tank.schedule_id).unit_name, null);

  const base = { property_id: prop.property_id, title: 'Vent cover', every_n: 1, every_unit: 'months', next_due: today, priority: 'low' };
  assert.equal((await owner.post('/api/maintenance-schedules', { ...base, every_n: 0 })).status, 400);
  assert.equal((await owner.post('/api/maintenance-schedules', { ...base, every_unit: 'weeks' })).status, 400);
  assert.equal((await owner.post('/api/maintenance-schedules', { ...base, unit_id: unit2.unit_id })).status, 400, 'unit of another property');
  assert.equal((await staff.c.post('/api/maintenance-schedules', base)).status, 403);

  assert.equal(ok(await owner.patch(`/api/maintenance-schedules/${aircon.schedule_id}`, { active: false })).schedule.active, false);
  assert.equal((await owner.patch(`/api/maintenance-schedules/${aircon.schedule_id}`, { active: 'no' })).status, 400);
  assert.equal((await owner.patch(`/api/maintenance-schedules/${aircon.schedule_id}`, { active: null })).status, 400);
  assert.equal((await owner.patch(`/api/maintenance-schedules/${aircon.schedule_id}`, { title: '' })).status, 400);
  assert.equal(ok(await owner.patch(`/api/maintenance-schedules/${aircon.schedule_id}`, { active: true })).schedule.active, true);
  assert.equal(ok(await manager.c.post(`/api/maintenance-schedules/${aircon.schedule_id}/pause`)).schedule.active, false);
  assert.equal((await staff.c.post(`/api/maintenance-schedules/${aircon.schedule_id}/pause`)).status, 403);
  assert.equal((await other.patch(`/api/maintenance-schedules/${aircon.schedule_id}`, { active: true })).status, 404);
  ok(await owner.patch(`/api/maintenance-schedules/${aircon.schedule_id}`, { active: true }));
});

const nextDue = async (id) => (await sql('SELECT next_due FROM maintenance_schedules WHERE schedule_id = $1', [id]))[0].next_due;
const requestCount = async (id) => (await sql('SELECT COUNT(*)::int AS n FROM maintenance_requests WHERE schedule_id = $1', [id]))[0].n;

test('the job opens one request when a schedule falls due, and blocks a repeat while it is open', async () => {
  const weekly = ok(await owner.post('/api/maintenance-schedules', { property_id: prop.property_id, unit_id: unit.unit_id, title: 'Vent filters', every_n: 7, every_unit: 'days', next_due: onDay(0, 10), priority: 'low' }), 201).schedule;
  assert.equal(await runSchedules(manila(onDay(0, 10), '01:00:00')), 1);
  assert.equal(await nextDue(weekly.schedule_id), onDay(0, 17));
  const [first] = await sql('SELECT request_id, status, title, priority, unit_id FROM maintenance_requests WHERE schedule_id = $1', [weekly.schedule_id]);
  assert.equal(first.status, 'open');
  assert.equal(first.title, 'Vent filters');
  assert.equal(first.priority, 'low');
  assert.equal(first.unit_id, unit.unit_id);

  // The open request blocks a second one, but the due date still moves on.
  assert.equal(await runSchedules(manila(onDay(0, 17), '09:00:00')), 0);
  assert.equal(await nextDue(weekly.schedule_id), onDay(0, 24));
  assert.equal(await requestCount(weekly.schedule_id), 1);

  // Once that request is resolved, the next occurrence opens a new one.
  ok(await owner.patch(`/api/maintenance/${first.request_id}`, { status: 'resolved' }));
  assert.equal(await runSchedules(manila(onDay(0, 24), '09:00:00')), 1);
  assert.equal(await nextDue(weekly.schedule_id), onDay(0, 31));
  assert.equal(await requestCount(weekly.schedule_id), 2);
});

test('due dates follow Manila time, not UTC', async () => {
  const monthly = ok(await owner.post('/api/maintenance-schedules', { property_id: prop.property_id, title: 'Gutter clean', every_n: 1, every_unit: 'months', next_due: onDay(0, 15), priority: 'medium' }), 201).schedule;
  // 23:30 on 14 March in Manila is still 14 March, so not due.
  await runSchedules(manila(onDay(0, 14), '23:30:00'));
  assert.equal(await nextDue(monthly.schedule_id), onDay(0, 15));
  assert.equal(await requestCount(monthly.schedule_id), 0);
  // 00:30 on 15 March in Manila is due (still 14 March in UTC).
  await runSchedules(manila(onDay(0, 15), '00:30:00'));
  assert.equal(await nextDue(monthly.schedule_id), onDay(1, 15));
  assert.equal(await requestCount(monthly.schedule_id), 1);
});

test('a schedule left behind for months catches up with one request, not a backlog', async () => {
  // The API only takes a due date from a year back, so this old date is set directly, as a stale row would be.
  const stale = ok(await owner.post('/api/maintenance-schedules', { property_id: prop.property_id, unit_id: unit.unit_id, title: 'Aircon filter swap', every_n: 30, every_unit: 'days', next_due: today, priority: 'medium' }), 201).schedule;
  // 438 days before 15 March. 30-day steps from there first pass 15 March 12 days later.
  await sql('UPDATE maintenance_schedules SET next_due = $2 WHERE schedule_id = $1', [stale.schedule_id, ical.addDays(NOW_DAY, -438)]);
  assert.equal(await runSchedules(manila(NOW_DAY, '12:00:00')), 1);
  assert.equal(await nextDue(stale.schedule_id), ical.addDays(NOW_DAY, 12), 'first 30-day step after 15 March');
  assert.equal(await requestCount(stale.schedule_id), 1);
});

test('paused and not-yet-due schedules are left alone', async () => {
  const paused = ok(await owner.post('/api/maintenance-schedules', { property_id: prop.property_id, title: 'Paused check', every_n: 1, every_unit: 'months', next_due: onDay(0, 1), priority: 'low' }), 201).schedule;
  ok(await owner.post(`/api/maintenance-schedules/${paused.schedule_id}/pause`));
  const later = ok(await owner.post('/api/maintenance-schedules', { property_id: prop.property_id, title: 'Later check', every_n: 1, every_unit: 'months', next_due: onDay(3, 1), priority: 'low' }), 201).schedule;
  await runSchedules(manila(onDay(0, 20), '09:00:00'));
  assert.equal(await nextDue(paused.schedule_id), onDay(0, 1));
  assert.equal(await requestCount(paused.schedule_id), 0);
  assert.equal(await nextDue(later.schedule_id), onDay(3, 1));
  assert.equal(await requestCount(later.schedule_id), 0);
});

test('schedules on an archived property are not opened', async () => {
  const s = ok(await owner.post('/api/maintenance-schedules', { property_id: prop2.property_id, unit_id: unit2.unit_id, title: 'Grass check', every_n: 1, every_unit: 'months', next_due: onDay(0, 1), priority: 'low' }), 201).schedule;
  ok(await owner.post(`/api/properties/${prop2.property_id}/archive`));
  await runSchedules(manila(onDay(0, 2), '09:00:00'));
  assert.equal(await requestCount(s.schedule_id), 0);
  assert.equal(await nextDue(s.schedule_id), onDay(0, 1));
});

test('next due must be within a year back or five years ahead, on create and on edit', async () => {
  const [{ earliest, latest }] = await sql(`SELECT ((now() AT TIME ZONE 'Asia/Manila')::date - interval '1 year')::date AS earliest,
                                                   ((now() AT TIME ZONE 'Asia/Manila')::date + interval '5 years')::date AS latest`);
  const base = { property_id: prop.property_id, title: 'Range check', every_n: 1, every_unit: 'months', priority: 'low' };
  for (const next_due of [ical.addDays(earliest, -1), ical.addDays(latest, 1)]) {
    const r = await owner.post('/api/maintenance-schedules', { ...base, next_due });
    assert.equal(r.status, 400, next_due);
    assert.match(r.data.fields.next_due, /^Next due must be between /);
  }
  // Both edges are allowed. The old edge is paused at once, so the job never opens a request for it.
  const edgeOld = ok(await owner.post('/api/maintenance-schedules', { ...base, next_due: earliest }), 201).schedule;
  ok(await owner.post(`/api/maintenance-schedules/${edgeOld.schedule_id}/pause`));
  const edgeNew = ok(await owner.post('/api/maintenance-schedules', { ...base, next_due: latest }), 201).schedule;
  const edit = (next_due) => owner.patch(`/api/maintenance-schedules/${edgeNew.schedule_id}`, { next_due });
  assert.equal((await edit(ical.addDays(earliest, -1))).status, 400);
  assert.equal((await edit(ical.addDays(latest, 1))).status, 400);
  assert.equal(ok(await edit(today)).schedule.next_due, today);
});

test('a long-stale schedule jumps to its first step after today, in one go', async () => {
  const overdue = async (every_n, every_unit, from) => {
    const s = ok(await owner.post('/api/maintenance-schedules', { property_id: prop.property_id, title: `Overdue ${every_n} ${every_unit}`, every_n, every_unit, next_due: today, priority: 'low' }), 201).schedule;
    await sql('UPDATE maintenance_schedules SET next_due = $2 WHERE schedule_id = $1', [s.schedule_id, from]);
    return s.schedule_id;
  };
  const weekly = await overdue(7, 'days', ical.addDays(NOW_DAY, -73));
  const quarterly = await overdue(3, 'months', onDay(-9, 10));
  const monthEnd = await overdue(1, 'months', onDay(-2, 31));
  await runSchedules(manila(NOW_DAY, '09:00:00'));
  // 73 days before 15 March, so 77 days on (4 days past 15 March) is the first weekly step after it.
  assert.equal(await nextDue(weekly), ical.addDays(NOW_DAY, 4));
  assert.equal(await requestCount(weekly), 1, 'one request, not a backlog');
  // 3-month steps from 10 June of last year land on 10 March, which is not after today, so the next is 10 June.
  assert.equal(await nextDue(quarterly), onDay(3, 10));
  assert.equal(await requestCount(quarterly), 1);
  // 28 Feb is not after today. The next step keeps the 31st: 31 March, not 28 March.
  assert.equal(await nextDue(monthEnd), onDay(0, 31));
  assert.equal(await requestCount(monthEnd), 1);
});
