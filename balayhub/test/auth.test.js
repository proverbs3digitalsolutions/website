'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql } = require('./helpers');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(async () => { await srv.close(); });

test('signup validates input and requires privacy acceptance', async () => {
  const c = client(srv.base);
  let r = await c.post('/api/auth/signup', { full_name: '', email: 'bad', password: 'short', confirm_password: 'x' });
  assert.equal(r.status, 400);
  assert.ok(r.data.fields.full_name && r.data.fields.email && r.data.fields.password);
  r = await c.post('/api/auth/signup', { full_name: 'A', email: 'a@example.com', password: 'longenough1', confirm_password: 'different1', accept_privacy: true });
  assert.equal(r.data.fields.confirm_password, 'Passwords do not match.');
  r = await c.post('/api/auth/signup', { full_name: 'A', email: 'a@example.com', password: 'longenough1', confirm_password: 'longenough1' });
  assert.ok(r.data.fields.accept_privacy);
});

test('full registration flow: signup -> verify -> workspace -> dashboard', async () => {
  const c = client(srv.base);
  const r = await c.post('/api/auth/signup', {
    full_name: 'Jose Rizal', email: 'Jose@Example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.email, 'jose@example.com');
  assert.equal(r.data.user.email_verified, false);
  assert.ok(r.data.devVerificationLink.includes('#/verify?token='));
  const consent = await sql(`SELECT * FROM consent_records`);
  assert.equal(consent.length, 1);

  // Unverified users can't use the workspace.
  let d = await c.get('/api/dashboard');
  assert.equal(d.data.code, 'EMAIL_UNVERIFIED');
  let w = await c.post('/api/workspace', { name: 'Rizal Homes' });
  assert.equal(w.data.code, 'EMAIL_UNVERIFIED');

  const token = decodeURIComponent(r.data.devVerificationLink.split('token=')[1]);
  assert.equal((await c.post('/api/auth/verify-email', { token })).status, 200);
  assert.equal((await c.post('/api/auth/verify-email', { token })).status, 400, 'token is single-use');

  d = await c.get('/api/dashboard');
  assert.equal(d.data.code, 'NO_WORKSPACE');
  w = await c.post('/api/workspace', { name: 'Rizal Homes' });
  assert.equal(w.status, 201);
  d = await c.get('/api/dashboard');
  assert.equal(d.status, 200);
  assert.equal(d.data.portfolio.properties, 0);

  const dup = await client(srv.base).post('/api/auth/signup', {
    full_name: 'X', email: 'jose@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
  });
  assert.equal(dup.status, 409);
});

test('login errors do not reveal whether the account exists', async () => {
  const c = client(srv.base);
  const wrongPw = await c.post('/api/auth/login', { email: 'jose@example.com', password: 'nope-nope-1' });
  const noUser = await c.post('/api/auth/login', { email: 'ghost@example.com', password: 'nope-nope-1' });
  assert.equal(wrongPw.status, 401);
  assert.equal(noUser.status, 401);
  assert.equal(wrongPw.data.error, noUser.data.error);
  const ok = await c.post('/api/auth/login', { email: 'JOSE@example.com', password: 'longenough1' });
  assert.equal(ok.status, 200);
  assert.equal((await c.get('/api/auth/me')).data.user.organization_name, 'Rizal Homes');
  await c.post('/api/auth/logout');
  const me = await c.get('/api/auth/me');
  assert.equal(me.status, 401);
});

test('password reset: generic response, single-use token, old sessions revoked', async () => {
  const c = client(srv.base);
  await c.post('/api/auth/login', { email: 'jose@example.com', password: 'longenough1' });
  const anon = client(srv.base);
  const ghost = await anon.post('/api/auth/forgot-password', { email: 'ghost@example.com' });
  const real = await anon.post('/api/auth/forgot-password', { email: 'jose@example.com' });
  assert.equal(ghost.data.message, real.data.message);
  assert.equal(ghost.data.devResetLink, undefined);
  const token = decodeURIComponent(real.data.devResetLink.split('token=')[1]);
  assert.equal((await anon.post('/api/auth/reset-password', { token, password: 'short' })).status, 400);
  assert.equal((await anon.post('/api/auth/reset-password', { token, password: 'brand-new-pass' })).status, 200);
  assert.equal((await anon.post('/api/auth/reset-password', { token, password: 'brand-new-pass2' })).status, 400);
  const me = await c.get('/api/auth/me');
  assert.equal(me.status, 401);
  assert.equal(me.data.code, 'SESSION_EXPIRED');
  assert.equal((await anon.post('/api/auth/login', { email: 'jose@example.com', password: 'brand-new-pass' })).status, 200);
});

test('mutating requests without the CSRF header are rejected', async () => {
  const r = await fetch(`${srv.base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'jose@example.com', password: 'brand-new-pass' }),
  });
  assert.equal(r.status, 403);
});

test('app code is revalidated on every load so updates show immediately', async () => {
  for (const p of ['/', '/js/app.js', '/css/app.css']) {
    const r = await fetch(srv.base + p);
    assert.equal(r.headers.get('cache-control'), 'no-cache', p);
    assert.ok(r.headers.get('etag'), p);
  }
});
