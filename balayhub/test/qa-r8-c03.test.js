'use strict';

// QA round 8, lane C03 (member-audit). An edit to team access, my profile or notification settings writes an
// activity row only when something really changed, and names only the fields that changed, never their values.
// #61: PATCH /team/members/:id. #62: PATCH /account/profile and PATCH /account/notify-prefs. #64: PATCH /push/settings.
// node --test --test-concurrency=1 test/qa-r8-c03.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');

let srv; let owner; let mara; let nene; let maraId; let neneId; let ownerId; let propA; let propB;

const rowsFor = (userId, action) => sql(
  'SELECT action, details FROM audit_logs WHERE record_id = $1 AND action = $2 ORDER BY audit_id', [userId, action]);

async function invite(email, role, propertyIds, name) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', {
    full_name: name, email, password: 'longenough1', confirm_password: 'longenough1',
    accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}
const userIdOf = async (email) => (await sql('SELECT user_id FROM users WHERE lower(email) = $1', [email]))[0].user_id;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-c03@example.com', 'C03 Co');
  ownerId = await userIdOf('owner-c03@example.com');
  propA = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  propB = (await owner.post('/api/properties', { property_name: 'Grass', property_type: 'condominium', address: 'Project 8 Road', city: 'Taguig', province: 'Metro Manila' })).data.property;
  mara = await invite('mara-c03@example.com', 'manager', [propA.property_id, propB.property_id], 'Mara Cruz');
  maraId = await userIdOf('mara-c03@example.com');
  nene = await invite('nene-c03@example.com', 'staff', [propA.property_id, propB.property_id], 'Nene Cruz');
  neneId = await userIdOf('nene-c03@example.com');
});
test.after(async () => { await srv.close(); });

// ---------------------------------------------------------------- #61 team access

test('a member save with the same role and the same properties (in another order) writes nothing (#61)', async () => {
  const r = await owner.patch(`/api/team/members/${neneId}`, { role: 'staff', property_ids: [propB.property_id, propA.property_id] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(await rowsFor(neneId, 'member.updated'), []);
});

test('a properties-only change names only property_ids, and writes no role change (#61)', async () => {
  const r = await owner.patch(`/api/team/members/${neneId}`, { property_ids: [propA.property_id] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rows = await rowsFor(neneId, 'member.updated');
  assert.deepEqual(rows.map((x) => x.details), [{ fields: ['property_ids'] }]);
  const kept = await sql('SELECT property_id FROM property_assignments WHERE user_id = $1', [neneId]);
  assert.deepEqual(kept.map((x) => x.property_id), [propA.property_id]);
});

test('a role-only change names only role, and the properties are left as they are (#61)', async () => {
  const r = await owner.patch(`/api/team/members/${neneId}`, { role: 'cleaner' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rows = await rowsFor(neneId, 'member.updated');
  assert.deepEqual(rows.map((x) => x.details), [{ fields: ['property_ids'] }, { fields: ['role'] }]);
  const kept = await sql('SELECT property_id FROM property_assignments WHERE user_id = $1', [neneId]);
  assert.deepEqual(kept.map((x) => x.property_id), [propA.property_id]);
});

test('a no-change save of a manager with two properties writes nothing (#61)', async () => {
  const r = await owner.patch(`/api/team/members/${maraId}`, { role: 'manager', property_ids: [propA.property_id, propB.property_id] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(await rowsFor(maraId, 'member.updated'), []);
});

// ---------------------------------------------------------------- #62 my profile

test('a profile save with the same name and no phone change writes no row (#62)', async () => {
  const r = await mara.patch('/api/account/profile', { full_name: 'Mara Cruz' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(await rowsFor(maraId, 'user.profile_updated'), []);
});

test('a name change names only full_name, never the name itself (#62)', async () => {
  const r = await mara.patch('/api/account/profile', { full_name: 'Mara Reyes' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rows = await rowsFor(maraId, 'user.profile_updated');
  assert.deepEqual(rows.map((x) => x.details), [{ fields: ['full_name'] }]);
});

test('a mobile number change names only phone; saving it again writes no row (#62)', async () => {
  assert.equal((await mara.patch('/api/account/profile', { full_name: 'Mara Reyes', phone: '0917 123 4567' })).status, 200);
  assert.equal((await mara.patch('/api/account/profile', { full_name: 'Mara Reyes', phone: '0917 123 4567' })).status, 200);
  const rows = await rowsFor(maraId, 'user.profile_updated');
  assert.deepEqual(rows.map((x) => x.details), [{ fields: ['full_name'] }, { fields: ['phone'] }]);
  const me = (await mara.get('/api/account/profile')).data.user;
  assert.equal(me.full_name, 'Mara Reyes');
  assert.equal(me.phone, '0917 123 4567');
});

// ---------------------------------------------------------------- #62 notification types and properties (My account)

test('My account: a type already on, sent as on, writes nothing (#62)', async () => {
  assert.equal((await mara.patch('/api/account/notify-prefs', { types: { new_booking: true } })).status, 200);
  assert.deepEqual(await rowsFor(maraId, 'user.notify_prefs_updated'), []);
});

test('My account: switching one type off names only that type (#62)', async () => {
  const r = await mara.patch('/api/account/notify-prefs', { types: { new_booking: false } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.types.new_booking, false);
  const rows = await rowsFor(maraId, 'user.notify_prefs_updated');
  assert.deepEqual(rows.map((x) => x.details), [{ fields: ['new_booking'] }]);
});

test('My account: a save that repeats stored choices and sets one more type writes only that type (#62)', async () => {
  assert.equal((await mara.patch('/api/account/notify-prefs', { types: { new_booking: false, guest_message: true } })).status, 200);
  assert.equal((await rowsFor(maraId, 'user.notify_prefs_updated')).length, 1, 'nothing new: no row');
  await mara.patch('/api/account/notify-prefs', { types: { guest_message: false, payment: false } });
  const rows = await rowsFor(maraId, 'user.notify_prefs_updated');
  assert.deepEqual(rows.map((x) => x.details), [{ fields: ['new_booking'] }, { fields: ['guest_message', 'payment'] }]);
});

test('My account: a property list in another order is no change; choosing a list is (#62)', async () => {
  // Starts as all properties (null). Choosing both, in any order, is a change; the same two again are not.
  await mara.patch('/api/account/notify-prefs', { property_ids: [propB.property_id, propA.property_id] });
  let rows = await rowsFor(maraId, 'user.notify_prefs_updated');
  assert.deepEqual(rows.at(-1).details, { fields: ['property_ids'] });
  const before = rows.length;
  assert.equal((await mara.patch('/api/account/notify-prefs', { property_ids: [propA.property_id, propB.property_id] })).status, 200);
  rows = await rowsFor(maraId, 'user.notify_prefs_updated');
  assert.equal(rows.length, before, 'the same two properties add no row');
  // Back to every property is a change.
  await mara.patch('/api/account/notify-prefs', { property_ids: null });
  rows = await rowsFor(maraId, 'user.notify_prefs_updated');
  assert.deepEqual(rows.at(-1).details, { fields: ['property_ids'] });
});

test('My account: an empty body writes no row (#62)', async () => {
  const before = (await rowsFor(maraId, 'user.notify_prefs_updated')).length;
  assert.equal((await mara.patch('/api/account/notify-prefs', {})).status, 200);
  assert.equal((await rowsFor(maraId, 'user.notify_prefs_updated')).length, before);
});

// ---------------------------------------------------------------- #64 Settings > App & notifications

test('Settings toggles write an activity row that names the changed type, and none for a repeat (#64)', async () => {
  assert.equal((await owner.patch('/api/push/settings', { new_booking: false })).status, 200);
  let rows = await rowsFor(ownerId, 'user.notify_prefs_updated');
  assert.deepEqual(rows.map((x) => x.details), [{ fields: ['new_booking'] }]);
  // Same choice again, plus a type that is already on: no row.
  assert.equal((await owner.patch('/api/push/settings', { new_booking: false, guest_message: true })).status, 200);
  assert.equal((await rowsFor(ownerId, 'user.notify_prefs_updated')).length, 1);
  assert.equal((await owner.patch('/api/push/settings', { new_booking: true })).status, 200);
  rows = await rowsFor(ownerId, 'user.notify_prefs_updated');
  assert.deepEqual(rows.map((x) => x.details), [{ fields: ['new_booking'] }, { fields: ['new_booking'] }]);
  const types = (await owner.get('/api/push/settings')).data.types;
  assert.equal(types.find((t) => t.key === 'new_booking').on, true);
});

test('Settings toggles keep the same stored choices as before (the setting still reads back)', async () => {
  await owner.patch('/api/push/settings', { payment: false });
  const types = (await owner.get('/api/push/settings')).data.types;
  assert.equal(types.find((t) => t.key === 'payment').on, false);
  assert.equal(types.find((t) => t.key === 'guest_message').on, true);
});
