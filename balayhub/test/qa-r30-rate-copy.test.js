'use strict';

// QA round 30 RATE-COPY (D-112): the shared limiter's 429 names the real wait, worded the way the card page's rateText does.
// Requires ./helpers before any ../src module, so the test database is the one in TEST_DATABASE_URL.
const { startServer, client } = require('./helpers');

const test = require('node:test');
const assert = require('node:assert/strict');
const { rateLimit } = require('../src/lib/auth');

// One window with one allowed hit: the second hit is the limited one. Both calls run in the same tick,
// so the wait the limiter reports is the whole window.
function limitedHit(windowMs) {
  const limit = rateLimit({ windowMs, max: 1, key: () => 'r30' });
  const headers = {};
  const res = { set: (k, v) => { headers[k] = v; }, on() {} };
  limit({}, res, () => {});
  let err = null;
  limit({}, res, (e) => { err = e; });
  return { err, headers };
}

const CASES = [
  [1, 'Too many tries. Please try again in 1 minute.'],
  [30, 'Too many tries. Please try again in 30 minutes.'],
  [59, 'Too many tries. Please try again in 59 minutes.'],
  [60, 'Too many tries. Please try again in about an hour.'],
  [90, 'Too many tries. Please try again in about 2 hours.'],
  [24 * 60, 'Too many tries. Please try again in about 24 hours.'],
];

for (const [minutes, text] of CASES) {
  test(`a ${minutes} minute window reads "${text}" and keeps the code and Retry-After`, () => {
    const windowMs = minutes * 60 * 1000;
    const { err, headers } = limitedHit(windowMs);
    assert.equal(err.status, 429);
    assert.equal(err.message, text);
    assert.equal(err.extra.code, 'RATE_LIMITED');
    assert.equal(err.extra.retry_after, windowMs / 1000);
    assert.equal(headers['Retry-After'], windowMs / 1000);
  });
}

test('a wait of zero still reads as one minute, never zero minutes', () => {
  const realNow = Date.now;
  Date.now = () => 1_700_000_000_000;
  try {
    const { err } = limitedHit(0);
    assert.equal(err.message, 'Too many tries. Please try again in 1 minute.');
  } finally {
    Date.now = realNow;
  }
});

let srv;
test.before(async () => { srv = await startServer(); });
test.after(async () => { await srv.close(); });

test('sign-in past its 15 minute limit says the wait in the card page words, with the code and Retry-After', async () => {
  let last;
  for (let i = 0; i < 21; i += 1) {
    last = await client(srv.base).post('/api/auth/login', { email: 'rate-r30@example.com', password: 'wrong-password-1' });
  }
  assert.equal(last.status, 429);
  assert.equal(last.data.code, 'RATE_LIMITED');
  assert.equal(last.data.error, 'Too many tries. Please try again in 15 minutes.');
  assert.ok(last.data.retry_after > 0 && last.data.retry_after <= 900);
  assert.equal(Number(last.headers.get('retry-after')), last.data.retry_after);
});
