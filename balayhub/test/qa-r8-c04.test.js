'use strict';

// QA round 8, lane C04 (owners). Covers #35 (an owner edit names only the fields whose stored value changed, and a save
// that changes nothing writes no row), #36 (a blank management fee is refused on a percentage model, on add and on edit),
// #38 (a unit filter for a unit that is not in this workspace is ignored), #37 (the count line is drawn after the filter
// bar, which drops values that are not options), #40/#44 (every owner card control names its owner), #41 (the quick
// filter says what "Any" covers), and the repeated-control sweep of the statements and payout and reserve Void buttons.
// node --test --test-concurrency=1 test/qa-r8-c04.test.js

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, sql, ownerAccount } = require('./helpers');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'owners.js'), 'utf8');

let srv; let host; let a; let b; let spare;
const createOwner = async (body) => {
  const r = await host.post('/api/unit-owners', body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.owner_id;
};
const ownerUpdates = (id) => sql(
  `SELECT details FROM audit_logs WHERE action = 'unit_owner.updated' AND record_id = $1 ORDER BY audit_id`, [id]);

test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Managed Stays');
  const p = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  a = (await host.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  b = (await host.post(`/api/properties/${p.property_id}/units`, { unit_name: '805', unit_type: 'studio', nightly_rate: '1500' })).data.unit;
  spare = (await host.post(`/api/properties/${p.property_id}/units`, { unit_name: '310', unit_type: 'studio', nightly_rate: '1500' })).data.unit;
});
test.after(async () => { await srv.close(); });

test('an owner edit names only the fields whose stored value changed, and a save that changes nothing writes no row', async () => {
  const id = await createOwner({ full_name: 'Audit Owner', email: 'audit@example.com', management_fee_pct: '20', unit_ids: [a.unit_id] });
  // The owner form sends every field back on each save.
  const whole = {
    full_name: 'Audit Owner', email: 'audit@example.com', phone: '', management_fee_pct: '20', fee_model: 'net_pct',
    flat_monthly_fee: '0', reserve_target: '0', reserve_monthly: '0', cleaning_to_manager: true, notes: '', unit_ids: [a.unit_id],
  };
  assert.equal((await host.patch(`/api/unit-owners/${id}`, whole)).status, 200);
  assert.equal((await ownerUpdates(id)).length, 0, 'a save that changes nothing writes no row');

  assert.equal((await host.patch(`/api/unit-owners/${id}`, { ...whole, management_fee_pct: '15' })).status, 200);
  assert.deepEqual((await ownerUpdates(id)).map((r) => r.details), [{ fields: ['management_fee_pct'] }]);

  // The same two units in another order is no change; a different set of units is.
  assert.equal((await host.patch(`/api/unit-owners/${id}`, { ...whole, management_fee_pct: '15', unit_ids: [b.unit_id, a.unit_id] })).status, 200);
  assert.equal((await host.patch(`/api/unit-owners/${id}`, { ...whole, management_fee_pct: '15', unit_ids: [a.unit_id, b.unit_id] })).status, 200);
  assert.deepEqual((await ownerUpdates(id)).map((r) => r.details.fields), [['management_fee_pct'], ['unit_ids']]);
  assert.doesNotMatch(JSON.stringify(await ownerUpdates(id)), /15\.00|audit@example/, 'the log holds names, never values');
});

test('a blank management fee is refused on a percentage model, on add and on edit, and the stored fee is kept', async () => {
  const add = await host.post('/api/unit-owners', { full_name: 'Blank Fee', management_fee_pct: '' });
  assert.equal(add.status, 400);
  assert.equal(add.data.fields.management_fee_pct, 'Management fee is required.');

  const id = await createOwner({ full_name: 'Fee Owner', management_fee_pct: '15' });
  const edit = await host.patch(`/api/unit-owners/${id}`, { management_fee_pct: '' });
  assert.equal(edit.status, 400);
  assert.equal(edit.data.fields.management_fee_pct, 'Management fee is required.');
  assert.equal((await sql('SELECT management_fee_pct FROM unit_owners WHERE owner_id = $1', [id]))[0].management_fee_pct, '15.00');

  // Leaving the fee out of an add still takes the default; a flat-fee owner has no percentage to leave blank.
  assert.equal((await host.post('/api/unit-owners', { full_name: 'Default Fee' })).status, 201);
  assert.equal((await host.post('/api/unit-owners', { full_name: 'Flat Fee', fee_model: 'flat', flat_monthly_fee: '1000', management_fee_pct: '' })).status, 201);
  assert.equal((await host.patch(`/api/unit-owners/${id}`, { fee_model: 'flat', flat_monthly_fee: '1000', management_fee_pct: '' })).status, 200);
});

test('a unit filter for a unit that is not in this workspace is ignored; a unit of this workspace still filters', async () => {
  const zero = '00000000-0000-0000-0000-000000000000';
  const other = await ownerAccount(srv.base, 'other-r8c04@example.com', 'Other Stays');
  const op = (await other.post('/api/properties', { property_name: 'Elsewhere', property_type: 'condominium', address: 'Ayala Ave', city: 'Makati', province: 'Metro Manila' })).data.property;
  const foreign = (await other.post(`/api/properties/${op.property_id}/units`, { unit_name: '9', unit_type: 'studio', nightly_rate: '1000' })).data.unit;
  const all = (await host.get('/api/unit-owners')).data.owners;
  const ids = (list) => list.map((o) => o.owner_id).sort();
  assert.ok(all.length >= 2);

  assert.deepEqual(ids((await host.get(`/api/unit-owners?unit_id=${zero}`)).data.owners), ids(all));
  assert.deepEqual(ids((await host.get(`/api/unit-owners?unit_id=${foreign.unit_id}`)).data.owners), ids(all));

  const owning = all.filter((o) => o.unit_ids.includes(a.unit_id));
  assert.equal(owning.length, 1);
  assert.deepEqual(ids((await host.get(`/api/unit-owners?unit_id=${a.unit_id}`)).data.owners), ids(owning));
  // A unit of this workspace that no owner has gives an empty list.
  assert.deepEqual((await host.get(`/api/unit-owners?unit_id=${spare.unit_id}`)).data.owners, []);
});

test('the count line is drawn after the filter bar, so a value the bar drops is not counted as a filter', () => {
  const bar = src.indexOf('const bar = showBar && filterBar({');
  assert.ok(bar > -1, 'the filter bar is built');
  assert.ok(src.indexOf('\n  draw();\n') > bar, 'the first draw runs after the bar is built');
});

test('every button and link on an owner card names its owner', () => {
  const card = src.slice(src.indexOf("owners.map((o) => h('div', { class: 'card' }"), src.indexOf('async function load()'));
  const controls = card.match(/h\('(button|a)',/g) || [];
  const named = card.match(/'aria-label': `[^`]*\$\{o\.full_name\}`/g) || [];
  assert.equal(controls.length, 7, 'Edit, Remove, two statement links and the portal buttons');
  assert.equal(named.length, controls.length, 'each control carries the owner name');
});

test('the owners quick filter says what Any covers', () => {
  assert.match(src, /label: 'Units', all: 'Any number of units', options: \[\['yes', 'Has units'\]/);
});

test('the statements list and the payout and reserve Void buttons name their row', () => {
  assert.match(src, /'aria-label': `\$\{r\.status === 'published' \? 'Open' : 'Review'\} statement, \$\{r\.full_name\}`/);
  assert.match(src, /'aria-label': `Void payout of \$\{peso\(p\.amount\)\} on \$\{fmtDate\(p\.paid_on\)\}`/);
  assert.match(src, /'aria-label': `Void withdrawal of \$\{peso\(e\.amount\)\} on \$\{fmtDate\(e\.entry_date\)\}`/);
});

test('the management fee box is required on a percentage model and not on a flat one', () => {
  assert.match(src, /pct\.querySelector\('input'\)\.required = v !== 'flat'/);
});
