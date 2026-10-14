'use strict';

// Round 10, lane C12 (BalayHub QA #29 and #26).
// #29: an owner or manager logs a found item on a listing from the Lost and found page, with no stay or cleaning
// task to link it to. Staff and cleaners are refused, a listing outside the person's properties is a 404, and the
// new item is audited.
// #26: the Supplies used dialog for a property with no supplies set up has no Save. Owners and managers are sent to
// Supplies; a cleaner is told to tell the manager.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const { hashPassword } = require('../src/lib/auth');

const CLEANER_PASSWORD = 'cleaner-pass-1';
const NO_ID = '00000000-0000-4000-8000-000000000000';
const tomorrow = () => new Date(Date.parse(`${manilaToday()}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

let srv; let owner; let other; let ownerId; let orgId; let propA; let propB; let unitA; let unitB;
let manager; let staff; let cleaner;

async function invite(email, role, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: email, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

// Cleaners are created straight in the database (role 'cleaner', assigned to one property), then sign in.
async function addCleaner(email, name, propertyId) {
  const [{ user_id: userId }] = await sql(
    `INSERT INTO users (organization_id, email, password_hash, full_name, role, email_verified_at)
     VALUES ($1, $2, $3, $4, 'cleaner', now()) RETURNING user_id`,
    [orgId, email, await hashPassword(CLEANER_PASSWORD), name]);
  await sql('INSERT INTO property_assignments (user_id, property_id) VALUES ($1, $2)', [userId, propertyId]);
  const c = client(srv.base);
  const r = await c.post('/api/auth/login', { email, password: CLEANER_PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return c;
}

const itemCount = async () => (await sql('SELECT COUNT(*)::int AS n FROM lost_found_items WHERE organization_id = $1', [orgId]))[0].n;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host-c12@example.com', 'Found Co');
  [{ user_id: ownerId, organization_id: orgId }] = await sql('SELECT user_id, organization_id FROM users WHERE email = $1', ['host-c12@example.com']);
  propA = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  propB = (await owner.post('/api/properties', { property_name: 'Mabini', property_type: 'apartment', address: '12 Mabini St', city: 'Bacoor', province: 'Cavite' })).data.property;
  const unitTerms = { unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500', security_deposit_amount: '1000' };
  unitA = (await owner.post(`/api/properties/${propA.property_id}/units`, { unit_name: '1201', ...unitTerms })).data.unit;
  unitB = (await owner.post(`/api/properties/${propB.property_id}/units`, { unit_name: '2F-3', ...unitTerms })).data.unit;
  manager = await invite('manager-c12@example.com', 'manager', [propA.property_id]);
  staff = await invite('staff-c12@example.com', 'staff', [propA.property_id]);
  cleaner = await addCleaner('cleaner-c12@example.com', 'Cora Cleaner', propA.property_id);
  other = await ownerAccount(srv.base, 'other-c12@example.com', 'Other Lets');
});

test.after(async () => { await srv.close(); });

test('an owner logs a found item on a listing with no stay or task, and it is audited', async () => {
  const before = await itemCount();
  const r = await owner.post('/api/lost-found', { unit_id: unitA.unit_id, description: 'Blue umbrella', found_where: 'Lobby', found_on: manilaToday() });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const item = r.data.item;
  assert.equal(item.status, 'held');
  assert.equal(item.description, 'Blue umbrella');
  assert.equal(item.found_where, 'Lobby');
  assert.equal(String(item.found_on).slice(0, 10), manilaToday());
  assert.equal(item.unit_id, unitA.unit_id);
  assert.equal(item.unit_name, '1201');
  assert.equal(item.property_name, 'Azure');
  assert.equal(item.booking_id, null, 'no stay to link it to');
  assert.equal(item.task_id, null, 'no task to link it to');
  assert.equal(item.guest_name, null);
  assert.equal(item.found_by_name, 'Maria Santos');
  assert.equal(await itemCount(), before + 1);

  const audit = await sql("SELECT actor_user_id, details FROM audit_logs WHERE action = 'lost_found.reported' AND record_id = $1", [item.item_id]);
  assert.equal(audit.length, 1, 'the new item is audited');
  assert.equal(audit[0].actor_user_id, ownerId);
  assert.equal(audit[0].details.unit_id, unitA.unit_id);

  const held = await owner.get('/api/lost-found?status=held');
  assert.ok(held.data.items.some((i) => i.item_id === item.item_id), 'it shows in the held list');
});

test('a manager logs an item on a listing in a property they are assigned to; a blank place is left out', async () => {
  const r = await manager.post('/api/lost-found', { unit_id: unitA.unit_id, description: 'House keys', found_where: '', found_on: manilaToday() });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.item.found_by_name, 'manager-c12@example.com');
  assert.equal(r.data.item.found_where, null);
});

test('a listing the person cannot see is 404: another property, another workspace, or no such listing', async () => {
  const before = await itemCount();
  assert.equal((await manager.post('/api/lost-found', { unit_id: unitB.unit_id, description: 'Scarf' })).status, 404, 'a manager on another property');
  assert.equal((await other.post('/api/lost-found', { unit_id: unitA.unit_id, description: 'Scarf' })).status, 404, 'another workspace');
  assert.equal((await owner.post('/api/lost-found', { unit_id: NO_ID, description: 'Scarf' })).status, 404, 'no such listing');
  assert.equal(await itemCount(), before, 'nothing is written');
});

test('staff and cleaners are refused, and no one signed in gets 401', async () => {
  const body = { unit_id: unitA.unit_id, description: 'Scarf' };
  const before = await itemCount();
  assert.equal((await client(srv.base).post('/api/lost-found', body)).status, 401);
  assert.equal((await staff.post('/api/lost-found', body)).status, 403, 'staff log items from a stay');
  assert.equal((await cleaner.post('/api/lost-found', body)).status, 403, 'cleaners log items from their task');
  assert.equal(await itemCount(), before, 'nothing is written');
});

test('a missing or bad listing, a blank description or a future date is refused before anything is written', async () => {
  const before = await itemCount();
  const noUnit = await owner.post('/api/lost-found', { description: 'Scarf' });
  assert.equal(noUnit.status, 400);
  assert.ok(noUnit.data.fields.unit_id, 'the listing is named');
  const badUnit = await owner.post('/api/lost-found', { unit_id: 'not-a-listing', description: 'Scarf' });
  assert.equal(badUnit.status, 400);
  assert.ok(badUnit.data.fields.unit_id);
  const blank = await owner.post('/api/lost-found', { unit_id: unitA.unit_id, description: '   ' });
  assert.equal(blank.status, 400);
  assert.ok(blank.data.fields.description);
  const future = await owner.post('/api/lost-found', { unit_id: unitA.unit_id, description: 'Keys', found_on: tomorrow() });
  assert.equal(future.status, 400);
  assert.ok(future.data.fields.found_on);
  assert.equal(await itemCount(), before, 'nothing is written');
});

test('the Lost and found page has an Add item form, and the Supplies used dialog has no Save when nothing is set up', () => {
  const lf = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/lostfound.js'), 'utf8');
  assert.match(lf, /'\+ Add item'/, 'the page has an Add item button');
  assert.match(lf, /post\('\/lost-found', d\)/, 'the form posts to the new route');
  assert.match(lf, /get\('\/listings'\)/, 'the listings come from the ones the person can see');
  assert.match(lf, /name: 'unit_id', label: 'Listing', type: 'select', required: true/, 'a single listing is preselected by the form');
  assert.match(lf, /name: 'found_on', label: 'Date found', type: 'date', value: todayManila\(\)/, 'date found defaults to today');

  const hk = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/housekeeping.js'), 'utf8');
  const modal = hk.slice(hk.indexOf('async function suppliesModal'), hk.indexOf('function workOrderModal'));
  const start = modal.indexOf('if (!supplies?.length)');
  assert.ok(start > 0, 'the empty case is handled before the form is built');
  const empty = modal.slice(start, modal.indexOf('return;', start) + 'return;'.length);
  assert.doesNotMatch(empty, /formModal|submitText|T\('Save'\)/, 'no Save button when nothing is set up');
  assert.match(empty, /href: '#\/supplies'/, 'owners and managers are sent to Supplies');
  assert.match(empty, /T\('Set up supplies'\)/, 'the link is named');
  assert.match(empty, /T\('Tell your manager\.'\)/, 'a cleaner is told to tell the manager');
  assert.match(modal, /submitText: T\('Save'\)/, 'the normal form keeps its Save');
});
