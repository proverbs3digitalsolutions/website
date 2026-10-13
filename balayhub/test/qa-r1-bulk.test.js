'use strict';

// QA round 1, lane L13 (bulk): a 0% change is refused, a nightly price cannot go above 1,000,000,
// and a block needs a reason on the server, as the form requires.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const today = manilaToday();
const d = (n) => ical.addDays(today, n);

let srv; let owner; let a1; let a2;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'l13-bulk-owner@example.com', 'L13 Bulk Stays');
  const prop = (await owner.post('/api/properties', { property_name: 'Calm Tower', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const make = async (body) => {
    const r = await owner.post(`/api/properties/${prop.property_id}/units`, body);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.unit;
  };
  a1 = await make({ unit_name: 'C1', unit_type: 'studio', nightly_rate: '2500' });
  a2 = await make({ unit_name: 'C2', unit_type: 'studio', nightly_rate: '2500' });
});
test.after(async () => { await srv.close(); });

const priceRows = async (unitId) => (await sql('SELECT price FROM nightly_rates WHERE unit_id = $1', [unitId])).map((r) => r.price);
const blockRows = async (unitId) => sql(`SELECT block_reason FROM bookings WHERE unit_id = $1 AND kind = 'block'`, [unitId]);

test('bulk prices: a change of 0% is refused in the preview and the apply, and writes nothing', async () => {
  const body = { unit_ids: [a1.unit_id], from: d(10), to: d(11), action: 'percent', percent: 0 };
  for (const dry_run of [true, false]) {
    const r = await owner.post('/api/bulk/prices', { ...body, dry_run });
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.equal(r.data.fields.percent, 'Choose a change other than 0%.');
  }
  assert.deepEqual(await priceRows(a1.unit_id), []);
});

test('bulk prices: a nightly price above 1,000,000 is refused; exactly 1,000,000 is allowed', async () => {
  const base = { unit_ids: [a1.unit_id], from: d(10), to: d(10), action: 'set' };
  for (const price of ['1000000.01', '99999999.99']) {
    for (const dry_run of [true, false]) {
      const r = await owner.post('/api/bulk/prices', { ...base, price, dry_run });
      assert.equal(r.status, 400, `${price}: ${JSON.stringify(r.data)}`);
      assert.equal(r.data.fields.price, "A nightly price can't be more than ₱1,000,000.");
    }
  }
  assert.deepEqual(await priceRows(a1.unit_id), []);

  const cap = await owner.post('/api/bulk/prices', { ...base, price: '1000000', dry_run: true });
  assert.equal(cap.status, 200, JSON.stringify(cap.data));
  assert.equal(cap.data.changes[0].to_price, '1000000.00');
});

test('bulk prices: a percentage change that would take a night above 1,000,000 is refused', async () => {
  await owner.post('/api/bulk/prices', { unit_ids: [a2.unit_id], from: d(20), to: d(20), action: 'set', price: '900000' });
  const body = { unit_ids: [a2.unit_id], from: d(20), to: d(20), action: 'percent', percent: 20 };
  const preview = await owner.post('/api/bulk/prices', { ...body, dry_run: true });
  assert.equal(preview.status, 400, JSON.stringify(preview.data));
  assert.equal(preview.data.fields.percent, "A nightly price can't be more than ₱1,000,000.");
  const applied = await owner.post('/api/bulk/prices', { ...body, dry_run: false });
  assert.equal(applied.status, 400, JSON.stringify(applied.data));
  assert.deepEqual(await priceRows(a2.unit_id), ['900000.00']);

  // 900000 plus 11% is 999000, which is under the cap.
  const ok = await owner.post('/api/bulk/prices', { ...body, percent: 11, dry_run: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.changes[0].to_price, '999000.00');
});

test('bulk blocks: a block without a reason is refused by the server, the same as the form', async () => {
  const base = { unit_ids: [a1.unit_id], from: d(30), to: d(31), action: 'block' };
  for (const reason of [undefined, '', '   ']) {
    for (const dry_run of [true, false]) {
      const r = await owner.post('/api/bulk/blocks', { ...base, reason, dry_run });
      assert.equal(r.status, 400, `${JSON.stringify(reason)}: ${JSON.stringify(r.data)}`);
      assert.equal(r.data.fields.reason, 'Add a reason for the block.');
    }
  }
  assert.deepEqual(await blockRows(a1.unit_id), []);

  const ok = await owner.post('/api/bulk/blocks', { ...base, reason: 'Repairs' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual((await blockRows(a1.unit_id)).map((r) => r.block_reason), ['Repairs']);

  // Unblocking never asks for a reason.
  const unblock = await owner.post('/api/bulk/blocks', { ...base, action: 'unblock', reason: '' });
  assert.equal(unblock.status, 200, JSON.stringify(unblock.data));
  assert.equal(unblock.data.count, 1);
});
