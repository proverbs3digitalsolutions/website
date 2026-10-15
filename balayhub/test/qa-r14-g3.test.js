'use strict';

// QA round 14, lane G3. #34: a PayMongo key is checked with PayMongo, never assumed.
// fetch is stubbed (PayMongo only; the test client's own calls pass through): no real network call.
// TEST_DATABASE_URL=... node --test --test-concurrency=1 test/qa-r14-g3.test.js

process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const config = require('../src/config');
const paymongo = require('../src/lib/paymongo');

const realFetch = globalThis.fetch;
let mode = 'ok'; // what PayMongo answers: ok | rejected | error500 | throw
let calls = 0;
globalThis.fetch = async (url, opts = {}) => {
  if (!String(url).startsWith('https://api.paymongo.com/')) return realFetch(url, opts);
  calls += 1;
  if (mode === 'throw') throw new Error('network down');
  const status = { ok: 200, rejected: 401, error500: 500 }[mode];
  return new Response(JSON.stringify(status === 200 ? { data: [] } : { errors: [{ detail: 'x' }] }), { status, headers: { 'content-type': 'application/json' } });
};

const KEY = 'sk_test_g3KEY1234567890';
let srv; let owner; let prop;
const org = async () => (await sql(`SELECT paymongo_key_enc, paymongo_key_hint, paymongo_key_checked_at, booking_enabled FROM organizations WHERE name = 'G3 Stays'`))[0];

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'g3@example.com', 'G3 Stays');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Paris', unit_type: 'studio', nightly_rate: '2500', max_guests: 4, bookable_online: true });
  config.paymongoKeyCheck = 'on';
});
test.after(async () => { config.paymongoKeyCheck = 'off'; globalThis.fetch = realFetch; await srv.close(); });

test('the check is off in tests unless a test turns it on (no network)', async () => {
  const saved = config.paymongoKeyCheck;
  config.paymongoKeyCheck = 'off';
  calls = 0;
  assert.equal(await paymongo.checkKey(KEY), 'unreachable');
  assert.equal(calls, 0);
  config.paymongoKeyCheck = saved;
});

test('checkKey maps 200, 401, 500 and a thrown error', async () => {
  for (const [m, want] of [['ok', 'ok'], ['rejected', 'rejected'], ['error500', 'unreachable'], ['throw', 'unreachable']]) {
    mode = m;
    assert.equal(await paymongo.checkKey(KEY), want, m);
  }
});

test('PATCH with a key PayMongo refuses: 400 with the field sentence, nothing saved', async () => {
  mode = 'rejected';
  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: KEY });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.fields.paymongo_secret_key, /^PayMongo didn't accept this key\. Copy the Secret key again/);
  const o = await org();
  assert.equal(o.paymongo_key_hint, null);
  assert.equal(o.paymongo_key_enc, null);
});

test('PATCH with a key PayMongo accepts: connected and checked', async () => {
  mode = 'ok';
  assert.equal((await owner.patch('/api/direct-booking', { paymongo_secret_key: KEY })).status, 200);
  const s = (await owner.get('/api/direct-booking')).data;
  assert.equal(s.paymongo_connected, true);
  assert.equal(s.paymongo_checked, true);
  assert.ok((await org()).paymongo_key_checked_at);
});

test('disconnect clears the check', async () => {
  assert.equal((await owner.patch('/api/direct-booking', { disconnect_paymongo: true })).status, 200);
  const s = (await owner.get('/api/direct-booking')).data;
  assert.equal(s.paymongo_connected, false);
  assert.equal(s.paymongo_checked, false);
  assert.equal((await org()).paymongo_key_checked_at, null);
});

test('PayMongo unreachable: the key is saved but not checked', async () => {
  mode = 'throw';
  assert.equal((await owner.patch('/api/direct-booking', { paymongo_secret_key: KEY })).status, 200);
  const s = (await owner.get('/api/direct-booking')).data;
  assert.equal(s.paymongo_connected, true);
  assert.equal(s.paymongo_checked, false);
});

test('turning on with an unchecked key: asks when unreachable, refuses when rejected, goes on when ok', async () => {
  mode = 'throw';
  const a = await owner.patch('/api/direct-booking', { enabled: true });
  assert.equal(a.status, 409);
  assert.equal(a.data.code, 'PAYMONGO_UNCHECKED');
  assert.equal((await org()).booking_enabled, false);
  mode = 'rejected';
  const b = await owner.patch('/api/direct-booking', { enabled: true, confirm_unchecked_key: true });
  assert.equal(b.status, 409);
  assert.equal(b.data.code, 'PAYMONGO_REJECTED');
  mode = 'throw';
  const c = await owner.patch('/api/direct-booking', { enabled: true, confirm_unchecked_key: true });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal((await org()).booking_enabled, true);
  assert.equal((await org()).paymongo_key_checked_at, null);
  // Off, then on again with PayMongo answering: the check is stored.
  await owner.patch('/api/direct-booking', { enabled: false });
  mode = 'ok';
  assert.equal((await owner.patch('/api/direct-booking', { enabled: true })).status, 200);
  assert.ok((await org()).paymongo_key_checked_at);
});

test('the migration adds the column', () => {
  const sqlText = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '034_paymongo_key_check.sql'), 'utf8');
  assert.match(sqlText, /ADD COLUMN IF NOT EXISTS paymongo_key_checked_at timestamptz/);
});
