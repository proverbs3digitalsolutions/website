'use strict';

// QA round 1, lane L14. A unit's nightly, weekend, holiday and lowest price must be above zero
// when set (#21). Blank or null still clears a weekend rate. Monthly rent must be above zero
// when set (#30). The expenses-by-category export prints the same labels as the reports screen (#32).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, manilaToday } = require('./helpers');

let srv; let owner; let prop;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'rates-l14@example.com', 'Rates L14');
  prop = (await owner.post('/api/properties', { property_name: 'Rates House', property_type: 'apartment', address: '2 Rates Street', city: 'Makati', province: 'Metro Manila' })).data.property;
});
test.after(async () => { await srv.close(); });

const addUnit = (body) => owner.post(`/api/properties/${prop.property_id}/units`, { unit_type: 'studio', ...body });

test('#21 a nightly, weekend, holiday or lowest price of 0 is refused on create and update', async () => {
  const created = await addUnit({ unit_name: 'Zero create', nightly_rate: '0' });
  assert.equal(created.status, 400, JSON.stringify(created.data));
  assert.match(created.data.fields.nightly_rate, /greater than zero/);

  const unit = (await addUnit({ unit_name: 'Zero update', nightly_rate: '1000' })).data.unit;
  for (const field of ['nightly_rate', 'weekend_rate', 'holiday_rate', 'min_price']) {
    const r = await owner.patch(`/api/units/${unit.unit_id}`, { [field]: '0' });
    assert.equal(r.status, 400, field);
    assert.match(r.data.fields[field], /greater than zero/, field);
  }
  const after = (await owner.get(`/api/properties/${prop.property_id}`)).data.units.find((u) => u.unit_id === unit.unit_id);
  assert.equal(after.nightly_rate, '1000.00');
  assert.equal(after.weekend_rate, null);
});

test('#21 a blank weekend rate still clears it, and a positive rate saves', async () => {
  const unit = (await addUnit({ unit_name: 'Weekend clear', nightly_rate: '1000', weekend_rate: '1500' })).data.unit;
  assert.equal(unit.weekend_rate, '1500.00');
  const cleared = await owner.patch(`/api/units/${unit.unit_id}`, { weekend_rate: null });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
  assert.equal(cleared.data.unit.weekend_rate, null);
  const blank = await owner.patch(`/api/units/${unit.unit_id}`, { weekend_rate: '1800' });
  assert.equal(blank.data.unit.weekend_rate, '1800.00');
  assert.equal((await owner.patch(`/api/units/${unit.unit_id}`, { weekend_rate: '' })).data.unit.weekend_rate, null);
});

test('#21 a cleaning fee of 0 still saves', async () => {
  const r = await addUnit({ unit_name: 'Free cleaning', nightly_rate: '1000', cleaning_fee: '0' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.unit.cleaning_fee, '0.00');
});

test('#30 a monthly rent of 0 is refused on create and update, blank is still allowed', async () => {
  const created = await addUnit({ unit_name: 'Rent zero', monthly_rent: '0' });
  assert.equal(created.status, 400, JSON.stringify(created.data));
  assert.match(created.data.fields.monthly_rent, /greater than zero/);

  const unit = (await addUnit({ unit_name: 'Rent update', monthly_rent: '5000' })).data.unit;
  const r = await owner.patch(`/api/units/${unit.unit_id}`, { monthly_rent: '0' });
  assert.equal(r.status, 400);
  assert.match(r.data.fields.monthly_rent, /greater than zero/);

  const blank = await addUnit({ unit_name: 'Rent blank', nightly_rate: '1000' });
  assert.equal(blank.status, 201, JSON.stringify(blank.data));
  assert.equal(blank.data.unit.monthly_rent, '0.00');
});

test('#32 the expenses-by-category export prints the same labels as the reports screen', async () => {
  const today = manilaToday();
  const labels = {
    repairs: 'Repairs & maintenance', utilities: 'Utilities', taxes: 'Taxes & permits', insurance: 'Insurance',
    association_dues: 'Association dues', supplies: 'Supplies', salaries: 'Salaries & caretaker', cleaning: 'Cleaning', other: 'Other',
  };
  for (const category of Object.keys(labels)) {
    const r = await owner.post('/api/expenses', { property_id: prop.property_id, category, amount: '100', expense_date: today, description: category });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
  const csv = (await owner.get(`/api/reports/export?from=${today}&to=${today}`)).data;
  const lines = csv.split('\r\n');
  for (const label of Object.values(labels)) {
    assert.ok(lines.includes(`${label},100.00,1`), label);
  }
  assert.doesNotMatch(csv, /salaries|association_dues|cleaning,/);

  // The on-screen report keeps the raw code, because the screen links it to the expenses filter.
  const report = (await owner.get(`/api/reports?from=${today}&to=${today}`)).data;
  assert.ok(report.by_category.some((c) => c.category === 'salaries'));
});
