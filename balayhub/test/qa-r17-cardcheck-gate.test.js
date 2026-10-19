'use strict';

// Card on file (D-98), lane B2: the gate, workspace creation, CSP, /auth/me.
// Off mode (no public key / CARD_CHECK=off) is proved by re-running this file in a child process.

const OFF = process.env.GATE_OFF === '1';
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';
if (OFF) { delete process.env.PAYMONGO_PUBLIC_KEY; process.env.CARD_CHECK = 'off'; } else { process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x'; delete process.env.CARD_CHECK; }
process.env.PLATFORM_ADMIN_EMAILS = 'boss@example.com';

const fs = require('fs');
const path = require('path');
const Module = require('module');
// Lane B1 (src/lib/cardcheck.js) may not have landed yet: stand in for it here, in the test only.
if (!fs.existsSync(path.join(__dirname, '../src/lib/cardcheck.js'))) {
  const origLoad = Module._load;
  Module._load = function load(request, ...rest) {
    if (/lib\/cardcheck$/.test(request)) {
      const enabled = () => Boolean(process.env.PAYMONGO_SECRET_KEY && process.env.PAYMONGO_PUBLIC_KEY) && process.env.CARD_CHECK !== 'off';
      return { enabled, initialState: (u) => (enabled() && !String(process.env.PLATFORM_ADMIN_EMAILS).includes(u.email) ? 'required' : null) };
    }
    return origLoad.call(this, request, ...rest);
  };
}

const { spawnSync } = require('child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const { planStatus } = require('../src/lib/plans');

let srv;
test.before(async () => {
  if (!OFF) {
    // Off mode first, in its own process, before this process takes the database.
    const r = spawnSync(process.execPath, ['--test', __filename], { env: { ...process.env, GATE_OFF: '1' }, encoding: 'utf8' });
    assert.equal(r.status, 0, `off-mode run failed:\n${r.stdout}\n${r.stderr}`);
  }
  srv = await startServer();
});
test.after(async () => { await srv.close(); });

const PROP = { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' };
const orgOf = (email) => sql('SELECT o.* FROM organizations o JOIN users u USING (organization_id) WHERE u.email = $1', [email]).then((r) => r[0]);

if (OFF) {
  test('card check off: the trial starts at creation, nothing is gated', async () => {
    const c = await ownerAccount(srv.base, 'off@example.com');
    const org = await orgOf('off@example.com');
    assert.equal(org.card_check, null);
    assert.ok(org.trial_ends_at);
    const me = await c.get('/api/auth/me');
    assert.equal(me.data.user.plan.reason, null);
    assert.equal(me.data.user.plan.card_check_due, undefined);
    assert.equal((await c.post('/api/properties', PROP)).status, 201);
  });
} else {
  test('planStatus: required means read-only with no trial clock; others unchanged', () => {
    const s = planStatus({ plan: 'trial', trial_ends_at: null, card_check: 'required' });
    assert.equal(s.reason, 'card_check'); assert.equal(s.read_only, true); assert.equal(s.card_check_due, true);
    assert.equal(s.trial_ends_at, null); assert.equal(s.trial_days_left, 14);
    // Callers that don't load card_check see an un-ended trial (acceptable: a gated workspace has no data).
    assert.equal(planStatus({ plan: 'trial', trial_ends_at: null }).read_only, false);
    assert.equal(planStatus({ plan: 'comped', card_check: 'required' }).read_only, false);
    assert.equal(planStatus({ plan: 'trial', trial_ends_at: new Date(Date.now() + 864e5), card_check: 'passed' }).read_only, false);
  });

  test('a new workspace is gated; writes answer 402, exempt routes work', async () => {
    const c = await ownerAccount(srv.base, 'gated@example.com');
    const org = await orgOf('gated@example.com');
    assert.equal(org.card_check, 'required');
    assert.equal(org.trial_ends_at, null);
    const me = await c.get('/api/auth/me');
    assert.equal(me.data.user.plan.reason, 'card_check');
    assert.equal(me.data.user.plan.card_check_due, true);
    assert.equal(me.data.user.plan.trial_ends_at, null);
    assert.deepEqual(me.data.user.card, null);
    const w = await c.post('/api/properties', PROP);
    assert.equal(w.status, 402);
    assert.equal(w.data.code, 'CARD_CHECK_REQUIRED');
    assert.equal(w.data.error, 'Confirm your payment card to start your free trial.');
    assert.equal((await c.get('/api/properties')).status, 200);
    assert.notEqual((await c.post('/api/support/tickets', { subject: 'Hi', message: 'Help' })).status, 402);
    assert.notEqual((await c.post('/api/billing/card-check/start', {})).data?.code, 'CARD_CHECK_REQUIRED');
    // A support screenshot is allowed (the route itself then rejects the bad id, not the gate); other record types stay 402.
    const up = await c.post('/api/files?record_type=support&record_id=00000000-0000-0000-0000-000000000000', Buffer.from('x'), { 'Content-Type': 'image/png' });
    assert.notEqual(up.status, 402);
    const photo = await c.post('/api/files?record_type=listing&record_id=00000000-0000-0000-0000-000000000000', Buffer.from('x'), { 'Content-Type': 'image/png' });
    assert.equal(photo.status, 402);
    assert.equal(photo.data.code, 'CARD_CHECK_REQUIRED');
    assert.equal((await c.post('/api/auth/logout')).status, 200);
    const audit = await sql(`SELECT details FROM audit_logs WHERE action = 'workspace.created' AND organization_id = $1`, [org.organization_id]);
    assert.deepEqual(audit[0].details, { card_check: 'required' });
  });

  test('once the card passes the same owner can write; the card shows only for owners', async () => {
    const c = await ownerAccount(srv.base, 'passed@example.com');
    await sql(`UPDATE organizations SET card_check = 'passed', card_checked_at = now(), trial_ends_at = now() + interval '14 days',
      card_brand = 'visa', card_last4 = '4242' WHERE organization_id = (SELECT organization_id FROM users WHERE email = 'passed@example.com')`);
    assert.equal((await c.post('/api/properties', PROP)).status, 201);
    const me = await c.get('/api/auth/me');
    assert.deepEqual(me.data.user.card, { brand: 'visa', last4: '4242' });
    assert.equal(me.data.user.plan.reason, null);
    // A manager in the same workspace is not gated and gets no card.
    const m = client(srv.base);
    await m.post('/api/auth/signup', { full_name: 'Manny', email: 'mgr@example.com', password: 'correct-horse-1', confirm_password: 'correct-horse-1', accept_privacy: true });
    await sql(`UPDATE users SET email_verified_at = now(), role = 'manager', organization_id = (SELECT organization_id FROM users WHERE email = 'passed@example.com') WHERE email = 'mgr@example.com'`);
    const mm = await m.get('/api/auth/me');
    assert.equal(mm.data.user.card, null);
    assert.equal(mm.data.user.owner_name, undefined);
  });

  test('a team member of a gated workspace sees the owner name', async () => {
    await ownerAccount(srv.base, 'own2@example.com');
    const m = client(srv.base);
    await m.post('/api/auth/signup', { full_name: 'Staffy', email: 'staff2@example.com', password: 'correct-horse-1', confirm_password: 'correct-horse-1', accept_privacy: true });
    await sql(`UPDATE users SET email_verified_at = now(), role = 'staff', organization_id = (SELECT organization_id FROM users WHERE email = 'own2@example.com') WHERE email = 'staff2@example.com'`);
    const me = await m.get('/api/auth/me');
    assert.equal(me.data.user.plan.card_check_due, true);
    assert.equal(me.data.user.owner_name, 'Maria Santos');
    const ow = await (await ownerAccount(srv.base, 'own3@example.com')).get('/api/auth/me');
    assert.equal(ow.data.user.owner_name, undefined);
  });

  test('a platform admin workspace is never gated; comped is not gated', async () => {
    const c = await ownerAccount(srv.base, 'boss@example.com', 'Boss Co');
    const org = await orgOf('boss@example.com');
    assert.equal(org.card_check, null);
    assert.ok(org.trial_ends_at);
    assert.equal((await c.post('/api/properties', PROP)).status, 201);
    const g = await ownerAccount(srv.base, 'comp@example.com');
    await sql(`UPDATE organizations SET plan = 'comped' WHERE organization_id = (SELECT organization_id FROM users WHERE email = 'comp@example.com')`);
    assert.equal((await g.post('/api/properties', PROP)).status, 201);
  });

  test('the demo workspace keeps its own read-only answer', async () => {
    const d = client(srv.base);
    await d.post('/api/auth/demo');
    const r = await d.post('/api/properties', PROP);
    assert.equal(r.status, 403);
    assert.equal(r.data.code, 'DEMO_READ_ONLY');
  });

  test('CSP lets the page talk to PayMongo and nothing else new', async () => {
    const r = await fetch(`${srv.base}/api/auth/me`);
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /connect-src 'self' https:\/\/api\.paymongo\.com[;\s]/);
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self';/);
  });
}
