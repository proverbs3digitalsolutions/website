'use strict';

// QA round 31, CARDWAIT (CARD-1, the "longest wait first" rule): a card-check start that the day's attach limit would
// refuse is answered first, with that limit's own wait. It starts nothing and counts nothing. When two limits both refuse,
// the longer wait is the one said.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_31_cardwait node --test --test-concurrency=1 test/qa-r31-cardwait.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use an r2_31_* database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers'); // must load before any ../src module: it points DATABASE_URL at the test DB
const { install, TEST_CARDS } = require('./fakes/paymongo');
const { rateLimit } = require('../src/lib/auth');

const HOUR = 60 * 60 * 1000;
const card = (number) => ({ card_number: number, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });
const declined = () => fake.createPaymentMethod(card(TEST_CARDS.declined));
const cardRows = async (name) => (await sql(
  `SELECT count(*)::int AS n FROM billing_payments b JOIN organizations o ON o.organization_id = b.organization_id
    WHERE o.name = $1 AND b.kind = 'card_check'`, [name]))[0].n;

// One press that the limiter lets through or refuses. Returns the refusal, or undefined when it passed.
const press = (limiter) => {
  let err;
  limiter({}, { set() {}, on() {} }, (e) => { err = e; });
  return err;
};

let srv; let fake;

test.before(async () => {
  fake = install({ realFetch: globalThis.fetch });
  srv = await startServer();
});
test.after(async () => { fake.uninstall(); await srv.close(); });

test('blockedFor gives the seconds a full limit would refuse for, and counts nothing', () => {
  const limiter = rateLimit({ windowMs: 60000, key: () => 'k', max: 2 });
  assert.equal(limiter.blockedFor({}), 0);
  assert.equal(press(limiter), undefined); // count 1
  for (let i = 0; i < 5; i += 1) assert.equal(limiter.blockedFor({}), 0); // asking does not count
  assert.equal(press(limiter), undefined); // count 2: the limit is now full
  for (let i = 0; i < 5; i += 1) assert.ok(limiter.blockedFor({}) >= 59); // asking does not reset it either
  assert.equal(press(limiter).status, 429);
});

test('blockedFor is 0 once the window has passed', async () => {
  const limiter = rateLimit({ windowMs: 20, key: () => 'k', max: 1 });
  assert.equal(press(limiter), undefined);
  assert.ok(limiter.blockedFor({}) > 0);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(limiter.blockedFor({}), 0);
  assert.equal(press(limiter), undefined);
});

test('a start the day limit would refuse gets the day wait, and starts nothing', async () => {
  const A = await ownerAccount(srv.base, 'cw-a@example.com', 'CW Stays A');
  for (let i = 0; i < 8; i += 1) {
    const s = await A.post('/api/billing/card-check/start', { renewal_plan: 'growth' });
    assert.equal(s.status, 200, JSON.stringify(s.data));
    assert.equal((await A.post(`/api/billing/card-check/${s.data.billing_id}/attach`, { payment_method_id: declined() })).status, 402);
  }
  const before = await cardRows('CW Stays A');
  for (let press9 = 9; press9 <= 11; press9 += 1) {
    const r = await A.post('/api/billing/card-check/start', { renewal_plan: 'growth' });
    assert.equal(r.status, 429, `press ${press9} answered ${r.status}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.code, 'RATE_LIMITED');
    assert.equal(r.data.error, 'Too many tries. Please try again in about 24 hours.');
    assert.ok(r.data.retry_after > HOUR / 1000 && r.data.retry_after <= 24 * 3600, `retry_after ${r.data.retry_after}`);
    assert.equal(r.headers.get('retry-after'), String(r.data.retry_after));
  }
  assert.equal(await cardRows('CW Stays A'), before, 'a refused press started a payment');
});

test('when the day limit and the hourly start limit both refuse, the longer wait is the one said', async () => {
  const B = await ownerAccount(srv.base, 'cw-b@example.com', 'CW Stays B');
  // Move the rate limiters' clock on by 23 hours 30 minutes: the day limit (opened at the first decline) has 30 minutes left,
  // and the hourly start limit, opened by the first start after the move, has a full hour left.
  const realNow = Date.now;
  let shift = 0;
  Date.now = () => realNow() + shift;
  try {
    for (let i = 0; i < 7; i += 1) {
      const s = await B.post('/api/billing/card-check/start', { renewal_plan: 'growth' });
      assert.equal(s.status, 200, JSON.stringify(s.data));
      assert.equal((await B.post(`/api/billing/card-check/${s.data.billing_id}/attach`, { payment_method_id: declined() })).status, 402);
    }
    shift = 23.5 * HOUR;
    const ids = [];
    for (let i = 0; i < 10; i += 1) {
      const s = await B.post('/api/billing/card-check/start', { renewal_plan: 'growth' });
      assert.equal(s.status, 200, JSON.stringify(s.data));
      ids.push(s.data.billing_id);
    }
    assert.equal((await B.post(`/api/billing/card-check/${ids[0]}/attach`, { payment_method_id: declined() })).status, 402);
    const r = await B.post('/api/billing/card-check/start', { renewal_plan: 'growth' });
    assert.equal(r.status, 429, JSON.stringify(r.data));
    assert.equal(r.data.error, 'Too many tries. Please try again in about an hour.');
    assert.ok(r.data.retry_after >= 3500 && r.data.retry_after <= 3600, `retry_after ${r.data.retry_after}`);
  } finally {
    Date.now = realNow;
  }
});
