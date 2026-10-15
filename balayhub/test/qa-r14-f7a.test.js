'use strict';

// QA round 14, F7a. Owners and Settings: the top bar's openers (?new=1, ?invite=1), a unit owner email that is a teammate's
// login asks first (409 EMAIL_IS_LOGIN, then confirm_login_email: true), and Settings shows the PayMongo key check.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ownerAccount, sql } = require('./helpers');

let srv; let host; let orgId;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Login Email Stays');
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Login Email Stays'`))[0].organization_id;
  await sql(`INSERT INTO users (full_name, email, password_hash, organization_id, role) VALUES ('Mara Reyes', 'mara@x.test', 'x', $1, 'manager')`, [orgId]);
  // A revoked teammate's email is free again.
  await sql(`INSERT INTO users (full_name, email, password_hash, organization_id, role, account_status) VALUES ('Old Hand', 'old@x.test', 'x', $1, 'staff', 'revoked')`, [orgId]);
});
test.after(async () => { await srv.close(); });

const count = async (email) => (await sql('SELECT COUNT(*)::int AS n FROM unit_owners WHERE lower(email) = $1', [email]))[0].n;
const view = (f) => fs.readFileSync(path.join(__dirname, '../public/js/views', f), 'utf8');

test('POST: an email that is a teammate login is asked about, then saved with the flag', async () => {
  const r = await host.post('/api/unit-owners', { full_name: 'Mara Owner', email: ' MARA@x.test ', management_fee_pct: '20' });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'EMAIL_IS_LOGIN');
  assert.equal(r.data.error, 'This email is a login for Mara Reyes.');
  assert.equal(r.data.fields.email, r.data.error);
  assert.equal(r.data.login_name, 'Mara Reyes');
  assert.equal(await count('mara@x.test'), 0, 'nothing written');
  const ok = await host.post('/api/unit-owners', { full_name: 'Mara Owner', email: ' MARA@x.test ', management_fee_pct: '20', confirm_login_email: true });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(await count('mara@x.test'), 1);
});

test('POST: the workspace owner own login counts too', async () => {
  const r = await host.post('/api/unit-owners', { full_name: 'Me Again', email: 'host@example.com', management_fee_pct: '20' });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'EMAIL_IS_LOGIN');
  assert.equal(r.data.login_name, 'Maria Santos');
});

test('POST: a revoked member login and an unrelated email are fine', async () => {
  assert.equal((await host.post('/api/unit-owners', { full_name: 'Old Owner', email: 'old@x.test', management_fee_pct: '20' })).status, 201);
  assert.equal((await host.post('/api/unit-owners', { full_name: 'Plain Owner', email: 'plain@x.test', management_fee_pct: '20' })).status, 201);
});

test('PATCH: a non-login email is fine, a login email is asked about, and an unchanged email is left alone', async () => {
  const id = (await host.post('/api/unit-owners', { full_name: 'Pat Owner', email: 'pat@x.test', management_fee_pct: '20' })).data.owner_id;
  assert.equal((await host.patch(`/api/unit-owners/${id}`, { email: 'pat2@x.test' })).status, 200);
  const r = await host.patch(`/api/unit-owners/${id}`, { email: 'Host@example.com' });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'EMAIL_IS_LOGIN');
  assert.equal((await host.patch(`/api/unit-owners/${id}`, { email: 'Host@example.com', confirm_login_email: true })).status, 200);
  // Saving the same email again (say, an edit to the notes) does not ask a second time.
  assert.equal((await host.patch(`/api/unit-owners/${id}`, { email: 'host@example.com', notes: 'n' })).status, 200);
});

test('a duplicate owner email is still asked first; a body may carry both flags', async () => {
  const body = { full_name: 'Dup Owner', email: 'mara@x.test', management_fee_pct: '20' };
  assert.equal((await host.post('/api/unit-owners', body)).data.code, 'EMAIL_IN_USE');
  assert.equal((await host.post('/api/unit-owners', { ...body, confirm_duplicate_email: true })).data.code, 'EMAIL_IS_LOGIN');
  assert.equal((await host.post('/api/unit-owners', { ...body, confirm_duplicate_email: true, confirm_login_email: true })).status, 201);
});

test('another workspace login email does not count', async () => {
  await ownerAccount(srv.base, 'else@example.com', 'Elsewhere Stays');
  assert.equal((await host.post('/api/unit-owners', { full_name: 'E', email: 'else@example.com', management_fee_pct: '20' })).status, 201);
});

test('the owners view asks on EMAIL_IS_LOGIN and resends with the flag', () => {
  const src = view('owners.js');
  assert.match(src, /EMAIL_IS_LOGIN/);
  assert.match(src, /Email is a login/);
  assert.match(src, /Save anyway/);
  assert.equal((src.match(/confirm_login_email: true/g) || []).length, 2, 'add and edit resend the flag');
});

test('the top bar openers are guarded and do not move focus', () => {
  const owners = view('owners.js');
  const settings = view('settings.js');
  assert.match(owners, /query\.new\s*&&[^;\n]*add\(\)/);
  assert.match(settings, /query\.invite\s*&&[^;\n]*invite\(\)/);
  for (const re of [/query\.new\s*&&[^;\n]*add\(\)[^\n]*/, /query\.invite\s*&&[^;\n]*invite\(\)[^\n]*/]) {
    const line = (owners.match(re) || settings.match(re))[0];
    assert.doesNotMatch(line, /\.focus\(/);
  }
});

test('Settings shows the PayMongo key check and asks before turning on an unchecked key', () => {
  const src = view('settings.js');
  assert.match(src, /paymongo_checked/);
  assert.match(src, /Saved, not checked yet \(\$\{[^}]+\}\)/);
  assert.match(src, /BalayHub couldn't reach PayMongo to check this key\. It is checked again when you turn on your booking page\./);
  assert.match(src, /PayMongo connected\./);
  assert.match(src, /Key saved\. It couldn't be checked yet\./);
  assert.match(src, /PAYMONGO_UNCHECKED/);
  assert.match(src, /Key not checked yet/);
  assert.match(src, /Turn on anyway/);
  assert.match(src, /confirm_unchecked_key: true/);
});

test('the openers fire once per navigation: they drop the flag from the query and the address', () => {
  const owners = view('owners.js').match(/query\.new\s*&&[^;\n]*add\(\)[^\n]*/)[0];
  const settings = view('settings.js').match(/query\.invite\s*&&[^;\n]*invite\(\)[^\n]*/)[0];
  assert.match(owners, /delete query\.new/);
  assert.match(owners, /history\.replaceState\(null, '', '#\/owners'\)/);
  assert.match(settings, /delete query\.invite/);
  assert.match(settings, /history\.replaceState\(null, '', '#\/settings'\)/);
});
