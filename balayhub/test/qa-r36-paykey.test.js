'use strict';

// QA round 36, lane PAYKEY. A PayMongo key with the right start but stray characters after it is told so, not "it starts with sk_live_ or sk_test_".
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_36_paykey node --test --test-concurrency=1 test/qa-r36-paykey.test.js

const { startServer, sql, ownerAccount } = require('./helpers');
process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const paymongo = require('../src/lib/paymongo');

const SHORT = 'This key is too short. Paste the full Secret key from PayMongo.';
const START = 'Paste the Secret key from PayMongo (it starts with sk_live_ or sk_test_).';
const STRAY = 'A PayMongo key has only letters and numbers after sk_live_ or sk_test_. Copy the Secret key again from your PayMongo dashboard (Developers, API keys).';
const hint = async () => (await sql(`SELECT paymongo_key_hint FROM organizations WHERE name = 'QA r36 paykey Stays'`))[0].paymongo_key_hint;

let srv; let owner; let calls = 0; const realCheck = paymongo.checkKey;
test.before(async () => {
  paymongo.checkKey = async (...a) => { calls++; return realCheck(...a); };
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'paykey@example.com', 'QA r36 paykey Stays');
  const ok = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_1234567890' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  calls = 0;
});
test.after(async () => { paymongo.checkKey = realCheck; await srv.close(); });

test('right start with stray characters gets the stray sentence, saves nothing, never echoes the key, makes no PayMongo call', async () => {
  const before = await hint();
  for (const key of ['sk_test_fake_r36_repro', 'sk_live_abc-defghijkl']) {
    const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: key });
    assert.equal(r.status, 400, key);
    assert.equal(r.data.fields.paymongo_secret_key, STRAY, key);
    assert.ok(!JSON.stringify(r.data).includes(key.slice(8)), 'key text must not come back');
    assert.equal(await hint(), before);
  }
  assert.equal(calls, 0);
});

test('too short keeps the too-short sentence; a wrong start keeps the start sentence', async () => {
  const s = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_abc' });
  assert.equal(s.data.fields.paymongo_secret_key, SHORT);
  for (const key of ['pk_test_abcdefghijkl', 'hello']) {
    const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: key });
    assert.equal(r.status, 400, key);
    assert.equal(r.data.fields.paymongo_secret_key, START, key);
  }
  assert.equal(calls, 0);
});
