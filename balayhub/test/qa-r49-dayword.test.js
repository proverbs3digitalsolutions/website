'use strict';

const { startServer, ownerAccount } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { quote } = require('../src/lib/pricing');
const { addDays } = require('../src/lib/holidays');

// Round 49 C4: the last-minute label says "day" for one day and "days" for any other count (D-131 (b)).
// A fixed "today" keeps the booking-window rule deterministic.
const TODAY = '2027-09-06';
const day = (n) => addDays(TODAY, n);

let srv; let owner; let harbor;

async function lastMinuteUnit(name, days) {
  const u = await owner.post(`/api/properties/${harbor.property_id}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '2000' });
  assert.equal(u.status, 201, JSON.stringify(u.data));
  const r = await owner.post('/api/pricing/rules', { kind: 'last_minute', days, adjust_pct: 10, unit_id: u.data.unit.unit_id });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return u.data.unit;
}

// The label of the last-minute rule as it is applied to the first night of a one-night stay.
async function lastMinuteLabel(unit, checkIn) {
  const q = await quote(unit.unit_id, checkIn, addDays(checkIn, 1), undefined, { today: TODAY });
  const rule = q.nights[0].applied.find((a) => a.kind === 'last_minute');
  assert.ok(rule, `no last-minute rule applied: ${JSON.stringify(q.nights[0].applied)}`);
  return rule.label;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'dayword-host@example.com', 'Dayword Host');
  harbor = (await owner.post('/api/properties', { property_name: 'Harbor', property_type: 'condominium', address: 'Bicutan Ave', city: 'Paranaque', province: 'Metro Manila' })).data.property;
});
test.after(async () => { await srv.close(); });

test('a one-day last-minute rule says "1 day" on a stay that starts tomorrow', async () => {
  const unit = await lastMinuteUnit('QA r49 dayword one day', 1);
  assert.equal(await lastMinuteLabel(unit, day(1)), 'Last minute: check-in within 1 day');
});

test('a three-day last-minute rule says "3 days" on a stay that starts tomorrow', async () => {
  const unit = await lastMinuteUnit('QA r49 dayword three days', 3);
  assert.equal(await lastMinuteLabel(unit, day(1)), 'Last minute: check-in within 3 days');
});

test('a zero-day last-minute rule says "0 days" on a stay that checks in today', async () => {
  const unit = await lastMinuteUnit('QA r49 dayword zero days', 0);
  assert.equal(await lastMinuteLabel(unit, day(0)), 'Last minute: check-in within 0 days');
});
