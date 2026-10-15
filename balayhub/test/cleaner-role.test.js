'use strict';

// Cleaner role (D-48). A cleaner reaches their own cleaning jobs, their own
// account and help, and photo uploads for those jobs. Every other route answers
// 403 CLEANER_FORBIDDEN, including routes that aren't built yet. Staff and
// managers keep their access.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const { cleanerGuard, isCleaner } = require('../src/lib/cleaner');
const push = require('../src/lib/push');

const PASSWORD = 'longenough1';
let srv; let owner; let manager; let staff; let cleaner; let cleanerId;
let prop; let task; let otherTask;

const invite = (email, role, propertyIds) => owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });

// Accepts an invitation through the sign-up form, which also signs the new account in.
async function accept(email, role, propertyIds, fullName) {
  const inv = await invite(email, role, propertyIds);
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', {
    full_name: fullName, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}
const userIdOf = async (c) => (await c.get('/api/auth/me')).data.user.user_id;

// True only when the guard itself refused the request.
const blocked = (r) => r.status === 403 && r.data?.code === 'CLEANER_FORBIDDEN';
const notBlocked = (r, what) => assert.notEqual(r.data?.code, 'CLEANER_FORBIDDEN', `${what}: ${r.status} ${JSON.stringify(r.data)}`);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'cleaner-owner@example.com', 'Cleaner Stays');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const otherProp = (await owner.post('/api/properties', { property_name: 'Grass', property_type: 'condominium', address: 'Project 8 Road', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const otherUnit = (await owner.post(`/api/properties/${otherProp.property_id}/units`, { unit_name: '2F', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  manager = await accept('cleaner-mgr@example.com', 'manager', [prop.property_id], 'Manager Azure');
  staff = await accept('cleaner-staff@example.com', 'staff', [prop.property_id], 'Staff Azure');
  cleaner = await accept('rosa@example.com', 'cleaner', [prop.property_id], 'Aling Rosa');
  cleanerId = await userIdOf(cleaner);
  const t = await owner.post('/api/cleaning-tasks', { unit_id: unit.unit_id, due_date: manilaToday(), assigned_to: cleanerId });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  task = t.data.task;
  const o = await owner.post('/api/cleaning-tasks', { unit_id: otherUnit.unit_id, due_date: manilaToday() });
  assert.equal(o.status, 201, JSON.stringify(o.data));
  otherTask = o.data.task;
});
test.after(async () => { await srv.close(); });

test('only owners invite cleaners, and a cleaner invite needs a property', async () => {
  const none = await invite('nobody@example.com', 'cleaner', []);
  assert.equal(none.status, 400);
  assert.equal(none.data.fields.property_ids, 'Pick at least one property for a cleaner.');
  const byManager = await manager.post('/api/team/invitations', { email: 'nobody@example.com', role: 'cleaner', property_ids: [prop.property_id] });
  assert.equal(byManager.status, 403);
  assert.equal(byManager.data.code, 'FORBIDDEN');
  const ok = await invite('second-cleaner@example.com', 'cleaner', [prop.property_id]);
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.invitation.role, 'cleaner');
  assert.deepEqual(ok.data.invitation.property_ids, [prop.property_id]);
});

test('an invited cleaner is signed in as a cleaner with their property, and can log in again', async () => {
  assert.equal((await cleaner.get('/api/auth/me')).data.user.role, 'cleaner');
  const assigned = await sql('SELECT property_id FROM property_assignments WHERE user_id = $1', [cleanerId]);
  assert.deepEqual(assigned.map((r) => r.property_id), [prop.property_id]);
  const again = client(srv.base);
  const login = await again.post('/api/auth/login', { email: 'rosa@example.com', password: PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.user.role, 'cleaner');
  assert.equal((await again.post('/api/auth/logout')).status, 200);
  assert.equal((await again.get('/api/auth/me')).status, 401);
});

test('changing a member to cleaner needs a property, and a cleaner cannot be left without one', async () => {
  const bench = await accept('bench@example.com', 'staff', [], 'Bench Member');
  const benchId = await userIdOf(bench);
  const none = await owner.patch(`/api/team/members/${benchId}`, { role: 'cleaner' });
  assert.equal(none.status, 400);
  assert.equal(none.data.fields.property_ids, 'Pick at least one property for a cleaner.');
  assert.equal((await sql('SELECT role FROM users WHERE user_id = $1', [benchId]))[0].role, 'staff', 'a refused change leaves the role alone');

  const kept = await accept('bench2@example.com', 'staff', [prop.property_id], 'Bench Two');
  const keptId = await userIdOf(kept);
  const ok = await owner.patch(`/api/team/members/${keptId}`, { role: 'cleaner' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const emptied = await owner.patch(`/api/team/members/${keptId}`, { property_ids: [] });
  assert.equal(emptied.status, 400);
  const back = await owner.patch(`/api/team/members/${keptId}`, { role: 'staff', property_ids: [] });
  assert.equal(back.status, 200, JSON.stringify(back.data));
});

test('a cleaner is refused every route outside the allow-list, including routes that do not exist yet', async () => {
  const reads = [
    '/api/reservations', '/api/guests', '/api/listings', '/api/reports/pnl', '/api/reports/export',
    '/api/payments', '/api/expenses', '/api/unit-owners', '/api/inbox/conversations', '/api/team',
    '/api/workspace/export', '/api/cleaner-pay', '/api/damage-reports', '/api/lost-found', '/api/files',
    '/api/properties', '/api/tenants', '/api/dashboard', '/api/billing', '/api/assistant',
    '/api/cleaning-assignees', '/api/cleaning-checklist', '/api/maintenance', '/api/direct-booking',
    '/api/pricing', '/api/message-templates', '/api/supplies',
  ];
  for (const url of reads) {
    const r = await cleaner.get(url);
    assert.ok(blocked(r), `GET ${url}: ${r.status} ${JSON.stringify(r.data)}`);
  }
  const writes = [
    ['POST', '/api/reservations', {}],
    ['POST', '/api/payments', {}],
    ['POST', '/api/expenses', {}],
    ['POST', '/api/cleaning-tasks', { unit_id: task.unit_id, due_date: manilaToday() }],
    ['PATCH', `/api/cleaning-tasks/${task.task_id}`, { notes: 'changed by a cleaner' }],
    ['POST', '/api/team/invitations', { email: 'x@example.com', role: 'staff', property_ids: [prop.property_id] }],
    ['POST', '/api/workspace/delete', {}],
  ];
  for (const [method, url, body] of writes) {
    const r = await cleaner.raw(method, url, body);
    assert.ok(blocked(r), `${method} ${url}: ${r.status} ${JSON.stringify(r.data)}`);
  }
  const notes = await sql('SELECT notes FROM cleaning_tasks WHERE task_id = $1', [task.task_id]);
  assert.notEqual(notes[0].notes, 'changed by a cleaner');
});

test('a cleaner reaches their own jobs, checklist, status, photos, supplies and account', async () => {
  const list = await cleaner.get('/api/cleaning-tasks?view=all');
  assert.equal(list.status, 200);
  assert.ok(list.data.tasks.some((t) => t.task_id === task.task_id));
  assert.equal((await cleaner.get(`/api/cleaning-tasks/${task.task_id}`)).status, 200);
  const tick = await cleaner.post(`/api/cleaning-tasks/${task.task_id}/checklist`, { index: 0, done: true });
  assert.equal(tick.status, 200, JSON.stringify(tick.data));
  const start = await cleaner.post(`/api/cleaning-tasks/${task.task_id}/status`, { status: 'in_progress' });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  assert.equal((await cleaner.get(`/api/cleaning-tasks/${task.task_id}/supplies`)).status, 200);
  assert.equal((await cleaner.get('/api/auth/me')).status, 200);
  assert.equal((await cleaner.get('/api/account/profile')).status, 200);
  assert.equal((await cleaner.get('/api/push/settings')).status, 200);
  assert.equal((await cleaner.get('/api/support/tickets')).status, 200);
  assert.equal((await cleaner.get('/api/help/articles')).status, 200);
});

test('a cleaner can change a task status but not cancel it', async () => {
  const r = await cleaner.post(`/api/cleaning-tasks/${task.task_id}/status`, { status: 'cancelled' });
  assert.ok(blocked(r), JSON.stringify(r.data));
  assert.notEqual((await sql('SELECT status FROM cleaning_tasks WHERE task_id = $1', [task.task_id]))[0].status, 'cancelled');
});

test('jobs at another property are invisible to a cleaner', async () => {
  const list = await cleaner.get('/api/cleaning-tasks?view=all');
  assert.equal(list.data.tasks.some((t) => t.task_id === otherTask.task_id), false);
  assert.equal((await cleaner.get(`/api/cleaning-tasks/${otherTask.task_id}`)).status, 404);
  assert.equal((await cleaner.post(`/api/cleaning-tasks/${otherTask.task_id}/checklist`, { index: 0, done: true })).status, 404);
  assert.equal((await cleaner.post(`/api/cleaning-tasks/${otherTask.task_id}/status`, { status: 'in_progress' })).status, 404);
});

test('allowed routes that are not built yet are not stopped by the guard', async () => {
  const checks = [
    ['GET', '/api/my-pay'],
    ['GET', '/api/cleaning-calendar'],
    ['GET', '/api/cleaning-board'],
    ['GET', `/api/cleaning-tasks/${task.task_id}/supplies`],
    ['POST', `/api/cleaning-tasks/${task.task_id}/damage`, { description: 'Chipped tile' }],
    ['POST', `/api/cleaning-tasks/${task.task_id}/lost-found`, {}],
    ['POST', `/api/cleaning-tasks/${task.task_id}/supplies`, {}],
    ['POST', `/api/cleaning-tasks/${task.task_id}/work-order`, {}],
    ['GET', `/api/files/${crypto.randomUUID()}`],
    ['POST', `/api/files?record_type=cleaning&record_id=${task.task_id}`],
  ];
  for (const [method, url, body] of checks) notBlocked(await cleaner.raw(method, url, body), `${method} ${url}`);
});

test('the guard matches the allow-list by method, whole segment and case, and only for cleaners', () => {
  const verdict = (method, path, body, role = 'cleaner') => {
    let result = 'passed';
    cleanerGuard({ user: { role }, method, path, body }, null, (err) => { if (err) result = err.extra.code; });
    return result;
  };
  const cases = [
    ['GET', '/cleaning-tasks', undefined, 'passed'],
    ['GET', '/cleaning-tasks/', undefined, 'passed'],
    ['GET', '/CLEANING-TASKS/abc', undefined, 'passed'],
    ['POST', '/cleaning-tasks/abc/status', { status: 'done' }, 'passed'],
    ['POST', '/cleaning-tasks/abc/status', { status: 'cancelled' }, 'CLEANER_FORBIDDEN'],
    ['GET', '/cleaning-tasks/abc/supplies', undefined, 'passed'],
    ['GET', '/supplies', undefined, 'CLEANER_FORBIDDEN'],
    ['POST', '/cleaning-tasks/abc/supplies', {}, 'passed'],
    ['GET', '/cleaning-tasks/abc/supplies/extra', undefined, 'CLEANER_FORBIDDEN'],
    ['POST', '/cleaning-tasks', {}, 'CLEANER_FORBIDDEN'],
    ['PATCH', '/cleaning-tasks/abc', {}, 'CLEANER_FORBIDDEN'],
    ['GET', '/cleaning-tasks/abc/extra', undefined, 'CLEANER_FORBIDDEN'],
    ['GET', '//cleaning-tasks', undefined, 'CLEANER_FORBIDDEN'],
    ['GET', '/', undefined, 'CLEANER_FORBIDDEN'],
    ['GET', '/files', undefined, 'CLEANER_FORBIDDEN'],
    ['DELETE', '/files/abc', undefined, 'CLEANER_FORBIDDEN'],
    ['GET', '/files/abc/raw', undefined, 'CLEANER_FORBIDDEN'],
    ['GET', '/help', undefined, 'passed'],
    ['GET', '/helpers', undefined, 'CLEANER_FORBIDDEN'],
    ['POST', '/account/anything', {}, 'passed'],
    ['POST', '/workspace/delete', {}, 'CLEANER_FORBIDDEN'],
  ];
  for (const [method, path, body, want] of cases) assert.equal(verdict(method, path, body), want, `${method} ${path}`);
  assert.equal(verdict('POST', '/workspace/delete', {}, 'owner'), 'passed');
  assert.equal(verdict('GET', '/reservations', undefined, 'staff'), 'passed');
  assert.equal(isCleaner({ role: 'cleaner' }), true);
  assert.equal(isCleaner({ role: 'staff' }), false);
  assert.equal(isCleaner(undefined), false);
});

test('staff and managers keep their access', async () => {
  assert.equal((await manager.get('/api/reservations')).status, 200);
  assert.equal((await manager.get('/api/payments')).status, 200);
  const team = await manager.get('/api/team');
  assert.equal(team.status, 403);
  assert.equal(team.data.code, 'FORBIDDEN', 'owners only, as before');
  assert.equal((await staff.get('/api/reservations')).status, 200);
  assert.equal((await staff.get('/api/guests')).status, 200);
  assert.equal((await staff.get('/api/cleaning-tasks?view=all')).status, 200);
  assert.equal((await staff.get('/api/auth/me')).data.user.role, 'staff');
});

test('a cleaner gets the cleaning alerts meant for them, and no property-wide ones', async () => {
  const pushed = [];
  push.webpush.sendNotification = async (sub, payload) => { pushed.push(JSON.parse(payload)); return { statusCode: 201 }; };
  assert.deepEqual((await cleaner.get('/api/push/settings')).data.types.map((t) => t.key), ['cleaning']);
  const device = { endpoint: 'https://fcm.googleapis.com/fcm/send/rosa-abcdef', keys: { p256dh: 'BPublicKeyValue123', auth: 'authsecret' } };
  assert.equal((await cleaner.post('/api/push/subscribe', { subscription: device })).status, 200);
  const org = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Cleaner Stays'`))[0].organization_id;
  // The assignment alert goes only to the person assigned (housekeeping sends it with a userId).
  assert.equal(await push.notify(org, 'cleaning', { title: 'Cleaning assigned to you: 1201', body: 'Due today', userId: cleanerId }), 1);
  assert.equal(pushed.at(-1).title, 'Cleaning assigned to you: 1201');
  // Property-wide alerts name owner and manager, so the cleaner is left out.
  pushed.length = 0;
  assert.equal(await push.notify(org, 'cleaning', { title: 'Cleaning done: 1201', body: 'x', propertyId: prop.property_id, roles: ['owner', 'manager'] }), 0);
  assert.equal(pushed.length, 0);
});
