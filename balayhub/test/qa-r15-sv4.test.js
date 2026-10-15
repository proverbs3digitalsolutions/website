'use strict';

// QA round 15 SV4 (K9): an alert with no property goes to the owners only, the same rule as the
// bell (D-93). A named person still gets one, and a property alert still reaches the people assigned to it.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const push = require('../src/lib/push');

const pushed = [];
push.webpush.sendNotification = async (sub) => {
  pushed.push(sub.endpoint);
  return { statusCode: 201 };
};

const prop = (name) => ({ property_name: name, property_type: 'condominium', address: `${name} Ave`, city: 'Taguig', province: 'Metro Manila' });
const uid = async (email) => (await sql('SELECT user_id FROM users WHERE lower(email) = $1', [email]))[0].user_id;
const sorted = (xs) => [...xs].sort();
const bellUsers = async (title) => sorted((await sql('SELECT user_id FROM notifications WHERE title = $1', [title])).map((r) => r.user_id));

// Subscribe this person's device. Returns the user id and the endpoint the push stub records.
async function device(c, email) {
  const endpoint = `https://fcm.googleapis.com/fcm/send/${email.split('@')[0]}-abcdef`;
  const sub = await c.post('/api/push/subscribe', { subscription: { endpoint, keys: { p256dh: 'BPublicKeyValue123', auth: 'authsecret' } } });
  assert.equal(sub.status, 200, JSON.stringify(sub.data));
  return { id: await uid(email), endpoint };
}

async function join(base, ownerClient, { email, name, role, propertyIds }) {
  const inv = await ownerClient.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  const c = client(base);
  const s = await c.post('/api/auth/signup', { full_name: name, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return device(c, email);
}

let srv; let orgId; let propA; let propB;
const who = {};

test.before(async () => {
  srv = await startServer();
  const owner = await ownerAccount(srv.base, 'own-sv4@example.com', 'Push Guard Stays');
  propA = (await owner.post('/api/properties', prop('Azure'))).data.property;
  propB = (await owner.post('/api/properties', prop('Grass'))).data.property;
  who.owner = await device(owner, 'own-sv4@example.com');
  who.manager = await join(srv.base, owner, { email: 'mgr-sv4@example.com', name: 'Manager SV4', role: 'manager', propertyIds: [propA.property_id] });
  who.manager2 = await join(srv.base, owner, { email: 'mgr2-sv4@example.com', name: 'Manager Two SV4', role: 'manager', propertyIds: [propB.property_id] });
  who.staff = await join(srv.base, owner, { email: 'staff-sv4@example.com', name: 'Staff SV4', role: 'staff', propertyIds: [propA.property_id] });
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Push Guard Stays'`))[0].organization_id;
});
test.after(async () => { await srv.close(); });
test.beforeEach(() => { pushed.length = 0; });

test('1. an alert with no property goes to owners only, as a bell row and as a push', async () => {
  const n = await push.notify(orgId, 'cleaning', { title: 'Property-less SV4', body: 'x' });
  assert.equal(n, 1, 'managers and staff are not told about a property-less alert');
  assert.deepEqual(pushed, [who.owner.endpoint]);
  assert.deepEqual(await bellUsers('Property-less SV4'), [who.owner.id]);
});

test('2. an explicit null property is treated the same as none', async () => {
  assert.equal(await push.notify(orgId, 'cleaning', { title: 'Null property SV4', body: 'x', propertyId: null }), 1);
  assert.deepEqual(pushed, [who.owner.endpoint]);
  assert.deepEqual(await bellUsers('Null property SV4'), [who.owner.id]);
});

test('3. a property-less alert that names one person still reaches that person', async () => {
  assert.equal(await push.notify(orgId, 'cleaning', { title: 'Named SV4', body: 'x', userId: who.staff.id }), 1);
  assert.deepEqual(pushed, [who.staff.endpoint]);
  assert.deepEqual(await bellUsers('Named SV4'), [who.staff.id]);
});

test('4. a property alert reaches the owner and the people assigned to that property, not the others', async () => {
  assert.equal(await push.notify(orgId, 'cleaning', { title: 'Azure SV4', body: 'x', propertyId: propA.property_id }), 3);
  assert.deepEqual(sorted(pushed), sorted([who.owner.endpoint, who.manager.endpoint, who.staff.endpoint]));
  assert.deepEqual(await bellUsers('Azure SV4'), sorted([who.owner.id, who.manager.id, who.staff.id]));
  assert.ok(!(await bellUsers('Azure SV4')).includes(who.manager2.id), 'a manager of another property is not told');
});
