'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount } = require('./helpers');
const holidays = require('../src/lib/holidays');

let srv; let owner; let unit; let other;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Pricing Stays');
  const p = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const r = await owner.post(`/api/properties/${p.property_id}/units`, {
    unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', weekend_rate: '2500', holiday_rate: '4000', weekly_discount: 10, monthly_discount: 20,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  unit = r.data.unit;
  other = (await owner.post(`/api/properties/${p.property_id}/units`, { unit_name: '805', unit_type: 'studio', nightly_rate: '1800' })).data.unit;
});
test.after(async () => { await srv.close(); });

const quote = async (u, ci, co) => (await owner.get(`/api/reservations/quote?unit_id=${u.unit_id}&check_in=${ci}&check_out=${co}`)).data;

test('PH holiday calendar: Easter-based, last Monday of August, long weekends', () => {
  assert.equal(holidays.easter(2026), '2026-04-05');
  assert.equal(holidays.easter(2027), '2027-03-28');
  assert.equal(holidays.holidayName('2026-04-03'), 'Good Friday');
  assert.equal(holidays.holidayName('2026-08-31'), 'National Heroes Day');
  // Holy Week 2027: Wednesday to Saturday nights; not Tuesday or Easter Sunday night.
  assert.equal(holidays.holidayNight('2027-03-23'), null);
  assert.equal(holidays.holidayNight('2027-03-24'), 'Maundy Thursday');
  assert.equal(holidays.holidayNight('2027-03-27'), 'Black Saturday');
  assert.equal(holidays.holidayNight('2027-03-28'), null);
  // An ordinary weekend is not a holiday.
  assert.equal(holidays.holidayNight('2027-06-05'), null);
  assert.ok(holidays.upcoming('2026-10-13', 366).some((x) => x.date === '2026-12-25'));
});

test('weekend and holiday rates, with a weekly discount', async () => {
  const wk = await quote(unit, '2027-06-04', '2027-06-07'); // Fri, Sat, Sun nights
  assert.deepEqual(wk.nights.map((n) => [n.price, n.kind]), [['2500.00', 'weekend'], ['2500.00', 'weekend'], ['2000.00', 'base']]);
  assert.equal(wk.accommodation_total, '7000.00');

  const hw = await quote(unit, '2027-03-22', '2027-03-29'); // 7 nights over Holy Week
  assert.deepEqual(hw.nights.map((n) => n.kind), ['base', 'base', 'holiday', 'holiday', 'holiday', 'holiday', 'base']);
  assert.equal(hw.subtotal, '22000.00');
  assert.equal(hw.discount_pct, 10);
  assert.equal(hw.accommodation_total, '19800.00');

  // A listing without a holiday rate just uses its base rate.
  assert.equal((await quote(other, '2027-03-24', '2027-03-25')).accommodation_total, '1800.00');

  // A price set on the calendar wins.
  await owner.raw('PUT', '/api/rates', { unit_id: unit.unit_id, start_date: '2027-03-25', end_date: '2027-03-25', price: '3000' });
  const custom = await quote(unit, '2027-03-25', '2027-03-26');
  assert.deepEqual([custom.nights[0].price, custom.nights[0].kind], ['3000.00', 'custom']);

  // New reservations without a typed total use the discounted quote.
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: '2027-03-22', check_out: '2027-03-29', guest_name: 'Holy Week Guest' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.reservation.accommodation_total, '18900.00'); // (22000 - 1000 for the custom night) less 10%
});

test('seasons: rate and minimum stay; a listing season beats an all-listings one', async () => {
  assert.equal((await owner.post('/api/pricing/seasons', { name: 'Bad', start_date: '2027-05-10', end_date: '2027-05-01', nightly_rate: '3000' })).status, 400);
  assert.equal((await owner.post('/api/pricing/seasons', { name: 'Empty', start_date: '2027-05-01', end_date: '2027-05-31' })).status, 400);
  const all = await owner.post('/api/pricing/seasons', { name: 'Summer peak', start_date: '2027-05-01', end_date: '2027-05-31', nightly_rate: '3000', min_nights: 3 });
  assert.equal(all.status, 201);
  assert.equal((await owner.post('/api/pricing/seasons', { name: 'Fiesta', unit_id: unit.unit_id, start_date: '2027-05-10', end_date: '2027-05-10', nightly_rate: '3500' })).status, 201);
  const q = await quote(unit, '2027-05-10', '2027-05-12');
  assert.deepEqual(q.nights.map((n) => [n.price, n.label]), [['3500.00', 'Fiesta'], ['3000.00', 'Summer peak']]);
  assert.equal(q.min_nights, 3);
  assert.equal(q.min_nights_reason, 'Summer peak');
  assert.equal((await quote(other, '2027-05-10', '2027-05-11')).nights[0].price, '3000.00');

  const page = (await owner.get('/api/pricing')).data;
  assert.equal(page.seasons.length, 2);
  assert.equal(page.listings.find((l) => l.unit_id === unit.unit_id).holiday_rate, '4000.00');
  assert.ok(page.holidays.length > 15);
  await owner.post(`/api/pricing/seasons/${all.data.season_id}/remove`);
  assert.equal((await quote(other, '2027-05-10', '2027-05-11')).nights[0].price, '1800.00');
});

test('monthly discount and the calendar shows each night\'s rule', async () => {
  const m = await quote(unit, '2027-07-05', '2027-08-02');
  assert.equal(m.nights.length, 28);
  assert.equal(m.discount_pct, 20);
  assert.equal(Number(m.accommodation_total), Math.round(Number(m.subtotal) * 80) / 100);
  const cal = (await owner.get('/api/calendar?start=2027-03-22&days=14')).data;
  const p = cal.prices.find((x) => x.unit_id === unit.unit_id && x.date === '2027-03-24');
  assert.deepEqual([p.price, p.kind, p.label], ['4000.00', 'holiday', 'Maundy Thursday']);
});
