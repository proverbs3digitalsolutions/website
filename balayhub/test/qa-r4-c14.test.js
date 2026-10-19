'use strict';

// QA round 4, lane C14 (notify-types): every notification type is about stays, so a
// long-term workspace is offered none of them. Short-term and both-type workspaces keep theirs.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const push = require('../src/lib/push');

const TYPE_KEYS = ['new_booking', 'guest_message', 'checkin_form', 'payment', 'cleaning', 'mention', 'assignment', 'sync_problem', 'owner_activity'];

let srv; let shortOwner; let longOwner; let longCleaner; let bothOwner;

test.before(async () => {
  srv = await startServer();
  shortOwner = await ownerAccount(srv.base, 'c14-short@example.com', 'Short Co');
  longOwner = await ownerAccount(srv.base, 'c14-long@example.com', 'Long Co');
  await longOwner.patch('/api/workspace', { business_type: 'long_term' });
  bothOwner = await ownerAccount(srv.base, 'c14-both@example.com', 'Both Co');
  await bothOwner.patch('/api/workspace', { business_type: 'both' });

  const prop = (await longOwner.post('/api/properties', { property_name: 'Condo Long', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const inv = await longOwner.post('/api/team/invitations', { email: 'c14-cleaner@example.com', role: 'cleaner', property_ids: [prop.property_id] });
  longCleaner = client(srv.base);
  const s = await longCleaner.post('/api/auth/signup', {
    full_name: 'Nene Cleaner', email: 'c14-cleaner@example.com', password: 'longenough1', confirm_password: 'longenough1',
    accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
});
test.after(async () => { await srv.close(); });

test('a long-term owner is offered no notification types in My account', async () => {
  const r = await longOwner.get('/api/account/notify-prefs');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.types, {});
  assert.deepEqual(r.data.labels, {});
});

test('a long-term owner cannot switch on a stay-only type', async () => {
  const r = await longOwner.patch('/api/account/notify-prefs', { types: { new_booking: true } });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.types, 'Choose on or off for each notification you can receive.');
  const { notify_prefs: prefs } = (await sql('SELECT notify_prefs FROM users WHERE email = $1', ['c14-long@example.com']))[0];
  assert.equal(prefs.new_booking, undefined, 'nothing is saved');
});

test('the device notification list is empty for a long-term workspace', async () => {
  assert.deepEqual((await longOwner.get('/api/push/settings')).data.types, []);
});

test('a long-term cleaner gets no notification types either', async () => {
  const r = await longCleaner.get('/api/account/notify-prefs');
  assert.equal(r.status, 200, 'cleaners can still open their notification settings');
  assert.deepEqual(r.data.types, {});
});

test('short-term and both-type workspaces keep every type their role can receive', async () => {
  for (const owner of [shortOwner, bothOwner]) {
    assert.deepEqual(Object.keys((await owner.get('/api/account/notify-prefs')).data.types), TYPE_KEYS);
  }
  assert.equal((await shortOwner.get('/api/push/settings')).data.types.length, 9);
  assert.equal((await shortOwner.patch('/api/account/notify-prefs', { types: { new_booking: false } })).status, 200);
});

test('switching the workspace back to short-term brings the types back', async () => {
  await longOwner.patch('/api/workspace', { business_type: 'short_term' });
  assert.deepEqual(Object.keys((await longOwner.get('/api/account/notify-prefs')).data.types), TYPE_KEYS);
  await longOwner.patch('/api/workspace', { business_type: 'long_term' });
});

test('every notification type is tagged as a stay type', () => {
  assert.deepEqual(Object.values(push.TYPES).map((t) => t.module), TYPE_KEYS.map(() => 'stay'));
});
