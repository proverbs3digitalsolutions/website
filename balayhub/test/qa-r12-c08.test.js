'use strict';

// QA round 12, lane C08 (longterm-rent).
// #19: ending a lease moves a charge that falls due after the move-out day to the move-out day.
// #18/#22/#20/#21/K14/K15: source scans of rent.js and reports.js (the DOM-heavy views are checked in the browser).
// node --test --test-concurrency=1 test/qa-r12-c08.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ownerAccount, manilaToday, addMonths, sql } = require('./helpers');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const today = manilaToday();

let srv; let owner;
test.before(async () => { srv = await startServer(); owner = await ownerAccount(srv.base, 'owner-r12-c08@example.com', 'QA R12 C08'); });
test.after(async () => { await srv.close(); });

test('#19 ending a lease moves a later due date to the move-out day and leaves earlier ones alone', async () => {
  const p = (await owner.post('/api/properties', { property_name: 'Lagoon Flats', property_type: 'apartment', address: '1 Mabini St', city: 'Bacoor', province: 'Cavite' })).data.property.property_id;
  const unit = async (n) => (await owner.post(`/api/properties/${p}/units`, { unit_name: n, unit_type: 'room', monthly_rent: '5000' })).data.unit.unit_id;
  const tenant = async (n, e) => (await owner.post('/api/tenants', { full_name: n, email: e })).data.tenant.tenant_id;
  const lease = async (u, t, start) => (await owner.post('/api/leases', { tenant_id: t, unit_id: u, start_date: start, monthly_rent: '5000', due_day: 5 })).data.lease.lease_id;
  const first = addMonths(today, 0);
  const a = await lease(await unit('Room A'), await tenant('Ana', 'ana-c08@example.com'), first);
  const b = await lease(await unit('Room B'), await tenant('Ben', 'ben-c08@example.com'), addMonths(today, -2));
  // Ana's move-in charge falls due the day after she leaves; Ben's older charges fell due long before.
  await sql('UPDATE rent_charges SET due_date = $2 WHERE lease_id = $1', [a, addDays(today, 1)]);
  const benBefore = await sql('SELECT period, due_date::text AS due_date FROM rent_charges WHERE lease_id = $1 ORDER BY period', [b]);
  for (const id of [a, b]) {
    const r = await owner.post(`/api/leases/${id}/end`, { end_date: today, lease_status: 'ended' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  const ana = await sql('SELECT due_date::text AS due_date FROM rent_charges WHERE lease_id = $1', [a]);
  assert.deepEqual(ana.map((r) => r.due_date), [today], 'the move-in charge is due on the move-out day');
  const benAfter = await sql('SELECT period, due_date::text AS due_date FROM rent_charges WHERE lease_id = $1 ORDER BY period', [b]);
  const early = (rows) => rows.filter((r) => r.due_date <= today);
  assert.deepEqual(early(benAfter).filter((r) => early(benBefore).some((x) => x.period === r.period && x.due_date === r.due_date)).length, early(benBefore).length, 'a charge due before the move-out is untouched');
});

test('#18 the rent view sends its filters through apiFilters', () => {
  const src = read('public', 'js', 'views', 'rent.js');
  assert.match(src, /import \{[^}]*\bapiFilters\b[^}]*\} from '\.\.\/filters\.js'/);
  assert.ok(src.includes('const apiQuery = () => qs(apiFilters(valuesFor(tab), TABS[tab].defaults));'));
  assert.ok(!/qs\(changed\(valuesFor/.test(src), 'no request is built from changed()');
});

test('#20 the cards say what they count when the list is narrowed by more than property', () => {
  const src = read('public', 'js', 'views', 'rent.js');
  assert.ok(src.includes('The cards count all unpaid rent, every month and tenant'));
  assert.ok(src.includes('cardsCaption'));
});

test('#22 Month and Property sit under More filters for a workspace of 3 or fewer active units', () => {
  const src = read('public', 'js', 'views', 'rent.js');
  assert.match(src, /export const compactRentFilters = \(unitCount\) => unitCount <= 3;/);
  assert.ok(src.includes('compactRentFilters(units.length)'));
  assert.ok(src.includes('const monthProp = ['), 'month and property are built once');
  assert.ok(src.includes('quick: compact ? [] : monthProp'));
  assert.ok(src.includes('...(compact ? monthProp : [])'));
});

test('#21 the By month card spans the full width, not half of grid--2', () => {
  const src = read('public', 'js', 'views', 'reports.js');
  const i = src.indexOf("h2', null, 'By month'");
  assert.ok(i > 0);
  assert.ok(!src.slice(i - 300, i).includes('grid--2'), 'By month is not inside grid--2');
  assert.ok(src.includes("h2', null, 'Expenses by category'"));
});

test('K14 Export is aria-disabled, with no address and a hint, while the range is incomplete', () => {
  const src = read('public', 'js', 'views', 'reports.js');
  assert.ok(src.includes("exportLink.setAttribute('aria-disabled', 'true')"));
  assert.ok(src.includes("exportLink.removeAttribute('aria-disabled')"));
  assert.ok(src.includes('Pick both dates to export.'));
});

test('K15 the By property total row shows occupied over units', () => {
  const src = read('public', 'js', 'views', 'reports.js');
  assert.ok(src.includes("h('td', { class: 'num' }, `${r.by_property.reduce((s, p) => s + Number(p.occupied), 0)}/${r.by_property.reduce((s, p) => s + Number(p.units), 0)}`)"));
});

test('#19 moving a lease end date earlier also caps a later due date', async () => {
  const p = (await owner.post('/api/properties', { property_name: 'Cap Flats', property_type: 'apartment', address: '2 Mabini St', city: 'Bacoor', province: 'Cavite' })).data.property.property_id;
  const u = (await owner.post(`/api/properties/${p}/units`, { unit_name: 'Room C', unit_type: 'room', monthly_rent: '5000' })).data.unit.unit_id;
  const t = (await owner.post('/api/tenants', { full_name: 'Cap', email: 'cap-c08@example.com' })).data.tenant.tenant_id;
  const l = (await owner.post('/api/leases', { tenant_id: t, unit_id: u, start_date: addMonths(today, 0), monthly_rent: '5000', due_day: 5 })).data.lease.lease_id;
  await sql('UPDATE rent_charges SET due_date = $2 WHERE lease_id = $1', [l, addDays(today, 1)]);
  const r = await owner.patch(`/api/leases/${l}`, { end_date: today });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rows = await sql('SELECT due_date::text AS due_date FROM rent_charges WHERE lease_id = $1', [l]);
  assert.deepEqual(rows.map((x) => x.due_date), [today]);
});
