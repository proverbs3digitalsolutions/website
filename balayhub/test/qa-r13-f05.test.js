'use strict';

// QA round 13, lane F05 (seasons-server): a season identical to one the workspace already has is refused
// with 409 DUPLICATE and nothing is written (bug #29). Same listing scope (both all-listings counts as the
// same), name ignoring case and spaces at the ends, dates, nightly rate, percentage change and minimum stay.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, sql } = require('./helpers');

const SAVED_BEFORE = 'You already saved this season.';
let srv; let owner; let orgId; let paris;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'f05-seasons@example.com', 'F05 Seasons');
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'F05 Seasons'`))[0].organization_id;
  const prop = (await owner.post('/api/properties', { property_name: 'Paris', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  paris = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Paris 1208', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
});
test.after(async () => { await srv.close(); });

const season = (b) => owner.post('/api/pricing/seasons', b);
const countNamed = async (name) => (await sql(
  'SELECT COUNT(*)::int AS n FROM seasons WHERE organization_id = $1 AND lower(trim(name)) = $2', [orgId, name]))[0].n;

test('an identical season is refused with 409 DUPLICATE, and only the first one is saved', async () => {
  const body = { unit_id: paris.unit_id, name: 'QA F05 Peak', start_date: '2031-07-01', end_date: '2031-07-05', nightly_rate: '3000' };
  const first = await season(body);
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const again = await season(body);
  assert.equal(again.status, 409, JSON.stringify(again.data));
  assert.equal(again.data.code, 'DUPLICATE');
  assert.equal(again.data.error, SAVED_BEFORE);
  assert.deepEqual(again.data.fields, { name: SAVED_BEFORE });
  assert.equal(await countNamed('qa f05 peak'), 1, 'nothing is written for the refused save');
});

test('the same season with the name in other capitals and spaces, or the price typed with cents, is still refused', async () => {
  const body = { unit_id: paris.unit_id, name: 'QA F05 Peak', start_date: '2031-07-01', end_date: '2031-07-05', nightly_rate: '3000' };
  const spaced = await season({ ...body, name: '  qa f05 PEAK ' });
  assert.equal(spaced.status, 409, JSON.stringify(spaced.data));
  assert.equal(spaced.data.code, 'DUPLICATE');
  const cents = await season({ ...body, nightly_rate: '3000.00' });
  assert.equal(cents.status, 409, JSON.stringify(cents.data));
  assert.equal(await countNamed('qa f05 peak'), 1);
});

test('a season that differs in price, dates, percentage or minimum stay is saved', async () => {
  const body = { unit_id: paris.unit_id, name: 'QA F05 Peak', start_date: '2031-07-01', end_date: '2031-07-05', nightly_rate: '3000' };
  assert.equal((await season({ ...body, nightly_rate: '3100' })).status, 201);
  assert.equal((await season({ ...body, start_date: '2031-07-02' })).status, 201);
  assert.equal((await season({ ...body, end_date: '2031-07-06' })).status, 201);
  assert.equal((await season({ unit_id: paris.unit_id, name: 'QA F05 Peak', start_date: '2031-07-01', end_date: '2031-07-05', adjust_pct: 10 })).status, 201);
  assert.equal((await season({ ...body, min_nights: 2 })).status, 201);
  assert.equal(await countNamed('qa f05 peak'), 6);
});

test('the same season on another listing is not a duplicate, but a second all-listings copy is', async () => {
  const body = { name: 'QA F05 Hill', start_date: '2031-08-01', end_date: '2031-08-03', nightly_rate: '2900' };
  const hill = (await owner.post('/api/properties', { property_name: 'Hill', property_type: 'condominium', address: 'Macapagal Ave', city: 'Pasay', province: 'Metro Manila' })).data.property;
  const hillUnit = (await owner.post(`/api/properties/${hill.property_id}/units`, { unit_name: 'Hill 1', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  assert.equal((await season({ ...body, unit_id: paris.unit_id })).status, 201);
  assert.equal((await season({ ...body, unit_id: hillUnit.unit_id })).status, 201);
  assert.equal((await season(body)).status, 201, 'an all-listings season is not the same as a listing season');
  const allAgain = await season(body);
  assert.equal(allAgain.status, 409, JSON.stringify(allAgain.data));
  assert.equal(allAgain.data.code, 'DUPLICATE');
});

test('another workspace may save the same season; the check is per workspace', async () => {
  const other = await ownerAccount(srv.base, 'f05-other@example.com', 'F05 Other');
  const prop = (await other.post('/api/properties', { property_name: 'Cebu', property_type: 'condominium', address: 'Lahug', city: 'Cebu City', province: 'Cebu' })).data.property;
  const unit = (await other.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Cebu 1', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const body = { unit_id: unit.unit_id, name: 'QA F05 Peak', start_date: '2031-07-01', end_date: '2031-07-05', nightly_rate: '3000' };
  assert.equal((await other.post('/api/pricing/seasons', body)).status, 201);
});
