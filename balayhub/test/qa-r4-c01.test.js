'use strict';
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');

// QA round 4, C01: a comma in an amount is accepted only as a thousands separator ("1,5" must not save as 15).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validate } = require('../src/lib/validate');
const ical = require('../src/lib/ical');

const spec = { amount: { type: 'money', label: 'Amount' } };
const run = (v) => { try { return { ok: validate({ amount: v }, spec).amount }; } catch (e) { return { err: e.extra && e.extra.fields && e.extra.fields.amount }; } };

test('money: commas as thousands separators are accepted', () => {
  assert.equal(run('1,000').ok, '1000.00');
  assert.equal(run('12,500.50').ok, '12500.50');
  assert.equal(run('₱1,250').ok, '1250.00');
  assert.equal(run('1000').ok, '1000.00');
  assert.equal(run('PHP 1,250.5').ok, '1250.50');
  assert.equal(run('1,234,567').ok, '1234567.00');
});

test('money: a misplaced comma is refused, never silently removed', () => {
  for (const bad of ['1,5', '1,50', '1,0000', ',500', '1,,000', '12,50.00', '1,000,00', '1,000.', '1,5.00']) {
    const r = run(bad);
    assert.ok(r.err && /valid amount/.test(r.err), `${bad} -> ${JSON.stringify(r)}`);
  }
});

test('the bulk price form no longer strips commas in the browser', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/pricing.js'), 'utf8');
  assert.ok(!/price\.value\.replace\(/.test(src), 'price is sent as typed');
});

test('bulk set price: the server judges the commas', async () => {
  const srv = await startServer();
  try {
    const owner = await ownerAccount(srv.base, 'c01-owner@example.com', 'C01 Stays');
    const prop = (await owner.post('/api/properties', { property_name: 'C01 Tower', property_type: 'condominium', address: 'A St', city: 'Taguig', province: 'Metro Manila' })).data.property;
    const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'U1', unit_type: 'studio', nightly_rate: '2500' })).data.unit;
    const d = (n) => ical.addDays(manilaToday(), n);
    const base = { unit_ids: [unit.unit_id], from: d(10), to: d(11), action: 'set', dry_run: true };
    const bad = await owner.post('/api/bulk/prices', { ...base, price: '1,5' });
    assert.equal(bad.status, 400, JSON.stringify(bad.data));
    assert.ok(bad.data.fields.price);
    const good = await owner.post('/api/bulk/prices', { ...base, price: '1,000' });
    assert.equal(good.status, 200, JSON.stringify(good.data));
  } finally { await srv.close(); }
});
