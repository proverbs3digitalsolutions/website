'use strict';

// QA round 1 (LIM): shared IPs (offices, mobile carriers) must not lock each other out.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SMTP_URL = 'test://';
const { startServer, client } = require('./helpers');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(async () => { await srv.close(); });

const signup = (email) => client(srv.base).post('/api/auth/signup', {
  full_name: 'Limit Test', email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
});

test('successful logins do not use up the per-IP / per-IP+email login limits', async () => {
  assert.equal((await signup('office@example.com')).status, 201);
  for (let i = 0; i < 25; i += 1) {
    const r = await client(srv.base).post('/api/auth/login', { email: 'office@example.com', password: 'longenough1' });
    assert.equal(r.status, 200, `login ${i + 1}`);
  }
});

test('failed logins for one account still hit 429 with the same shape', async () => {
  let last;
  for (let i = 0; i < 21; i += 1) last = await client(srv.base).post('/api/auth/login', { email: 'office@example.com', password: 'wrong-password-1' });
  assert.equal(last.status, 429);
  assert.equal(last.data.code, 'RATE_LIMITED');
  assert.equal(last.data.error ?? last.data.message, 'Too many attempts. Please wait a few minutes and try again.');
  assert.ok(last.headers.get('retry-after'));
  // A different account from the same IP is not locked out.
  assert.equal((await signup('colleague@example.com')).status, 201);
  const ok = await client(srv.base).post('/api/auth/login', { email: 'colleague@example.com', password: 'longenough1' });
  assert.equal(ok.status, 200);
});

test('parallel wrong-password burst is capped; successful logins still never lock out', async () => {
  assert.equal((await signup('burst@example.com')).status, 201);
  const rs = await Promise.all(Array.from({ length: 30 }, () =>
    client(srv.base).post('/api/auth/login', { email: 'burst@example.com', password: 'wrong-password-1' })));
  assert.ok(rs.filter((r) => r.status === 429).length >= 10, 'at least 10 of 30 parallel failures are limited');
  assert.equal((await signup('steady@example.com')).status, 201);
  for (let i = 0; i < 25; i += 1) {
    const r = await client(srv.base).post('/api/auth/login', { email: 'steady@example.com', password: 'longenough1' });
    assert.equal(r.status, 200, `login ${i + 1}`);
  }
});

test('forgot-password: six different emails from one IP all pass', async () => {
  for (let i = 0; i < 6; i += 1) {
    const r = await client(srv.base).post('/api/auth/forgot-password', { email: `person${i}@example.com` });
    assert.equal(r.status, 200, `email ${i}`);
  }
});

test('forgot-password: spam against one email is silent (200, no extra mail), never a 429 for the victim', async () => {
  const { outbox } = require('../src/lib/mailer');
  assert.equal((await signup('victim@example.com')).status, 201);
  outbox.length = 0;
  let last;
  for (let i = 0; i < 6; i += 1) last = await client(srv.base).post('/api/auth/forgot-password', { email: i % 2 ? 'Victim@Example.com' : 'victim@example.com' });
  assert.equal(last.status, 200);
  assert.equal(outbox.filter((m) => m.to === 'victim@example.com').length, 5);
  // The victim, from another IP, is never shown a 429 (and the response is identical).
  const other = await client(srv.base).raw('POST', '/api/auth/forgot-password', { email: 'victim@example.com' }, { 'X-Forwarded-For': '203.0.113.9' });
  assert.equal(other.status, 200);
  assert.equal(outbox.filter((m) => m.to === 'victim@example.com').length, 5);
});

test('signup: every attempt counts, the 11th from one IP in the hour gets 429', async () => {
  // Earlier tests in this file already made several signups from this IP; top up to 10, then expect 429.
  let last;
  for (let i = 0; i < 12; i += 1) {
    last = await signup(`bulk${i}@example.com`);
    if (last.status === 429) break;
  }
  assert.equal(last.status, 429);
  assert.equal(last.data.code, 'RATE_LIMITED');
  assert.ok(last.headers.get('retry-after'));
});
