'use strict';

// QA round 7, lane C20 (team invite). An email that already has a BalayHub account is said once, at its
// field (D-82). The banner stays the generic validation line, and nothing is written.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Team Invite <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, sql } = require('./helpers');

const EMAIL = 'owner-team-c20@example.com';
const FIELD_MESSAGE = 'This email already has a BalayHub account. Use a different email for each workspace.';
let srv; let owner;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, EMAIL, 'Team Invite');
});
test.after(async () => { await srv.close(); });

test('inviting an email that already has an account says it once, at the email field, and writes nothing', async () => {
  const invitedBefore = (await sql(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'member.invited'`))[0].n;
  // The owner's own address already has an account, so the invite is refused.
  const res = await owner.post('/api/team/invitations', { email: EMAIL, role: 'staff', property_ids: [] });
  assert.equal(res.status, 409, JSON.stringify(res.data));
  assert.equal(res.data.code, 'EMAIL_TAKEN');
  assert.equal(res.data.error, 'Please check the highlighted fields.');
  assert.equal(res.data.fields.email, FIELD_MESSAGE);
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM invitations WHERE lower(email) = $1', [EMAIL]))[0].n, 0);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'member.invited'`))[0].n, invitedBefore);
});
