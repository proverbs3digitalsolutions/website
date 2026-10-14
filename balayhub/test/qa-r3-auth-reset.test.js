'use strict';

// QA round 3 (O-c): two reset links for one user used at the same moment must not deadlock.
// The one that loses the race gets the normal 400 TOKEN_INVALID, never a 500.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SMTP_URL = 'test://';
const { startServer, client, sql } = require('./helpers');
const { hashToken, newToken } = require('../src/lib/auth');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(async () => { await srv.close(); });

const EMAIL = 'racer@example.com';

test('setup', async () => {
  const r = await client(srv.base).post('/api/auth/signup', {
    full_name: 'Racer', email: EMAIL, password: 'starting-pass-1', confirm_password: 'starting-pass-1', accept_privacy: true,
  });
  assert.equal(r.status, 201);
});

test('two reset links used at the same moment: one resets, the other gets 400, none 500 (repeated 10 times)', async () => {
  const [{ user_id: userId }] = await sql('SELECT user_id FROM users WHERE email = $1', [EMAIL]);
  for (let round = 1; round <= 10; round += 1) {
    // Two unused reset links for the same user, as if two reset emails had gone out.
    const tokens = [newToken(), newToken()];
    for (const t of tokens) {
      await sql(
        `INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, 'reset_password', now() + interval '1 hour')`,
        [hashToken(t), userId],
      );
    }
    const results = await Promise.all(tokens.map((t) => client(srv.base).post('/api/auth/reset-password', { token: t, password: `race-pass-${round}-x` })));
    const detail = JSON.stringify(results.map((r) => ({ status: r.status, data: r.data })));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400], `round ${round}: ${detail}`);
    const loser = results.find((r) => r.status === 400);
    assert.equal(loser.data.code, 'TOKEN_INVALID', `round ${round}: ${detail}`);
  }
});
