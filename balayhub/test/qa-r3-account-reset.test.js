'use strict';

// QA round 3 (O-c, change-password side): a password change and a reset link used at the same moment
// must not deadlock. Neither request may answer 500.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const { hashToken, newToken, hashPassword } = require('../src/lib/auth');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(async () => { await srv.close(); });

const EMAIL = 'changer@example.com';
const PASSWORD = 'correct-horse-1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait until at least `n` requests in this database are stuck waiting on a lock.
async function waitForLockWaiters(n) {
  for (let i = 0; i < 250; i += 1) {
    const [{ c }] = await sql(
      `SELECT count(*)::int AS c FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (c >= n) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${n} lock waiters`);
}

test('setup', async () => {
  await ownerAccount(srv.base, EMAIL, 'Changer Co');
});

test('a password change and a reset link used at the same moment: no 500 and both succeed (repeated 5 times)', async () => {
  const [{ user_id: userId }] = await sql('SELECT user_id FROM users WHERE email = $1', [EMAIL]);
  for (let round = 1; round <= 5; round += 1) {
    // Known password, a signed-in device, and two unused reset links for the same user.
    await sql('UPDATE users SET password_hash = $2 WHERE user_id = $1', [userId, await hashPassword(PASSWORD)]);
    const device = client(srv.base);
    assert.equal((await device.post('/api/auth/login', { email: EMAIL, password: PASSWORD })).status, 200);
    const [first, second] = [newToken(), newToken()];
    for (const t of [first, second]) {
      await sql(
        `INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, 'reset_password', now() + interval '1 hour')`,
        [hashToken(t), userId],
      );
    }
    // Pin the interleaving: a side connection holds the second link's row, so the reset is queued on it
    // first, then the change is queued behind it, then the side connection lets go.
    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM auth_tokens WHERE token_hash = $1 FOR UPDATE', [hashToken(second)]);
      const reset = client(srv.base).post('/api/auth/reset-password', { token: second, password: `reset-pass-${round}-x` });
      await waitForLockWaiters(1);
      const next = `changed-pass-${round}-x`;
      const change = device.post('/api/auth/change-password', { current_password: PASSWORD, new_password: next, confirm_password: next });
      await waitForLockWaiters(2);
      await holder.query('COMMIT');
      const [r, c] = await Promise.all([reset, change]);
      const detail = JSON.stringify([{ status: r.status, data: r.data }, { status: c.status, data: c.data }]);
      assert.equal(r.status, 200, `round ${round}: ${detail}`);
      assert.equal(c.status, 200, `round ${round}: ${detail}`);
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      await holder.end();
    }
  }
});
