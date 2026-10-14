'use strict';

// QA round 2 (R2 reset tokens): parallel forgot-password requests send one email, and a successful
// reset retires every other unused reset token for that user.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SMTP_URL = 'test://';
const { startServer, client } = require('./helpers');
const { pool } = require('../src/db');
const { outbox } = require('../src/lib/mailer');
const config = require('../src/config');

let srv;
let userId;
test.before(async () => { srv = await startServer(); });
test.after(async () => { await srv.close(); });

const EMAIL = 'victim@example.com';
const forgot = (email) => client(srv.base).raw('POST', '/api/auth/forgot-password', { email });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Reset emails sent to this address, as the tokens inside their links (oldest first).
const resetTokensMailed = () => outbox
  .filter((m) => m.to === EMAIL && /reset-password\?token=/.test(m.text))
  .map((m) => decodeURIComponent(m.text.match(/token=(\S+)/)[1]));
const unusedResetTokens = async () => (await pool.query(
  "SELECT count(*)::int AS n FROM auth_tokens WHERE user_id = $1 AND purpose = 'reset_password' AND used_at IS NULL",
  [userId],
)).rows[0].n;
const backdateResetTokens = () => pool.query(
  "UPDATE auth_tokens SET created_at = now() - interval '6 minutes' WHERE user_id = $1 AND purpose = 'reset_password'",
  [userId],
);
// Production answers before the mail work finishes, so wait for the first mail, then give any extra mail time to appear.
async function settleMail(count) {
  for (let i = 0; i < 100 && resetTokensMailed().length < count; i += 1) await sleep(20);
  await sleep(300);
}
// The "is there a recent token?" check and the insert are separate statements, so the window between them is
// a few microseconds on localhost and parallel requests rarely hit it. Pause each token insert made outside a
// transaction client so every request gets past the check before any of them inserts. Returns a restore function.
function pauseTokenInserts(ms) {
  const real = pool.query;
  pool.query = function pausedQuery(text, params) {
    if (/INSERT INTO auth_tokens/.test(String(text))) {
      return sleep(ms).then(() => real.call(pool, text, params));
    }
    return real.call(pool, text, params);
  };
  return () => { pool.query = real; };
}

test('setup', async () => {
  const r = await client(srv.base).post('/api/auth/signup', {
    full_name: 'Victim', email: EMAIL, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
  });
  assert.equal(r.status, 201);
  userId = (await pool.query('SELECT user_id FROM users WHERE email = $1', [EMAIL])).rows[0].user_id;
});

test('five parallel forgot-password requests for one email send one reset email and make one token', async () => {
  outbox.length = 0;
  config.exposeDevLinks = false; // production behaviour: the answer does not wait for the mail
  const restore = pauseTokenInserts(150);
  try {
    const replies = await Promise.all(Array.from({ length: 5 }, () => forgot(EMAIL)));
    assert.ok(replies.every((r) => r.status === 200));
    await settleMail(1);
    assert.equal(resetTokensMailed().length, 1, 'reset emails sent');
    assert.equal(await unusedResetTokens(), 1, 'unused reset tokens');
  } finally {
    restore();
    config.exposeDevLinks = true;
  }
});

test('after a successful reset, an older unused reset link is refused', async () => {
  outbox.length = 0;
  await backdateResetTokens();
  await forgot(EMAIL);
  await settleMail(1);
  await backdateResetTokens();
  await forgot(EMAIL);
  await settleMail(2);
  const [older, newer] = resetTokensMailed();
  assert.ok(older && newer && older !== newer, 'two different reset links were mailed');

  const anon = client(srv.base);
  const fresh = await anon.post('/api/auth/reset-password', { token: newer, password: 'newer-link-pass1' });
  assert.equal(fresh.status, 200);
  assert.equal(await unusedResetTokens(), 0, 'the reset retires every other unused reset token');

  const stale = await anon.post('/api/auth/reset-password', { token: older, password: 'older-link-pass2' });
  assert.equal(stale.status, 400);
  assert.equal(stale.data.code, 'TOKEN_INVALID');
});
