'use strict';

// QA round 2 (C9, C10): forgot-password de-duplicates instead of a silent cap, and answers before the mail work.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SMTP_URL = 'test://';
const { startServer, client } = require('./helpers');
const { pool } = require('../src/db');
const { outbox } = require('../src/lib/mailer');
const config = require('../src/config');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(async () => { await srv.close(); });

const forgot = (email, ip) => client(srv.base).raw('POST', '/api/auth/forgot-password', { email }, ip ? { 'X-Forwarded-For': ip } : {});
const mailsTo = (email) => outbox.filter((m) => m.to === email).length;
const settle = () => new Promise((r) => setTimeout(r, 150));

test('setup', async () => {
  const r = await client(srv.base).post('/api/auth/signup', {
    full_name: 'Victim', email: 'victim@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
  });
  assert.equal(r.status, 201);
});

test('two requests in a row send one email; the response is identical', async () => {
  outbox.length = 0;
  const a = await forgot('victim@example.com');
  const b = await forgot('victim@example.com');
  await settle();
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.data.message, b.data.message);
  assert.equal(mailsTo('victim@example.com'), 1);
});

test('a stranger sending six requests sends at most one email; the victim after the window gets a new one', async () => {
  outbox.length = 0;
  await pool.query("UPDATE auth_tokens SET created_at = now() - interval '6 minutes' WHERE purpose = 'reset_password'");
  for (let i = 0; i < 6; i += 1) await forgot('victim@example.com', '198.51.100.7');
  await settle();
  assert.equal(mailsTo('victim@example.com'), 1);
  // Window passes: the real owner (other IP) is not blocked and sees no error.
  await pool.query("UPDATE auth_tokens SET created_at = now() - interval '6 minutes' WHERE purpose = 'reset_password'");
  const owner = await forgot('victim@example.com', '203.0.113.50');
  await settle();
  assert.equal(owner.status, 200);
  assert.equal(mailsTo('victim@example.com'), 2);
});

test('the response does not wait on the mailer (production-style, no dev links)', async () => {
  const { sendMail } = require('../src/lib/mailer');
  const mailer = require('../src/lib/mailer');
  assert.ok(sendMail);
  config.exposeDevLinks = false;
  const orig = mailer.sendMail;
  let done = false;
  mailer.sendMail = async () => { await new Promise((r) => setTimeout(r, 600)); done = true; return {}; };
  try {
    await pool.query("UPDATE auth_tokens SET created_at = now() - interval '6 minutes' WHERE purpose = 'reset_password'");
    const t0 = Date.now();
    const known = await forgot('victim@example.com', '192.0.2.10');
    const knownMs = Date.now() - t0;
    const t1 = Date.now();
    const unknown = await forgot('nobody@example.com', '192.0.2.11');
    const unknownMs = Date.now() - t1;
    assert.equal(known.status, 200);
    assert.equal(known.data.message, unknown.data.message);
    assert.equal(done, false, 'response came before the mail finished');
    assert.ok(knownMs < 400, `known took ${knownMs}ms`);
    assert.ok(Math.abs(knownMs - unknownMs) < 300, `known ${knownMs}ms vs unknown ${unknownMs}ms`);
  } finally {
    mailer.sendMail = orig;
    config.exposeDevLinks = true;
  }
});
