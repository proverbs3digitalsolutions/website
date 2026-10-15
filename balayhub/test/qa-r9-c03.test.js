'use strict';

// QA round 9, lane C03 (owners, server and view). Covers #21 (a unit that belongs to another owner moves only after the host
// confirms: the server answers 409 UNIT_HAS_OWNER and writes nothing until the save says move_units: true), #25 (a new owner's
// fee box starts empty, the label says what the fee is, and an owner-operator is told they don't need this page), #26 (the
// Publish reason is printed under the button, not only in its tooltip), and the owners part of K13 (the filter bar is built
// before the page decides whether to show it). The view imports the app shell, which does not load in Node, so those checks
// are a source scan.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_02 node --test --test-concurrency=1 test/qa-r9-c03.test.js

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, sql, ownerAccount } = require('./helpers');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'owners.js'), 'utf8');
const between = (from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

let srv; let host; let propertyId; let u1; let u2; let u3; let u4; let ownerC; let ownerD;
const unitOwner = async (unitId) => (await sql('SELECT owner_id FROM units WHERE unit_id = $1', [unitId]))[0].owner_id;
const ownerCount = async () => (await sql('SELECT COUNT(*)::int AS n FROM unit_owners WHERE archived_at IS NULL'))[0].n;
const ownerRow = async (id) => (await sql('SELECT full_name, management_fee_pct FROM unit_owners WHERE owner_id = $1', [id]))[0];

test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Managed Stays');
  propertyId = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property.property_id;
  const unit = async (name) => (await host.post(`/api/properties/${propertyId}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '2000' })).data.unit.unit_id;
  u1 = await unit('Tower 4 - 0912');
  u2 = await unit('Unit 805');
  u3 = await unit('Unit 310');
  u4 = await unit('Unit 412');
  ownerC = (await host.post('/api/unit-owners', { full_name: 'Owner C', management_fee_pct: '20', unit_ids: [u1] })).data.owner_id;
  ownerD = (await host.post('/api/unit-owners', { full_name: 'Owner D', management_fee_pct: '20', unit_ids: [u2] })).data.owner_id;
});
test.after(async () => { await srv.close(); });

test('a new owner that takes a unit of another owner is refused with 409 and nothing is written', async () => {
  const before = await ownerCount();
  const r = await host.post('/api/unit-owners', { full_name: 'Owner E', management_fee_pct: '20', unit_ids: [u1] });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'UNIT_HAS_OWNER');
  assert.equal(r.data.error, 'Tower 4 - 0912 belongs to Owner C.');
  assert.deepEqual(r.data.units, [{ unit_id: u1, unit_name: 'Tower 4 - 0912', owner_id: ownerC, owner_name: 'Owner C' }]);
  assert.equal(await ownerCount(), before, 'no owner is created');
  assert.equal(await unitOwner(u1), ownerC, 'the unit still belongs to Owner C');
});

test('every unit of another owner is named in the refusal, joined into one message', async () => {
  const r = await host.post('/api/unit-owners', { full_name: 'Owner E', management_fee_pct: '20', unit_ids: [u1, u2] });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.error, 'Tower 4 - 0912 belongs to Owner C. Unit 805 belongs to Owner D.');
  assert.deepEqual(r.data.units.map((x) => x.owner_name), ['Owner C', 'Owner D']);
  assert.equal(await unitOwner(u2), ownerD, 'the second unit did not move either');
});

test('only move_units: true moves the unit, and the old owner loses it', async () => {
  const yes = await host.post('/api/unit-owners', { full_name: 'Owner E', management_fee_pct: '20', unit_ids: [u1], move_units: 'yes' });
  assert.equal(yes.status, 409, 'a truthy string is not consent');
  const r = await host.post('/api/unit-owners', { full_name: 'Owner E', management_fee_pct: '20', unit_ids: [u1], move_units: true });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(await unitOwner(u1), r.data.owner_id);
  assert.equal((await sql('SELECT unit_id FROM units WHERE owner_id = $1', [ownerC])).length, 0, 'Owner C has no units left');
});

test('editing an owner to add a unit of another owner is refused; the name and fee are not saved', async () => {
  const ownerE = await unitOwner(u1);
  const r = await host.patch(`/api/unit-owners/${ownerD}`, { full_name: 'Owner D Renamed', management_fee_pct: '25', unit_ids: [u2, u1] });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'UNIT_HAS_OWNER');
  assert.deepEqual(r.data.units, [{ unit_id: u1, unit_name: 'Tower 4 - 0912', owner_id: ownerE, owner_name: 'Owner E' }]);
  assert.deepEqual(await ownerRow(ownerD), { full_name: 'Owner D', management_fee_pct: '20.00' });
  assert.equal(await unitOwner(u1), ownerE);
});

test('an edit with move_units: true moves the unit to this owner', async () => {
  const r = await host.patch(`/api/unit-owners/${ownerD}`, { full_name: 'Owner D Renamed', management_fee_pct: '25', unit_ids: [u2, u1], move_units: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await unitOwner(u1), ownerD);
  assert.equal((await ownerRow(ownerD)).full_name, 'Owner D Renamed');
});

test('a unit the owner already has, an unowned unit and a new owner with no units are not conflicts', async () => {
  const edit = await host.patch(`/api/unit-owners/${ownerD}`, { unit_ids: [u1, u2, u4] });
  assert.equal(edit.status, 200, JSON.stringify(edit.data));
  assert.equal(await unitOwner(u4), ownerD);
  const add = await host.post('/api/unit-owners', { full_name: 'Owner F', management_fee_pct: '20', unit_ids: [u3] });
  assert.equal(add.status, 201, JSON.stringify(add.data));
  const none = await host.post('/api/unit-owners', { full_name: 'Owner G', management_fee_pct: '20', unit_ids: [] });
  assert.equal(none.status, 201, JSON.stringify(none.data));
});

test('a unit of another workspace is refused as an unknown unit and never named with its owner', async () => {
  const other = await ownerAccount(srv.base, 'other-r9c03@example.com', 'Other Stays');
  const op = (await other.post('/api/properties', { property_name: 'Elsewhere', property_type: 'condominium', address: 'Ayala Ave', city: 'Makati', province: 'Metro Manila' })).data.property;
  const foreign = (await other.post(`/api/properties/${op.property_id}/units`, { unit_name: 'Villa 9', unit_type: 'studio', nightly_rate: '1000' })).data.unit;
  const theirOwner = (await other.post('/api/unit-owners', { full_name: 'Their Owner', management_fee_pct: '20', unit_ids: [foreign.unit_id] })).data.owner_id;
  const r = await host.post('/api/unit-owners', { full_name: 'Snoop', management_fee_pct: '20', unit_ids: [foreign.unit_id] });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.unit_ids, 'One or more selected units were not found.');
  assert.equal(await unitOwner(foreign.unit_id), theirOwner);
});

test('a manager cannot move units either: owner-only as before', async () => {
  const inv = await host.post('/api/team/invitations', { email: 'mgr-r9c03@example.com', role: 'manager', property_ids: [propertyId] });
  const mgr = client(srv.base);
  await mgr.post('/api/auth/signup', { full_name: 'Mona Manager', email: 'mgr-r9c03@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  const r = await mgr.post('/api/unit-owners', { full_name: 'Sneaky', management_fee_pct: '20', unit_ids: [u1], move_units: true });
  assert.equal(r.status, 403);
  assert.equal(await unitOwner(u1), ownerD);
});

test('the view asks before a unit moves, names the move, and resends with move_units only after the host agrees', () => {
  const move = between('// A unit that belongs to another owner', 'export async function ownersView');
  assert.match(move, /if \(err\.code !== 'UNIT_HAS_OWNER'\) throw err;/);
  assert.match(move, /from \$\{u\.owner_name\}/);
  assert.match(move, /\? 'Its' : 'Their'\} stays and expenses show on/);
  assert.match(move, /statements from now on/);
  // Cancel returns false, so the form stays open with nothing posted.
  assert.match(move, /return confirmDialog\(/);
  assert.equal((src.match(/if \(!await moveConfirmed\(err, d\.full_name\)\) return false;/g) || []).length, 2, 'add and edit both ask');
  assert.equal((src.match(/extra = \{ \.\.\.extra, move_units: true \};/g) || []).length, 2, 'add and edit both resend with move_units');
});

test('a new owner\'s fee box starts empty, the label says what the fee is, and an owner-operator is told they don\'t need this page (#25)', () => {
  assert.match(src, /value: o\.management_fee_pct \?\? ''/);
  assert.doesNotMatch(src, /management_fee_pct \?\? '20'/);
  assert.match(src, /label: 'How the management fee is worked out'/);
  assert.doesNotMatch(src, /How you are paid/);
  assert.match(src, /Own these units yourself\? You don\\'t need this page\. Profit and loss shows each unit\./);
});

test('the Publish reason is printed under the button as well as in its tooltip (#26)', () => {
  const view = src.slice(src.indexOf('export async function ownerStatementView'));
  assert.match(view, /You can publish this statement after \$\{fmtDate\(lastDayOf\(month\)\)\}\./);
  // The tooltip stays.
  assert.match(view, /title: monthEnded \? null : 'You can publish once the month has ended\.'/);
});

test('the owners page builds its filter bar before it decides to show it (K13, owners)', () => {
  const page = between('export async function ownersView', 'export async function ownerStatementsView');
  const bar = page.indexOf('const bar = filterBar({');
  const decide = page.indexOf('const showBar = ');
  assert.ok(bar > -1 && decide > -1, 'the bar and the show decision are both there');
  assert.ok(bar < decide, 'the bar drops unknown values before the page decides');
  assert.match(page, /showBar \? bar : ''/);
});
