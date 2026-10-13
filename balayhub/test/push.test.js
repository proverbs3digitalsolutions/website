'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const push = require('../src/lib/push');

const sent = [];
push.webpush.sendNotification = async (sub, payload) => {
  if (sub.endpoint.includes('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
  sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) });
  return { statusCode: 201 };
};
const subscription = (name) => ({ endpoint: `https://push.example.com/send/${name}-abcdef`, keys: { p256dh: 'BPublicKeyValue123', auth: 'authsecret' } });

let srv; let owner; let staff; let prop; let prop2;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Push Stays');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  prop2 = (await owner.post('/api/properties', { property_name: 'Grass', property_type: 'condominium', address: 'Project 8 Road', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const inv = await owner.post('/api/team/invitations', { email: 'cleaner@example.com', role: 'staff', property_ids: [prop.property_id] });
  staff = client(srv.base);
  await staff.post('/api/auth/signup', { full_name: 'Nene Cleaner', email: 'cleaner@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
});
test.after(async () => { await srv.close(); });

test('devices subscribe; settings list only the types for that role', async () => {
  const s = (await owner.get('/api/push/settings')).data;
  assert.ok(s.public_key.length > 40);
  assert.equal(s.types.length, 5);
  assert.deepEqual((await staff.get('/api/push/settings')).data.types.map((t) => t.key), ['cleaning']);
  assert.equal((await owner.post('/api/push/subscribe', { subscription: { endpoint: 'http://insecure', keys: {} } })).status, 400);
  assert.equal((await owner.post('/api/push/subscribe', { subscription: subscription('owner'), device: 'Chrome on Android' })).status, 200);
  assert.equal((await staff.post('/api/push/subscribe', { subscription: subscription('staff') })).status, 200);
  assert.deepEqual((await owner.get('/api/push/settings')).data.devices.map((d) => d.device), ['Chrome on Android']);
  sent.length = 0;
  assert.equal((await owner.post('/api/push/test')).data.sent, 1);
  assert.equal(sent[0].tag, 'test');
});

test('notifications reach the right people, respect preferences and forget dead devices', async () => {
  const org = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Push Stays'`))[0].organization_id;
  sent.length = 0;
  assert.equal(await push.notify(org, 'payment', { title: 'Paid', body: 'x', propertyId: prop.property_id }), 1, 'staff do not get payments');
  assert.equal(await push.notify(org, 'cleaning', { title: 'Clean', body: 'x', propertyId: prop.property_id }), 2);
  assert.equal(await push.notify(org, 'cleaning', { title: 'Clean', body: 'x', propertyId: prop2.property_id }), 1, 'staff only hear about their properties');

  await owner.patch('/api/push/settings', { payment: false });
  assert.equal(await push.notify(org, 'payment', { title: 'Paid', body: 'x' }), 0);
  assert.equal((await owner.get('/api/push/settings')).data.types.find((t) => t.key === 'payment').on, false);

  await owner.post('/api/push/subscribe', { subscription: subscription('gone') });
  await push.notify(org, 'new_booking', { title: 'New', body: 'x' });
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE endpoint LIKE '%gone%'`))[0].n, 0);
});

test('turning off on a device works even when the workspace is read-only', async () => {
  await sql(`UPDATE organizations SET trial_ends_at = now() - interval '1 day' WHERE name = 'Push Stays'`);
  assert.equal((await owner.post('/api/push/unsubscribe', { endpoint: subscription('owner').endpoint })).status, 200);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE endpoint = $1`, [subscription('owner').endpoint]))[0].n, 0);
  // Another user can't remove someone else's device.
  await owner.post('/api/push/unsubscribe', { endpoint: subscription('staff').endpoint });
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE endpoint = $1`, [subscription('staff').endpoint]))[0].n, 1);
});
