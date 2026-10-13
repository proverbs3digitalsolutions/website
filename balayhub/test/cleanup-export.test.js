'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const { purgeExpiredAuth, hashToken } = require('../src/lib/auth');
const config = require('../src/config');

let srv; let owner;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'clean@example.com', 'Clean Co');
});
test.after(async () => { await srv.close(); });

test('purgeExpiredAuth removes expired and idle sessions and old tokens, keeps live ones', async () => {
  const [{ user_id: uid }] = await sql(`SELECT user_id FROM users WHERE email = 'clean@example.com'`);
  const idle = config.sessionIdleHours;
  const sessions = {
    live: [`now() + interval '1 day'`, 'now()'],
    expired: [`now() - interval '1 minute'`, 'now()'],
    idle: [`now() + interval '1 day'`, `now() - make_interval(hours => ${idle + 1})`],
  };
  for (const [name, [exp, seen]] of Object.entries(sessions)) {
    await sql(`INSERT INTO sessions (token_hash, user_id, expires_at, last_seen_at) VALUES ($1, $2, ${exp}, ${seen})`, [hashToken(`s-${name}`), uid]);
  }
  const tokens = {
    fresh: [`now() + interval '1 hour'`, 'NULL'],
    usedRecently: [`now() + interval '1 hour'`, `now() - interval '1 day'`],
    expired: [`now() - interval '1 minute'`, 'NULL'],
    usedLongAgo: [`now() + interval '30 days'`, `now() - interval '8 days'`],
  };
  for (const [name, [exp, used]] of Object.entries(tokens)) {
    await sql(`INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at, used_at) VALUES ($1, $2, 'reset_password', ${exp}, ${used})`, [hashToken(`t-${name}`), uid]);
  }

  const deleted = await purgeExpiredAuth();
  assert.equal(deleted, 4, 'expired + idle session, expired + old used token');

  const hasSession = async (n) => (await sql('SELECT 1 FROM sessions WHERE token_hash = $1', [hashToken(`s-${n}`)])).length === 1;
  const hasToken = async (n) => (await sql('SELECT 1 FROM auth_tokens WHERE token_hash = $1', [hashToken(`t-${n}`)])).length === 1;
  assert.equal(await hasSession('live'), true);
  assert.equal(await hasSession('expired'), false);
  assert.equal(await hasSession('idle'), false);
  assert.equal(await hasToken('fresh'), true);
  assert.equal(await hasToken('usedRecently'), true);
  assert.equal(await hasToken('expired'), false);
  assert.equal(await hasToken('usedLongAgo'), false);

  // The owner's real sign-in session survives.
  assert.equal((await owner.get('/api/auth/me')).status, 200);
  assert.equal(await purgeExpiredAuth(), 0, 'nothing left to delete');
});

test('export includes support messages (not internal notes), events and consent records', async () => {
  const r = await owner.post('/api/support/tickets', { subject: 'Calendar is empty', category: 'problem', body: 'Customer message here.' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const ticketId = r.data.ticket_id;
  await sql(`INSERT INTO support_messages (ticket_id, author_kind, internal, body) VALUES ($1, 'support', true, 'STAFF ONLY note'), ($1, 'support', false, 'Public reply from support')`, [ticketId]);

  const data = (await owner.raw('GET', '/api/workspace/export')).data;
  assert.equal(data.support_tickets.length, 1);
  const bodies = data.support_messages.map((m) => m.body);
  assert.ok(bodies.includes('Customer message here.'));
  assert.ok(bodies.includes('Public reply from support'));
  assert.ok(!JSON.stringify(data).includes('STAFF ONLY'), 'internal notes are never exported');
  assert.ok(data.support_messages.every((m) => !('internal' in m)));
  assert.ok(data.support_events.some((e) => e.ticket_id === ticketId && e.kind === 'created'));
  const consents = data.consent_records.map((c) => c.consent_type).sort();
  assert.deepEqual(consents, ['privacy_notice', 'terms_of_service']);
  assert.ok(Array.isArray(data.files), 'stored files are listed');

  // Another workspace sees none of it.
  const other = await ownerAccount(srv.base, 'else@example.com', 'Else Co');
  const theirs = (await other.raw('GET', '/api/workspace/export')).data;
  assert.equal(theirs.support_messages.length, 0);
  assert.equal(theirs.support_events.length, 0);
  assert.ok(theirs.consent_records.every((c) => !data.consent_records.some((d) => d.consent_id === c.consent_id)));
});
