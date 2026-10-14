'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

// QA round 11, lane C09. #18: GET /properties/:id returns the active lease's rent as lease_rent and the property page uses it.
// K1: a voided rent payment has no Print receipt and prints a VOID block. K7: lease create and edit lock the unit row first.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_05 node --test --test-concurrency=1 test/qa-r11-c09.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, ownerAccount, manilaToday } = require('./helpers');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
let srv; let owner; let staff; let prop; let tenant;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qar11c09@example.com', 'QA R11 C09');
  prop = (await owner.post('/api/properties', { property_name: 'Lease Rent Court', property_type: 'apartment', address: '1 Rent St', city: 'Quezon City', province: 'Metro Manila' })).data.property;
  tenant = (await owner.post('/api/tenants', { full_name: 'Rent Tenant', phone: '09171230000' })).data.tenant;
  const inv = await owner.post('/api/team/invitations', { email: 'qar11c09-staff@example.com', role: 'staff', property_ids: [prop.property_id] });
  staff = client(srv.base);
  await staff.post('/api/auth/signup', { full_name: 'Staff', email: 'qar11c09-staff@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
});
test.after(async () => { await srv.close(); });

test('#18 an occupied unit returns the lease rent beside the list rent; a vacant unit returns null', async () => {
  const mk = async (name) => (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: name, unit_type: 'apartment', monthly_rent: '12000' })).data.unit;
  const taken = await mk('R11 Taken');
  const free = await mk('R11 Free');
  const l = await owner.post('/api/leases', { tenant_id: tenant.tenant_id, unit_id: taken.unit_id, start_date: manilaToday(), monthly_rent: '9500', due_day: 5 });
  assert.equal(l.status, 201, JSON.stringify(l.data));
  for (const who of [owner, staff]) {
    const { status, data } = await who.get(`/api/properties/${prop.property_id}`);
    assert.equal(status, 200);
    const byName = (n) => data.units.find((u) => u.unit_name === n);
    assert.equal(byName('R11 Taken').monthly_rent, '12000.00');
    assert.equal(byName('R11 Taken').lease_rent, '9500.00');
    assert.equal(byName('R11 Free').lease_rent, null);
  }
  assert.ok(free.unit_id);
});

test('#18 the property page shows the lease rent and the Rent roll sums it', () => {
  const src = read('public', 'js', 'views', 'properties.js');
  assert.match(src, /Number\(u\.lease_rent \?\? u\.monthly_rent\)/);
  assert.ok(src.includes("'Monthly rent from current leases'"));
  assert.ok(!src.includes("'Monthly rent from occupied units'"));
  assert.ok(src.includes('(lease)') && src.includes('listed '));
});

test('K1 a voided payment has no Print receipt and its print block starts with VOID', () => {
  const src = read('public', 'js', 'views', 'rent.js');
  const detail = src.slice(src.indexOf('export async function paymentDetailView'), src.indexOf('export async function expenseDetailView'));
  assert.match(detail, /!p\.voided_at && h\('button', \{ class: 'btn btn--secondary', onclick: \(\) => window\.print\(\) \}, 'Print receipt'\)/);
  const block = detail.slice(detail.indexOf("class: 'card print-only'"));
  assert.ok(block.includes('VOID: this payment was voided on '));
  assert.ok(block.includes('It is not a receipt.'));
  assert.ok(block.indexOf('VOID: this payment') < block.indexOf("'Tenant'"), 'the VOID line comes first');
});

test('K7 lease create and a later end date lock the unit row before stayClashes', () => {
  const src = read('src', 'routes', 'tenants.js');
  const post = src.slice(src.indexOf("router.post('/leases'"), src.indexOf("router.get('/leases/:id'"));
  assert.ok(post.includes('SELECT unit_id FROM units WHERE unit_id = $1 FOR UPDATE'));
  assert.ok(post.indexOf('FROM units WHERE unit_id = $1 FOR UPDATE') < post.indexOf('stayClashes('));
  const patch = src.slice(src.indexOf("router.patch('/leases/:id'"), src.indexOf("router.post('/leases/:id/end'"));
  assert.ok(patch.includes('SELECT unit_id FROM units WHERE unit_id = $1 FOR UPDATE'));
  assert.ok(patch.indexOf('FROM units WHERE unit_id = $1 FOR UPDATE') < patch.indexOf('stayClashes('));
});
