'use strict';

process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql } = require('./helpers');

let srv;
let profile;
const realFetch = globalThis.fetch;
// Simulate Google's token and userinfo endpoints; everything else is real.
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://oauth2.googleapis.com/token')) {
    const body = new URLSearchParams(String(opts.body));
    assert.ok(body.get('code_verifier'), 'PKCE verifier sent');
    return new Response(JSON.stringify({ access_token: 'access-123' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.startsWith('https://openidconnect.googleapis.com/v1/userinfo')) {
    return new Response(JSON.stringify(profile), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(url, opts);
};

test.before(async () => { srv = await startServer(); });
test.after(async () => { globalThis.fetch = realFetch; await srv.close(); });

async function googleLogin({ tamperState = false } = {}) {
  const start = await realFetch(`${srv.base}/api/auth/google/start`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const loc = new URL(start.headers.get('location'));
  assert.equal(loc.host, 'accounts.google.com');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  const flowCookie = start.headers.getSetCookie().find((c) => c.startsWith('bh_oauth=')).split(';')[0];
  const state = tamperState ? 'wrong' : loc.searchParams.get('state');
  const cb = await realFetch(`${srv.base}/api/auth/google/callback?code=abc&state=${state}`, { redirect: 'manual', headers: { Cookie: flowCookie } });
  const session = cb.headers.getSetCookie().find((c) => c.startsWith('bh_session=') && !c.startsWith('bh_session=;'));
  return { location: cb.headers.get('location'), session: session && session.split(';')[0] };
}

test('options endpoint advertises Google sign-in', async () => {
  const r = await client(srv.base).get('/api/auth/options');
  assert.equal(r.data.google, true);
});

test('new Google user gets a verified account and a session', async () => {
  profile = { sub: 'g-1', email: 'Host@Example.com', email_verified: true, name: 'Gina Host' };
  const r = await googleLogin();
  assert.equal(r.location, '/#/');
  assert.ok(r.session);
  const me = await realFetch(`${srv.base}/api/auth/me`, { headers: { Cookie: r.session } }).then((x) => x.json());
  assert.equal(me.user.email, 'host@example.com');
  assert.equal(me.user.email_verified, true);
  assert.equal(me.user.organization_id, null);
  const consent = await sql(`SELECT c.* FROM consent_records c JOIN users u USING (user_id) WHERE u.email = 'host@example.com'`);
  assert.equal(consent.length, 1);
});

test('existing password account with the same email is linked, not duplicated', async () => {
  const c = client(srv.base);
  await c.post('/api/auth/signup', { full_name: 'Pat', email: 'pat@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true });
  profile = { sub: 'g-2', email: 'pat@example.com', email_verified: true, name: 'Pat G' };
  const r = await googleLogin();
  assert.ok(r.session);
  const rows = await sql(`SELECT google_sub, email_verified_at FROM users WHERE email = 'pat@example.com'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].google_sub, 'g-2');
  assert.ok(rows[0].email_verified_at);
});

test('state mismatch, unverified Google email and sub mismatch are rejected', async () => {
  profile = { sub: 'g-3', email: 'x@example.com', email_verified: true };
  let r = await googleLogin({ tamperState: true });
  assert.match(r.location, /google_error=expired/);
  assert.equal(r.session, undefined);
  profile = { sub: 'g-4', email: 'unverified@example.com', email_verified: false };
  r = await googleLogin();
  assert.match(r.location, /google_error=email_unverified/);
  profile = { sub: 'g-other', email: 'pat@example.com', email_verified: true };
  r = await googleLogin();
  assert.match(r.location, /google_error=mismatch/);
});
