'use strict';

// QA round 29, CARDSTOP (security follow-up, D-111): a backstop limiter counts every card-check start press, with no
// give-back, so a PayMongo outage can't turn card-check starts into unlimited outbound calls. The 10-an-hour start limiter
// still gives back presses that end 502/503 (see qa-r29-cardlimit.test.js).
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_29_cardstop node --test --test-concurrency=1 test/qa-r29-cardstop.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* or r2_29_* database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ownerAccount } = require('./helpers');
const { install } = require('./fakes/paymongo');

test('billing.js: the every-press backstop is 30 an hour with no give-back, ahead of cardStartLimiter', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/routes/billing.js'), 'utf8');
  const line = src.split('\n').find((l) => l.startsWith('const cardStartAllLimiter ='));
  assert.match(line, /windowMs: 60 \* 60 \* 1000, max: 30, key:/);
  assert.doesNotMatch(line, /giveBack|failedOnly/);
  assert.match(src, /router\.post\('\/billing\/card-check\/start', owners, attachDayGate, cardStartAllLimiter, cardStartLimiter, /);
});

test('route: 30 starts that fail at PayMongo are each 502 or 503, the 31st is a 429 from the backstop and never reaches PayMongo', async () => {
  const fake = install({ realFetch: globalThis.fetch });
  const srv = await startServer();
  try {
    const A = await ownerAccount(srv.base, 'cs-a@example.com', 'CS Stays A');
    for (let i = 0; i < 30; i++) {
      fake.failNext(/^\/payment_intents$/, 500);
      const r = await A.post('/api/billing/card-check/start', { renewal_plan: 'growth' });
      assert.ok([502, 503].includes(r.status), `start ${i} answered ${r.status}`);
    }
    const over = await A.post('/api/billing/card-check/start', { renewal_plan: 'growth' });
    assert.equal(over.status, 429, JSON.stringify(over.data));
    assert.equal(over.data.code, 'RATE_LIMITED');
    assert.ok(Number.isInteger(over.data.retry_after) && over.data.retry_after >= 1 && over.data.retry_after <= 3600);
    assert.equal(fake.calls.filter((c) => c.path === '/payment_intents').length, 30);
  } finally { fake.uninstall(); await srv.close(); }
});
