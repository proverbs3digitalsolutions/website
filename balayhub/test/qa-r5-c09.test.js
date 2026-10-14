'use strict';

// QA round 5, C09 (money server): Home's monthly revenue counts extra charges in fees, as stay reports
// do (#24); a bulk price change leaves out nights already at the new price (#15); correcting an expense
// can't move it into the future (#17, Q3). The pricing screen's zero-change wording is a source scan.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ownerAccount, manilaToday, sql } = require('./helpers');
const ical = require('../src/lib/ical');

const today = manilaToday();
const d = (n) => ical.addDays(today, n);
const thisMonth = today.slice(0, 7);

let srv; let owner; let prop;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'c09-owner@example.com', 'C09 Stays');
  prop = (await owner.post('/api/properties', { property_name: 'C09 Tower', property_type: 'condominium', address: 'A St', city: 'Taguig', province: 'Metro Manila' })).data.property;
});
test.after(async () => { await srv.close(); });

const unitWith = async (name, fields) => {
  const r = await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: name, unit_type: 'studio', ...fields });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.unit;
};

test('#24: Home and stay reports both count extra charges in the month\'s fees', async () => {
  const unit = await unitWith('Revenue 1', { nightly_rate: '2500', cleaning_fee: '500' });
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(0), check_out: d(2), guest_name: 'Extras Guest', channel: 'direct' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const c = await owner.post(`/api/reservations/${r.data.reservation.booking_id}/charges`, { category: 'late_checkout', description: 'Late checkout', unit_price: '1500' });
  assert.equal(c.status, 201, JSON.stringify(c.data));

  const home = await owner.get(`/api/stays/revenue?month=${thisMonth}`);
  const reports = await owner.get(`/api/stay-reports?month=${thisMonth}`);
  assert.equal(home.status, 200);
  assert.equal(reports.status, 200);
  assert.equal(home.data.current.fees, '2000.00', 'cleaning fee 500 plus the 1,500 late check-out');
  assert.equal(home.data.current.total_revenue, (Number(home.data.current.accommodation) + 2000).toFixed(2));
  assert.equal(reports.data.totals.fees, home.data.current.fees, 'Home and stay reports agree on fees');
  assert.equal(reports.data.totals.revenue, home.data.current.total_revenue, 'Home and stay reports agree on revenue');

  const voided = await owner.post(`/api/charges/${c.data.charge.charge_id}/void`, { reason: 'Waived' });
  assert.equal(voided.status, 200, JSON.stringify(voided.data));
  const after = await owner.get(`/api/stays/revenue?month=${thisMonth}`);
  assert.equal(after.data.current.fees, '500.00', 'a voided charge is left out');
  const afterReports = await owner.get(`/api/stay-reports?month=${thisMonth}`);
  assert.equal(afterReports.data.totals.fees, after.data.current.fees);
});

test('#15: a set-price preview and apply leave out nights already at that price', async () => {
  const unit = await unitWith('Bulk 1', { nightly_rate: '2000' });
  // Three nights, all at 2,000 from the usual rate: nothing would change, and Apply writes no rate.
  const base = { unit_ids: [unit.unit_id], from: d(10), to: d(12), action: 'set', price: '2000' };
  const preview = await owner.post('/api/bulk/prices', { ...base, dry_run: true });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.count, 0);
  assert.deepEqual(preview.data.changes, []);
  const apply = await owner.post('/api/bulk/prices', { ...base, dry_run: false });
  assert.equal(apply.status, 200, JSON.stringify(apply.data));
  assert.equal(apply.data.count, 0);
  const rows = await sql('SELECT COUNT(*)::int AS n FROM nightly_rates WHERE unit_id = $1', [unit.unit_id]);
  assert.equal(rows[0].n, 0, 'no night was written at its usual price');
});

test('#15: only the nights whose price changes are listed and written', async () => {
  const unit = await unitWith('Bulk 2', { nightly_rate: '2500' });
  const rate = await owner.raw('PUT', '/api/rates', { unit_id: unit.unit_id, start_date: d(11), end_date: d(11), price: '2000' });
  assert.equal(rate.status, 200, JSON.stringify(rate.data));
  const base = { unit_ids: [unit.unit_id], from: d(10), to: d(12), action: 'set', price: '2000' };
  const preview = await owner.post('/api/bulk/prices', { ...base, dry_run: true });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.count, 2);
  assert.deepEqual(preview.data.changes.map((c) => c.date), [d(10), d(12)], 'the night already at 2,000 is not listed');
  const apply = await owner.post('/api/bulk/prices', { ...base, dry_run: false });
  assert.equal(apply.data.count, 2);
  const rows = await sql('SELECT rate_date::text AS date, price FROM nightly_rates WHERE unit_id = $1 ORDER BY rate_date', [unit.unit_id]);
  assert.deepEqual(rows.map((r) => r.date), [d(10), d(11), d(12)]);
  assert.ok(rows.every((r) => r.price === '2000.00'));
});

test('#15: the bulk preview says none would change, not "0 nights would change"', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/pricing.js'), 'utf8');
  assert.match(src, /None of these nights would change\./);
});

test('#17: correcting an expense refuses a future date, as adding one does', async () => {
  const created = await owner.post('/api/expenses', { property_id: prop.property_id, category: 'repairs', description: 'Pump', amount: '500', expense_date: today });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.expense.expense_id;

  const future = await owner.patch(`/api/expenses/${id}`, { expense_date: d(1) });
  assert.equal(future.status, 400, JSON.stringify(future.data));
  assert.ok(future.data.fields.expense_date, JSON.stringify(future.data));
  assert.equal(future.data.fields.expense_date, 'Expense date cannot be in the future.');
  const unchanged = await owner.get(`/api/expenses/${id}`);
  assert.equal(String(unchanged.data.expense.expense_date).slice(0, 10), today, 'the refused date was not saved');

  const todayOk = await owner.patch(`/api/expenses/${id}`, { expense_date: today });
  assert.equal(todayOk.status, 200, JSON.stringify(todayOk.data));
  const earlier = await owner.patch(`/api/expenses/${id}`, { expense_date: d(-3) });
  assert.equal(earlier.status, 200, JSON.stringify(earlier.data));
});

test('cancelling "Change the existing rule?" keeps the rule form and its draft (return false, C08 contract)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/pricing.js'), 'utf8');
  const cancels = src.match(/if \(!await replaceRule\([^)]*\)\) return[^;]*;/g) || [];
  assert.equal(cancels.length, 2, `two cancel paths expected, found ${cancels.length}`);
  for (const c of cancels) assert.match(c, /return false;$/, c);
});

test('clearing custom prices says "Set prices cleared for N nights." (singular for one); other actions keep their wording', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/pricing.js'), 'utf8');
  const wording = src.match(/`(Set prices cleared for \$\{n\} night\$\{n === 1 \? '' : 's'\})`/);
  assert.ok(wording, 'the clear-prices toast wording is in pricing.js');
  const say = new Function('n', `return \`${wording[1]}\`;`);
  assert.equal(say(3), 'Set prices cleared for 3 nights');
  assert.equal(say(1), 'Set prices cleared for 1 night');
  assert.match(src, /'cancelled' : actSel\.value === 'block' \? 'created' : 'updated'/, 'the other actions keep their verbs');
});
