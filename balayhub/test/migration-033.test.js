'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql } = require('./helpers');
const account = require('../src/lib/account');
const { createStaysWorkspace } = require('../src/lib/demo');

let srv; let orgId; let userId; let org2;
test.before(async () => {
  srv = await startServer();
  orgId = await createStaysWorkspace({ email: 'm033@example.com', passwordHash: 'x' });
  org2 = await createStaysWorkspace({ email: 'm033b@example.com', passwordHash: 'x' });
  [{ user_id: userId }] = await sql('SELECT user_id FROM users WHERE organization_id = $1 LIMIT 1', [orgId]);
});
test.after(async () => { await srv.close(); });
const bad = (q, p) => assert.rejects(sql(q, p), /check|violates|unique|duplicate/i);

test('033: bookmarks rules', async () => {
  await sql(`INSERT INTO bookmarks (organization_id, user_id, path, label) VALUES ($1,$2,'#/reservations?view=upcoming','Reservations')`, [orgId, userId]);
  await bad(`INSERT INTO bookmarks (organization_id, user_id, path, label) VALUES ($1,$2,'#/reservations?view=upcoming','Again')`, [orgId, userId]);
  await bad(`INSERT INTO bookmarks (organization_id, user_id, path, label) VALUES ($1,$2,'https://evil.example','X')`, [orgId, userId]);
  await bad(`INSERT INTO bookmarks (organization_id, user_id, path, label) VALUES ($1,$2,'#/home','   ')`, [orgId, userId]);
  await bad(`INSERT INTO bookmarks (organization_id, user_id, path, label) VALUES ($1,$2,'#/home<script>','X')`, [orgId, userId]);
});

test('033: notifications rules', async () => {
  await sql(`INSERT INTO notifications (organization_id, user_id, type, title, url) VALUES ($1,$2,'new_booking','T','/#/home')`, [orgId, userId]);
  await bad(`INSERT INTO notifications (organization_id, user_id, type, title, url) VALUES ($1,$2,'nope','T','/#/home')`, [orgId, userId]);
  await bad(`INSERT INTO notifications (organization_id, user_id, type, title, url) VALUES ($1,$2,'payment','T','javascript:alert(1)')`, [orgId, userId]);
  const [r] = await sql('SELECT read_at FROM notifications WHERE user_id = $1', [userId]);
  assert.equal(r.read_at, null);
});

test('033: purge removes both tables for one workspace only', async () => {
  assert.ok(account.PURGED_TABLES.includes('bookmarks') && account.PURGED_TABLES.includes('notifications'));
  const [{ user_id: u2 }] = await sql('SELECT user_id FROM users WHERE organization_id = $1 LIMIT 1', [org2]);
  await sql(`INSERT INTO bookmarks (organization_id, user_id, path, label) VALUES ($1,$2,'#/home','Home')`, [org2, u2]);
  await account.purgeOrganization(orgId);
  assert.equal((await sql('SELECT 1 FROM bookmarks WHERE organization_id = $1', [orgId])).length, 0);
  assert.equal((await sql('SELECT 1 FROM notifications WHERE organization_id = $1', [orgId])).length, 0);
  assert.equal((await sql('SELECT 1 FROM bookmarks WHERE organization_id = $1', [org2])).length, 1);
});
