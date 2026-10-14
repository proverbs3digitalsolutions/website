'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

// QA round 11, lane C12b. Reopening a daily close leaves a full trace in the audit log
// (note, who closed it, when, which properties, the summary). Own database via TEST_DATABASE_URL.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');

const addDays = (s, n) => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);

let srv; let owner; let orgId;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'c12b-owner@example.com', 'Lane C12b Stays');
  orgId = (await sql('SELECT organization_id FROM organizations WHERE name = $1', ['Lane C12b Stays']))[0].organization_id;
});
test.after(async () => { await srv.close(); });

test('reopen audit keeps note, closed_by, closed_at, property_ids and summary', async () => {
  const d = addDays(manilaToday(), -3);
  assert.equal((await owner.post('/api/daily-close', { date: d, note: 'cash short by 50' })).status, 200);
  const uid = (await sql('SELECT user_id FROM users WHERE email = $1', ['c12b-owner@example.com']))[0].user_id;
  assert.equal((await owner.post('/api/daily-close/reopen', { date: d })).status, 200);
  const [a] = await sql("SELECT details FROM audit_logs WHERE organization_id = $1 AND action = 'daily_close.reopened'", [orgId]);
  assert.equal(a.details.date, d);
  assert.equal(a.details.note, 'cash short by 50');
  assert.equal(a.details.closed_by, uid);
  assert.ok(a.details.closed_at);
  assert.ok(Array.isArray(a.details.property_ids));
  assert.ok(a.details.summary && a.details.summary.counts);
});
