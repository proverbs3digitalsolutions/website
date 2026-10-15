'use strict';

// QA round 15, lane SV3. #23: a PayMongo key longer than 200 characters is refused with the key's own sentence, and nothing is saved.
// K2 (G3): a balance checkout that PayMongo refuses (401) clears the host's "connected" check; any other PayMongo error leaves it.
// fetch is stubbed (PayMongo only; the test client's own calls pass through): no real network call.
// TEST_DATABASE_URL=... node --test --test-concurrency=1 test/qa-r15-sv3.test.js

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const config = require('../src/config');
const ical = require('../src/lib/ical');

const realFetch = globalThis.fetch;
let mode = 'ok'; // what PayMongo answers: ok (key check and checkout work) | refused (401) | error500
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.paymongo.com/')) return realFetch(url, opts);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (mode === 'refused') return json({ errors: [{ detail: 'Unauthorized' }] }, 401);
  if (mode === 'error500') return json({ errors: [{ detail: 'x' }] }, 500);
  if (opts.method === 'POST' && u.endsWith('/checkout_sessions')) {
    return json({ data: { id: 'cs_sv3test', attributes: { checkout_url: 'https://checkout.paymongo.com/cs_sv3test', status: 'active', payments: [] } } });
  }
  return json({ data: [] });
};

const KEY = 'sk_test_sv3KEY1234567890';
const GUEST_ERROR = "Online payment isn't available right now. Please try again in a few minutes, or contact the host.";
const TOO_LONG = 'This key is too long. Copy the Secret key again from your PayMongo dashboard.';
const org = async () => (await sql(`SELECT paymongo_key_hint, paymongo_key_enc, paymongo_key_checked_at FROM organizations WHERE name = 'SV3 Stays'`))[0];

let srv; let owner; let token;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'sv3@example.com', 'SV3 Stays');
  const p = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const u = (await owner.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const d = (n) => ical.addDays(manilaToday(), n);
  const res = (await owner.post('/api/reservations', { unit_id: u.unit_id, check_in: d(10), check_out: d(12), guest_name: 'Ana Cruz', guest_email: 'ana@example.com' })).data.reservation;
  config.paymongoKeyCheck = 'on';
  mode = 'ok';
  assert.equal((await owner.patch('/api/direct-booking', { paymongo_secret_key: KEY })).status, 200);
  token = (await owner.get(`/api/reservations/${res.booking_id}/payment-link`)).data.link.split('/#/pay/')[1];
  assert.ok(token);
});
test.after(async () => { config.paymongoKeyCheck = 'off'; globalThis.fetch = realFetch; await srv.close(); });

test('a key of 201 characters is refused with the key sentence, and the saved key is unchanged', async () => {
  const before = await org();
  const longKey = `sk_test_${'a'.repeat(193)}`;
  assert.equal(longKey.length, 201);
  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: longKey });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.paymongo_secret_key, TOO_LONG);
  const after = await org();
  assert.equal(after.paymongo_key_hint, before.paymongo_key_hint);
  assert.equal(after.paymongo_key_enc, before.paymongo_key_enc);
});

test('a key of 600 characters gets the same key sentence', async () => {
  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: `sk_test_${'b'.repeat(592)}` });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.paymongo_secret_key, TOO_LONG);
});

test('a key of exactly 200 characters is still accepted', async () => {
  mode = 'ok';
  const key = `sk_test_${'c'.repeat(192)}`;
  assert.equal(key.length, 200);
  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: key });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await org()).paymongo_key_hint, `${key.slice(0, 8)}…${key.slice(-4)}`);
});

test('a balance checkout PayMongo refuses (401) clears the connected check; the guest gets the same sentence', async () => {
  mode = 'ok';
  assert.equal((await owner.patch('/api/direct-booking', { paymongo_secret_key: KEY })).status, 200);
  assert.ok((await org()).paymongo_key_checked_at, 'checked before the checkout');
  mode = 'refused';
  const r = await client(srv.base).post(`/api/public/pay/${token}/checkout`);
  assert.equal(r.status, 502, JSON.stringify(r.data));
  assert.equal(r.data.code, 'PAYMENT_FAILED');
  assert.equal(r.data.error, GUEST_ERROR);
  assert.equal((await org()).paymongo_key_checked_at, null);
  assert.equal((await org()).paymongo_key_hint, 'sk_test_…' + KEY.slice(-4));
});

test('a PayMongo error that is not a refusal (500) leaves the connected check alone', async () => {
  mode = 'ok';
  assert.equal((await owner.patch('/api/direct-booking', { paymongo_secret_key: KEY })).status, 200);
  assert.ok((await org()).paymongo_key_checked_at);
  mode = 'error500';
  const r = await client(srv.base).post(`/api/public/pay/${token}/checkout`);
  assert.equal(r.status, 502, JSON.stringify(r.data));
  assert.equal(r.data.error, GUEST_ERROR);
  assert.ok((await org()).paymongo_key_checked_at, 'still checked');
});
