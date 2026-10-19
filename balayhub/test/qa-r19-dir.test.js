'use strict';

// QA round 19, lane DIR. A PayMongo key with the right start but cut short gets "This key is too short..."; a wrong start keeps the start sentence.
// No PayMongo call here: the key check is off in tests, so a key of the right shape is saved without a network call.
// TEST_DATABASE_URL=... node --test --test-concurrency=1 test/qa-r19-dir.test.js

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');

const SHORT = 'This key is too short. Paste the full Secret key from PayMongo.';
const START = 'Paste the Secret key from PayMongo (it starts with sk_live_ or sk_test_).';
const hint = async () => (await sql(`SELECT paymongo_key_hint FROM organizations WHERE name = 'DIR Stays'`))[0].paymongo_key_hint;

let srv; let owner;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'dir@example.com', 'DIR Stays');
});
test.after(async () => { await srv.close(); });

test('a test key with the right start but 3 characters after it gets the too-short sentence and nothing is saved', async () => {
  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_abc' });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.paymongo_secret_key, SHORT);
  assert.equal(await hint(), null);
});

test('a live key cut short gets the too-short sentence, not the start sentence', async () => {
  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_live_fake' });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.paymongo_secret_key, SHORT);
});

test('nine characters after the start is still too short; ten is the least a key may have', async () => {
  const nine = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_123456789' });
  assert.equal(nine.status, 400, JSON.stringify(nine.data));
  assert.equal(nine.data.fields.paymongo_secret_key, SHORT);
  const ten = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_1234567890' });
  assert.equal(ten.status, 200, JSON.stringify(ten.data));
  assert.equal(await hint(), 'sk_test_…7890');
});

test('a key with a wrong start keeps the start sentence, short or not', async () => {
  for (const key of ['pk_test_wrongkind', 'sk_prod_abcdefghijkl', 'sk_abc']) {
    const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: key });
    assert.equal(r.status, 400, key);
    assert.equal(r.data.fields.paymongo_secret_key, START, key);
  }
});
