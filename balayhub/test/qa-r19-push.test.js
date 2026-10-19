'use strict';

// QA round 19, PUSH (finding 1). The device notification settings list every type the person can
// receive (mentions, assigned conversations, calendar sync problems and unit-owner activity included),
// and a type switched off is never sent to that person: not by phone, not to the bell, not by email.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const push = require('../src/lib/push');
const notify = require('../src/lib/notify');
const synchealth = require('../src/lib/synchealth');

const sent = [];
push.webpush.sendNotification = async (sub, payload) => { sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); return { statusCode: 201 }; };
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/owner-r19push', keys: { p256dh: 'BPublicKeyValue123', auth: 'authsecret' } };

let srv; let owner; let manager; let staff; let propId; let orgId; let ownerId;

async function join(base, ownerClient, email, name, role, propertyIds) {
  const inv = await ownerClient.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  const c = client(base);
  const s = await c.post('/api/auth/signup', { full_name: name, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'own-r19push@example.com', 'Push Alerts');
  await sql(`UPDATE organizations SET business_type = 'short_term' WHERE name = 'Push Alerts'`);
  propId = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Azure Ave', city: 'Taguig', province: 'Metro Manila' })).data.property.property_id;
  manager = await join(srv.base, owner, 'mgr-r19push@example.com', 'Mara Manager', 'manager', [propId]);
  staff = await join(srv.base, owner, 'staff-r19push@example.com', 'Nene Staff', 'staff', [propId]);
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Push Alerts'`))[0].organization_id;
  ownerId = (await sql(`SELECT user_id FROM users WHERE lower(email) = 'own-r19push@example.com'`))[0].user_id;
});
test.after(async () => { await srv.close(); });

test('the device list shows every type the person can receive, in the same order as My account', async () => {
  const ownerTypes = (await owner.get('/api/push/settings')).data.types;
  assert.deepEqual(ownerTypes.map((t) => t.key), Object.keys(push.TYPES));
  assert.deepEqual(ownerTypes.map((t) => t.label), Object.values(push.TYPES).map((t) => t.label));
  assert.ok(ownerTypes.every((t) => t.on === true), 'every type starts on');
  assert.deepEqual(ownerTypes.map((t) => t.key), Object.keys((await owner.get('/api/account/notify-prefs')).data.types));

  const managerKeys = (await manager.get('/api/push/settings')).data.types.map((t) => t.key);
  assert.deepEqual(managerKeys, Object.keys(push.TYPES).filter((key) => push.TYPES[key].roles.includes('manager')));
  for (const key of ['mention', 'assignment', 'sync_problem']) assert.ok(managerKeys.includes(key), key);
  assert.equal(managerKeys.includes('owner_activity'), false, 'unit owner activity is for owners only');

  assert.deepEqual((await staff.get('/api/push/settings')).data.types.map((t) => t.key), ['cleaning']);
});

// The four types the list was missing, each sent by the code that really sends it.
const alerts = {
  mention: () => notify.notifyUser(orgId, ownerId, 'mention', { title: 'Mara Manager mentioned you', body: 'Check the unit', url: '/#/inbox/1', propertyId: propId }),
  assignment: () => notify.notifyUser(orgId, ownerId, 'assignment', { title: 'Mara Manager assigned you a conversation', body: 'Ana · Azure', url: '/#/inbox/1', propertyId: propId }),
  sync_problem: () => synchealth.alertPeople(orgId, propId, { title: "Azure calendar hasn't updated in BalayHub", body: 'Azure: the calendar is stale', url: '/#/listings' }),
  owner_activity: () => push.notify(orgId, 'owner_activity', { title: 'Unit owner blocked dates', body: 'Azure: 1 Nov to 2 Nov', url: '/#/calendar', propertyId: propId }),
};

// Runs one alert and counts what the owner received: phone alerts and bell rows of that type.
async function alertReach(type) {
  sent.length = 0;
  await sql('DELETE FROM notifications WHERE user_id = $1', [ownerId]);
  await alerts[type]();
  const [{ n: bell }] = await sql('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND type = $2', [ownerId, type]);
  return { phone: sent.filter((s) => s.tag === type).length, bell };
}

test('a type switched off on the device list is not sent to that person, and switching it on sends it again', async () => {
  assert.equal((await owner.post('/api/push/subscribe', { subscription, device: 'Chrome on Android' })).status, 200);
  for (const type of Object.keys(alerts)) {
    assert.equal((await owner.patch('/api/push/settings', { [type]: false })).status, 200, type);
    assert.deepEqual(await alertReach(type), { phone: 0, bell: 0 }, `${type} while switched off`);
    assert.equal((await owner.patch('/api/push/settings', { [type]: true })).status, 200, type);
    assert.deepEqual(await alertReach(type), { phone: 1, bell: 1 }, `${type} while switched on`);
  }
});

test('a type switched off is not emailed either, when the person has no device', async () => {
  await sql('DELETE FROM push_subscriptions WHERE user_id = $1', [ownerId]);
  await owner.patch('/api/push/settings', { mention: false });
  assert.equal(await notify.notifyUser(orgId, ownerId, 'mention', { title: 'Mara mentioned you', body: 'Check', propertyId: propId }), false, 'off: no email');
  await owner.patch('/api/push/settings', { mention: true });
  assert.equal(await notify.notifyUser(orgId, ownerId, 'mention', { title: 'Mara mentioned you', body: 'Check', propertyId: propId }), true, 'on: the email goes out');
});

test('a manager cannot switch an owner-only type, and nothing is saved', async () => {
  const r = await manager.patch('/api/push/settings', { owner_activity: false });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.types, 'Choose on or off for each notification you can receive.');
  const [{ notify_prefs: prefs }] = await sql('SELECT notify_prefs FROM users WHERE lower(email) = $1', ['mgr-r19push@example.com']);
  assert.equal('owner_activity' in prefs, false);
});
