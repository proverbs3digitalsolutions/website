'use strict';

// QA round 29, CARDLIMIT (CRD-1, D-111): a 429 carries retry_after, and a card-check start that failed only because
// PayMongo couldn't be reached is given back to the start limiter.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_29_cardlimit node --test --test-concurrency=1 test/qa-r29-cardlimit.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* or r2_29_* database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { startServer, ownerAccount } = require('./helpers'); // must load before any ../src module: it points DATABASE_URL at the test DB
const { rateLimit } = require('../src/lib/auth');
const { install } = require('./fakes/paymongo');

const mk = (opts) => {
  const mw = rateLimit({ windowMs: 60000, key: () => 'k', ...opts });
  return (statusCode) => {
    const res = new EventEmitter();
    const sent = [];
    res.set = (...a) => sent.push(a);
    let err = 'unset';
    mw({}, res, (e) => { err = e; });
    if (statusCode && !err) { res.statusCode = statusCode; res.emit('finish'); }
    return { err, sent };
  };
};

test('a 429 carries retry_after and the Retry-After header with the same number', () => {
  const call = mk({ max: 2 });
  call(); call();
  const { err, sent } = call();
  assert.equal(err.status, 429);
  assert.equal(err.extra.code, 'RATE_LIMITED');
  assert.ok(Number.isInteger(err.extra.retry_after) && err.extra.retry_after >= 1 && err.extra.retry_after <= 60);
  assert.deepEqual(sent, [['Retry-After', err.extra.retry_after]]);
});

test('giveBack: a status it accepts is given back, others count', () => {
  const a = mk({ max: 2, giveBack: (s) => s === 503 });
  a(503); a(503);
  assert.equal(a().err, undefined);
  const b = mk({ max: 2, giveBack: (s) => s === 503 });
  b(402); b(402);
  assert.equal(b().err.status, 429);
});

test('failedOnly still gives back a 200 and keeps a 401', () => {
  const a = mk({ max: 2, failedOnly: true });
  a(200); a(200);
  assert.equal(a().err, undefined);
  const b = mk({ max: 2, failedOnly: true });
  b(401); b(401);
  assert.equal(b().err.status, 429);
});

test('billing.js keeps the limit numbers and the failedOnly attach limiters', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/routes/billing.js'), 'utf8');
  const line = (name) => src.split('\n').find((l) => l.startsWith(`const ${name} =`));
  const start = line('cardStartLimiter');
  assert.match(start, /windowMs: 60 \* 60 \* 1000, max: 10/);
  assert.match(start, /giveBack: \(status\) => status === 502 \|\| status === 503/);
  assert.match(line('attachLimiter'), /max: 8, failedOnly: true/);
  assert.match(line('attachIpLimiter'), /failedOnly: true/);
});

test('route: 12 starts that fail at PayMongo do not use up the 10 an hour', async () => {
  const fake = install({ realFetch: globalThis.fetch });
  const srv = await startServer();
  try {
    const A = await ownerAccount(srv.base, 'cl-a@example.com', 'CL Stays A');
    for (let i = 0; i < 12; i++) {
      fake.failNext(/^\/payment_intents$/, 500);
      const r = await A.post('/api/billing/card-check/start', { renewal_plan: 'growth' });
      assert.ok(r.status === 502 || r.status === 503, `start ${i} answered ${r.status}`);
    }
    const ok = await A.post('/api/billing/card-check/start', { renewal_plan: 'growth' });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
  } finally { fake.uninstall(); await srv.close(); }
});
