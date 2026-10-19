'use strict';

// QA round 19, lane PNL: the Profit and loss note counts the stays the "Past stays" list shows,
// so a stay checking out today (still on the Past stays list's "today" side) is not counted.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount } = require('./helpers');

const day = (offset) => new Date(Date.now() + 8 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
let srv; let host; let unit;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'pnl19@example.com', 'QA R19 PNL');
  const p = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await host.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const r = (ci, co, channel) => host.post('/api/reservations', { unit_id: unit.unit_id, check_in: ci, check_out: co, guest_name: 'G', channel });
  await r(day(-3), day(-1), 'airbnb'); // checked out yesterday: counted
  await r(day(-1), day(0), 'booking'); // checks out today: not counted
});
test.after(async () => { await srv.close(); });

test('missing-fees note leaves out stays checking out today', async () => {
  const total = {};
  for (const m of new Set([day(-1).slice(0, 7), day(0).slice(0, 7)])) {
    for (const x of (await host.get(`/api/stay-reports/missing-fees?month=${m}`)).data.missing_fees) total[x.channel] = (total[x.channel] || 0) + x.stays;
  }
  assert.deepEqual(total, { airbnb: 1 });
});
