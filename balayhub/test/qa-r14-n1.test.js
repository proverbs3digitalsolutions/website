'use strict';

// QA r14 N1: a cleaner moved to another property must not keep the bell alert from the old one.
// The assignment alert was written with no property, and the feed let non-owners read property-less rows.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const feed = require('../src/lib/notifyfeed');
const ical = require('../src/lib/ical');

async function join(base, ownerClient, email, name, role, propertyIds) {
  const inv = await ownerClient.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  const token = decodeURIComponent(inv.data.inviteLink.split('invite=')[1]);
  const c = client(base);
  const s = await c.post('/api/auth/signup', { full_name: name, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: token });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}
const uid = async (email) => (await sql('SELECT user_id FROM users WHERE lower(email) = $1', [email]))[0].user_id;
const rowsFor = (userId) => sql('SELECT * FROM notifications WHERE user_id = $1 ORDER BY notification_id', [userId]);
const list = async (c) => (await c.get('/api/account/notifications')).data;
const prop = (name) => ({ property_name: name, property_type: 'condominium', address: `${name} Ave`, city: 'Taguig', province: 'Metro Manila' });
const d = (n) => ical.addDays(manilaToday(), n);

let srv; let owner; let cleaner; let manager; let propA; let propB; let unitA; let orgId;
let ownerU; let cleanerU; let managerU;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'own-n1@example.com', 'Bell Stays');
  propA = (await owner.post('/api/properties', prop('Azure'))).data.property;
  propB = (await owner.post('/api/properties', prop('Grass'))).data.property;
  unitA = (await owner.post(`/api/properties/${propA.property_id}/units`, { unit_name: 'Paris 1208', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  cleaner = await join(srv.base, owner, 'clean-n1@example.com', 'Cleaner N1', 'cleaner', [propA.property_id]);
  manager = await join(srv.base, owner, 'mgr-n1@example.com', 'Manager N1', 'manager', [propA.property_id]);
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Bell Stays'`))[0].organization_id;
  [ownerU, cleanerU, managerU] = await Promise.all(['own-n1@example.com', 'clean-n1@example.com', 'mgr-n1@example.com'].map(uid));
});
test.after(async () => { await srv.close(); });
test.beforeEach(async () => {
  await sql('DELETE FROM notifications');
  await sql(`UPDATE users SET notify_prefs = '{}'::jsonb`);
  await sql(`UPDATE organizations SET business_type = 'short_term'`);
  await sql('DELETE FROM property_assignments WHERE user_id = $1', [cleanerU]);
  await sql('INSERT INTO property_assignments (user_id, property_id) VALUES ($1, $2)', [cleanerU, propA.property_id]);
});

// An unassigned clean at Azure, then assigned to the cleaner: the PATCH is what raises the alert.
async function assignCleaner() {
  const t = await owner.post('/api/cleaning-tasks', { unit_id: unitA.unit_id, due_date: d(2) });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  const p = await owner.patch(`/api/cleaning-tasks/${t.data.task.task_id}`, { assigned_to: cleanerU });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  // The alert is sent after the reply, so wait for its row.
  for (let i = 0; i < 100 && !(await rowsFor(cleanerU)).length; i++) await new Promise((r) => setTimeout(r, 20));
  return t.data.task;
}

test('1. a cleaner moved to another property no longer sees the clean they were assigned', async () => {
  await assignCleaner();
  assert.deepEqual((await list(cleaner)).items.map((i) => i.title), ['Cleaning assigned to you: Paris 1208']);

  await sql('DELETE FROM property_assignments WHERE user_id = $1', [cleanerU]);
  await sql('INSERT INTO property_assignments (user_id, property_id) VALUES ($1, $2)', [cleanerU, propB.property_id]);
  const after = await list(cleaner);
  assert.deepEqual(after.items, []);
  assert.equal(after.unread, 0);
  assert.equal((await cleaner.get('/api/account/notifications/count')).data.unread, 0);
});

test('2. the assignment alert is written with its property, so the cleaner sees it while assigned there', async () => {
  const task = await assignCleaner();
  const rows = await rowsFor(cleanerU);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].property_id, propA.property_id);
  assert.equal(rows[0].url, `/#/housekeeping/${task.task_id}`);
  assert.equal((await list(cleaner)).items.length, 1);
});

test('3. an alert with no property still shows to the owner, and not to a manager or cleaner', async () => {
  await feed.add(orgId, 'cleaning', [ownerU, managerU, cleanerU], { title: 'No property' });
  assert.deepEqual((await list(owner)).items.map((i) => i.title), ['No property']);
  assert.equal((await list(manager)).items.length, 0);
  assert.equal((await list(cleaner)).items.length, 0);
});
