'use strict';

// QA round 16, lane SVP. K2 (S3): an owner who filters alerts to some properties still hears about alerts that have no property.
// K3: a balance refresh that PayMongo refuses (401) clears the host's "connected" check when the refused key is the current one; the guest's answer is unchanged.
// PayMongo is stubbed (fetch and checkoutStatus) and web push is stubbed: no real network call.
// TEST_DATABASE_URL=... node --test --test-concurrency=1 test/qa-r16-svp.test.js

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const paymongo = require('../src/lib/paymongo');
const push = require('../src/lib/push');

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.paymongo.com/')) return realFetch(url, opts);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (opts.method === 'POST' && u.endsWith('/checkout_sessions')) {
    const id = `cs_${crypto.randomBytes(6).toString('hex')}`;
    return json({ data: { id, attributes: { checkout_url: `https://checkout.paymongo.com/${id}`, status: 'active', payments: [] } } });
  }
  return json({ errors: [{ detail: 'not found' }] }, 404);
};

const realCheckoutStatus = paymongo.checkoutStatus;
let statusError = null; // what PayMongo's status read throws on the next refresh
paymongo.checkoutStatus = async () => { throw statusError; };

const pushed = [];
push.webpush.sendNotification = async (sub) => {
  pushed.push(sub.endpoint);
  return { statusCode: 201 };
};

const prop = (name) => ({ property_name: name, property_type: 'condominium', address: `${name} Ave`, city: 'Taguig', province: 'Metro Manila' });
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/svp-owner-abcdef';
const setPrefs = (prefs) => sql(`UPDATE users SET notify_prefs = $2::jsonb WHERE user_id = $1`, [ownerId, JSON.stringify(prefs)]);
const bellUsers = async (title) => (await sql('SELECT user_id FROM notifications WHERE title = $1', [title])).map((r) => r.user_id);
const payCheck = async () => (await sql(`SELECT paymongo_key_checked_at FROM organizations WHERE name = 'SVP Pay Stays'`))[0].paymongo_key_checked_at;

let srv; let owner; let ownerId; let orgId; let propA; let propB; let token;
let pay; let unitId; let bookingId;
const d = (n) => ical.addDays(manilaToday(), n);
test.before(async () => {
  srv = await startServer();

  owner = await ownerAccount(srv.base, 'svp-push@example.com', 'SVP Push Stays');
  propA = (await owner.post('/api/properties', prop('Azure'))).data.property;
  propB = (await owner.post('/api/properties', prop('Grass'))).data.property;
  const sub = await owner.post('/api/push/subscribe', { subscription: { endpoint: ENDPOINT, keys: { p256dh: 'BPublicKeyValue123', auth: 'authsecret' } } });
  assert.equal(sub.status, 200, JSON.stringify(sub.data));
  const [u] = await sql(`SELECT user_id, organization_id FROM users WHERE lower(email) = 'svp-push@example.com'`);
  ownerId = u.user_id;
  orgId = u.organization_id;

  pay = await ownerAccount(srv.base, 'svp-pay@example.com', 'SVP Pay Stays');
  const p = (await pay.post('/api/properties', prop('Pay'))).data.property;
  unitId = (await pay.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit.unit_id;
  const res = (await pay.post('/api/reservations', { unit_id: unitId, check_in: d(10), check_out: d(12), guest_name: 'Ana Cruz', guest_email: 'ana-svp@example.com' })).data.reservation;
  bookingId = res.booking_id;
  assert.equal((await pay.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_svpKEY1234567890' })).status, 200);
  token = (await pay.get(`/api/reservations/${res.booking_id}/payment-link`)).data.link.split('/#/pay/')[1];
  assert.ok(token);
});
test.after(async () => {
  paymongo.checkoutStatus = realCheckoutStatus;
  globalThis.fetch = realFetch;
  await srv.close();
});

// ---------------------------------------------------------------- K2: push and bell with a property filter
test('allowed() lets an owner with a property filter hear about no property, but not about a property filtered out', () => {
  const user = { role: 'owner', notify_prefs: { property_ids: ['a'] } };
  assert.equal(push.allowed(user, 'cleaning', null), true);
  assert.equal(push.allowed(user, 'cleaning', undefined), true);
  assert.equal(push.allowed(user, 'cleaning', 'b'), false);
});

test('an owner who filters to one property still gets an alert that has no property (push and bell)', async () => {
  await setPrefs({ property_ids: [propA.property_id] });
  pushed.length = 0;
  assert.equal(await push.notify(orgId, 'cleaning', { title: 'SVP no property', body: 'x' }), 1);
  assert.deepEqual(pushed, [ENDPOINT]);
  assert.deepEqual(await bellUsers('SVP no property'), [ownerId]);
});

test('the same owner still gets nothing for a property they filtered out', async () => {
  await setPrefs({ property_ids: [propA.property_id] });
  pushed.length = 0;
  assert.equal(await push.notify(orgId, 'cleaning', { title: 'SVP other property', body: 'x', propertyId: propB.property_id }), 0);
  assert.deepEqual(pushed, []);
  assert.deepEqual(await bellUsers('SVP other property'), []);
  assert.equal(await push.notify(orgId, 'cleaning', { title: 'SVP own property', body: 'x', propertyId: propA.property_id }), 1);
});

test('a type the owner switched off stays off, including for alerts with no property', async () => {
  await setPrefs({ property_ids: [propA.property_id], cleaning: false });
  pushed.length = 0;
  assert.equal(await push.notify(orgId, 'cleaning', { title: 'SVP switched off', body: 'x' }), 0);
  assert.deepEqual(pushed, []);
  assert.deepEqual(await bellUsers('SVP switched off'), []);
});

// ---------------------------------------------------------------- K3: balance refresh and the connected check
test('a balance refresh that PayMongo refuses (401) clears the connected check; the guest gets the same answer', async () => {
  const guest = client(srv.base);
  const c = await guest.post(`/api/public/pay/${token}/checkout`);
  assert.equal(c.status, 200, JSON.stringify(c.data));
  await sql(`UPDATE organizations SET paymongo_key_checked_at = now() WHERE name = 'SVP Pay Stays'`);
  assert.ok(await payCheck(), 'checked before the refresh');

  statusError = Object.assign(new Error('Unauthorized'), { unauthorized: true });
  const r = await guest.post(`/api/public/pay/${token}/refresh`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(Object.keys(r.data).sort(), ['balance', 'paid', 'pending']);
  assert.equal(r.data.paid, false);
  assert.equal(r.data.pending, true);
  assert.equal(await payCheck(), null, 'the refused key is no longer marked as connected');
});

test('a refresh that fails for another reason leaves the connected check alone', async () => {
  await sql(`UPDATE organizations SET paymongo_key_checked_at = now() WHERE name = 'SVP Pay Stays'`);
  statusError = new Error('socket hang up');
  const r = await client(srv.base).post(`/api/public/pay/${token}/refresh`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.paid, false);
  assert.ok(await payCheck(), 'still checked');
});

test('a 401 on a checkout made with an older key leaves the connected check alone', async () => {
  // The host changes keys. The checkout made with the old key is still open, and PayMongo refuses that old key on refresh.
  const open = await sql(`SELECT status, key_enc FROM balance_checkouts WHERE booking_id = $1`, [bookingId]);
  assert.equal(open.length, 1, 'the checkout from the first test is still open');
  assert.equal(open[0].status, 'pending');
  assert.equal((await pay.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_svpKEY9999999999' })).status, 200);
  assert.notEqual((await sql(`SELECT paymongo_key_enc FROM organizations WHERE name = 'SVP Pay Stays'`))[0].paymongo_key_enc, open[0].key_enc, 'the saved key changed');
  await sql(`UPDATE organizations SET paymongo_key_checked_at = now() WHERE name = 'SVP Pay Stays'`);

  statusError = Object.assign(new Error('Unauthorized'), { unauthorized: true });
  const r = await client(srv.base).post(`/api/public/pay/${token}/refresh`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.paid, false);
  assert.ok(await payCheck(), 'the new, working key is not marked unchecked because of an old checkout');
});

test('a 401 on a checkout made with the current key still clears the connected check', async () => {
  const res = (await pay.post('/api/reservations', { unit_id: unitId, check_in: d(30), check_out: d(31), guest_name: 'Ben Cruz', guest_email: 'ben-svp@example.com' })).data.reservation;
  const t = (await pay.get(`/api/reservations/${res.booking_id}/payment-link`)).data.link.split('/#/pay/')[1];
  const c = await client(srv.base).post(`/api/public/pay/${t}/checkout`);
  assert.equal(c.status, 200, JSON.stringify(c.data));
  await sql(`UPDATE organizations SET paymongo_key_checked_at = now() WHERE name = 'SVP Pay Stays'`);

  statusError = Object.assign(new Error('Unauthorized'), { unauthorized: true });
  const r = await client(srv.base).post(`/api/public/pay/${t}/refresh`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.paid, false);
  assert.equal(await payCheck(), null, 'the current key is refused, so it is no longer marked as connected');
});

// ---------------------------------------------------------------- K2 again: the bell's feed and unread count
test('the bell lists and counts an owner\'s alert with no property under a one-property filter, but not the other property', async () => {
  await sql('DELETE FROM notifications WHERE user_id = $1', [ownerId]);
  await setPrefs({ property_ids: [propA.property_id] });
  assert.equal(await push.notify(orgId, 'cleaning', { title: 'SVP feed no property', body: 'x' }), 1);
  assert.equal(await push.notify(orgId, 'cleaning', { title: 'SVP feed own property', body: 'x', propertyId: propA.property_id }), 1);
  // A row for the property the owner filtered out (for example one written before the filter was saved).
  await sql(`INSERT INTO notifications (organization_id, user_id, type, property_id, title, body, url) VALUES ($1, $2, 'cleaning', $3, 'SVP feed other property', 'x', '/#/home')`,
    [orgId, ownerId, propB.property_id]);

  const list = await owner.get('/api/account/notifications');
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.deepEqual(list.data.items.map((i) => i.title).sort(), ['SVP feed no property', 'SVP feed own property']);
  assert.equal(list.data.unread, 2);
  const count = await owner.get('/api/account/notifications/count');
  assert.equal(count.status, 200, JSON.stringify(count.data));
  assert.equal(count.data.unread, 2);
});
