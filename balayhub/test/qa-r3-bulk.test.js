'use strict';

// QA round 3, lane C18 (bulk): the percentage field is labelled "Change (%)" on screen, so the
// refusal messages must name it that way, not "Change by".

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const today = manilaToday();
const d = (n) => ical.addDays(today, n);

let srv; let owner; let unit;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qa-r3-bulk-owner@example.com', 'QA r3 Bulk Stays');
  const prop = (await owner.post('/api/properties', { property_name: 'Bulk Tower', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const r = await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'U1', unit_type: 'studio', nightly_rate: '2500' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  unit = r.data.unit;
});
test.after(async () => { await srv.close(); });

test('bulk prices: a change below -90% is refused by name as "Change (%)", in the preview and the apply, and writes nothing', async () => {
  const body = { unit_ids: [unit.unit_id], from: d(10), to: d(11), action: 'percent', percent: -95 };
  for (const dry_run of [true, false]) {
    const r = await owner.post('/api/bulk/prices', { ...body, dry_run });
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.equal(r.data.fields.percent, 'Change (%) must be at least -90.');
  }
  assert.deepEqual(await sql('SELECT price FROM nightly_rates WHERE unit_id = $1', [unit.unit_id]), []);
});

test('bulk prices: a nightly price of 0 is refused by the name on screen, "New price per night", in the preview and the apply', async () => {
  const body = { unit_ids: [unit.unit_id], from: d(10), to: d(10), action: 'set', price: '0' };
  for (const dry_run of [true, false]) {
    const r = await owner.post('/api/bulk/prices', { ...body, dry_run });
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.equal(r.data.fields.price, 'New price per night must be greater than zero.');
  }
  assert.deepEqual(await sql('SELECT price FROM nightly_rates WHERE unit_id = $1', [unit.unit_id]), []);
});

test('bulk prices: a change above 300% is refused by name as "Change (%)"', async () => {
  const r = await owner.post('/api/bulk/prices', { unit_ids: [unit.unit_id], from: d(10), to: d(11), action: 'percent', percent: 301, dry_run: true });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.percent, 'Change (%) must be at most 300.');
});
