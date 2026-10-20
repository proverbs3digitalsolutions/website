'use strict';

// QA round 21 (ACC): "Notifications on this device" reads On only when this person has a push
// subscription. A saved notification choice (notify_prefs) is not a subscription.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, sql, ownerAccount } = require('./helpers');

const EMAIL = 'acc-r21@example.com';
const sub = (name) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/acc-r21-${name}`, keys: { p256dh: 'BPublicKeyValue123', auth: 'authsecret' } });

let srv; let owner;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, EMAIL, 'ACC R21 Co');
});
test.after(async () => { await srv.close(); });

const profileOn = async (c) => (await c.get('/api/account/profile')).data.user.notifications_on;

test('a saved notification choice alone does not make notifications On', async () => {
  await sql(`UPDATE users SET notify_prefs = '{"mention": true}'::jsonb WHERE email = $1`, [EMAIL]);
  assert.equal(await profileOn(owner), false, 'no push subscription yet');
});

test('a push subscription for this person makes notifications On', async () => {
  assert.equal((await owner.post('/api/push/subscribe', { subscription: sub('owner'), device: 'Chrome on Linux' })).status, 200);
  assert.equal(await profileOn(owner), true);
});

test('removing the last subscription makes notifications Off again', async () => {
  assert.equal((await owner.post('/api/push/unsubscribe', { endpoint: sub('owner').endpoint })).status, 200);
  assert.equal(await profileOn(owner), false);
});

test("another person's subscription does not count", async () => {
  const other = await ownerAccount(srv.base, 'acc-r21-other@example.com', 'ACC R21 Other');
  assert.equal((await other.post('/api/push/subscribe', { subscription: sub('other') })).status, 200);
  assert.equal(await profileOn(owner), false);
  assert.equal(await profileOn(other), true);
});

test('the account page says On only after checking this device', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'account.js'), 'utf8');
  assert.match(src, /pushManager\.getSubscription\(\)/, 'this browser must hold its own push subscription');
  assert.match(src, /u\.notifications_on = u\.notifications_on && await thisDeviceSubscribed\(\);/);
  assert.match(src, /h\('a', \{ class: 'link-tap', href: '#\/settings' \}, u\.notifications_on \? 'On · manage' : 'Turn on'\)/);
});
