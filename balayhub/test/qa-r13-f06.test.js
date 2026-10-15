'use strict';

// QA round 13, F06. A unit owner email another active owner already uses asks first (409 EMAIL_IN_USE, then
// confirm_duplicate_email: true), add-on prices ask above the ceiling, and the statement buttons carry focus keys.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ownerAccount, sql } = require('./helpers');

let srv; let host; let aId;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Dup Email Stays');
});
test.after(async () => { await srv.close(); });

const count = async (email) => (await sql('SELECT COUNT(*)::int AS n FROM unit_owners WHERE lower(email) = $1', [email]))[0].n;

test('a second active owner with the same email is asked about, then saved with the flag', async () => {
  const a = await host.post('/api/unit-owners', { full_name: 'Owner A', email: 'a@x.test', management_fee_pct: '20' });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  aId = a.data.owner_id;
  const dup = await host.post('/api/unit-owners', { full_name: 'Owner B', email: ' A@X.test ', management_fee_pct: '20' });
  assert.equal(dup.status, 409, JSON.stringify(dup.data));
  assert.equal(dup.data.code, 'EMAIL_IN_USE');
  assert.equal(dup.data.error, 'This email already belongs to Owner A.');
  assert.equal(dup.data.fields.email, dup.data.error);
  assert.equal(dup.data.owner_name, 'Owner A');
  assert.equal(await count('a@x.test'), 1, 'nothing written');
  const ok = await host.post('/api/unit-owners', { full_name: 'Owner B', email: ' A@X.test ', management_fee_pct: '20', confirm_duplicate_email: true });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(await count('a@x.test'), 2);
});

test('PATCH: own email is fine, another active owner email is asked about', async () => {
  assert.equal((await host.patch(`/api/unit-owners/${aId}`, { email: 'a@x.test' })).status, 200);
  const c = (await host.post('/api/unit-owners', { full_name: 'Owner C', email: 'c@x.test', management_fee_pct: '20' })).data.owner_id;
  const r = await host.patch(`/api/unit-owners/${c}`, { email: 'A@x.test' });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'EMAIL_IN_USE');
  assert.equal((await host.patch(`/api/unit-owners/${c}`, { email: 'A@x.test', confirm_duplicate_email: true })).status, 200);
});

test('an archived owner email does not count', async () => {
  const d = (await host.post('/api/unit-owners', { full_name: 'Owner D', email: 'd@x.test', management_fee_pct: '20' })).data.owner_id;
  assert.equal((await host.post(`/api/unit-owners/${d}/archive`)).status, 200);
  assert.equal((await host.post('/api/unit-owners', { full_name: 'Owner E', email: 'd@x.test', management_fee_pct: '20' })).status, 201);
});

test('another workspace owner email does not count', async () => {
  const other = await ownerAccount(srv.base, 'other@example.com', 'Other Stays');
  assert.equal((await other.post('/api/unit-owners', { full_name: 'Owner A2', email: 'a@x.test', management_fee_pct: '20' })).status, 201);
});

const view = (f) => fs.readFileSync(path.join(__dirname, '../public/js/views', f), 'utf8');

test('the owners view asks on EMAIL_IN_USE and resends with the flag', () => {
  const src = view('owners.js');
  assert.match(src, /EMAIL_IN_USE/);
  assert.match(src, /Email already used/);
  assert.match(src, /confirm_duplicate_email: true/);
  assert.match(src, /Save anyway/);
  assert.match(src, /Change it/);
});

test('Add and Edit add-on ask about a high price', () => {
  const src = view('addons.js');
  assert.match(src, /import \{[^}]*highAddonPriceOk[^}]*\} from '\.\.\/rates\.js'/);
  assert.match(src, /highAddonPriceOk\(/);
});

test('the statement buttons carry their focus keys', () => {
  const src = view('owners.js');
  assert.equal((src.match(/'data-focus-key': 'stmt-publish'/g) || []).length, 2);
  assert.equal((src.match(/'data-focus-key': 'stmt-send'/g) || []).length, 1);
});

test('a save that hits both UNIT_HAS_OWNER and EMAIL_IN_USE needs both flags, and the view resends with both', async () => {
  const org = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Dup Email Stays'`))[0].organization_id;
  const p = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const u = (await host.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  assert.ok(org);
  assert.equal((await host.post('/api/unit-owners', { full_name: 'Owner F', email: 'f@x.test', management_fee_pct: '20', unit_ids: [u.unit_id] })).status, 201);
  const body = { full_name: 'Owner G', email: 'f@x.test', management_fee_pct: '20', unit_ids: [u.unit_id] };
  assert.equal((await host.post('/api/unit-owners', body)).data.code, 'EMAIL_IN_USE');
  assert.equal((await host.post('/api/unit-owners', { ...body, confirm_duplicate_email: true })).data.code, 'UNIT_HAS_OWNER');
  assert.equal((await host.post('/api/unit-owners', { ...body, move_units: true })).data.code, 'EMAIL_IN_USE');
  assert.equal((await host.post('/api/unit-owners', { ...body, confirm_duplicate_email: true, move_units: true })).status, 201);
  const src = view('owners.js');
  assert.equal((src.match(/extra = \{ \.\.\.extra, confirm_duplicate_email: true \};/g) || []).length, 2, 'add and edit keep the email flag');
  assert.equal((src.match(/extra = \{ \.\.\.extra, move_units: true \};/g) || []).length, 2, 'add and edit keep the move flag');
});

test('both invite buttons share one per-owner focus key', () => {
  const src = view('owners.js');
  assert.equal((src.match(/'data-focus-key': `owner-invite-\$\{o\.owner_id\}`/g) || []).length, 2);
});
