'use strict';

// QA round 6, lane C04 (listings-and-discounts): the length-of-stay discount order on a listing (#10)
// and the guest screens for roles that see names only (#1, screens). The server checks run against the
// app; the screen checks are source scans because listings.js imports the signed-in user from app.js.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_03 node --test --test-concurrency=1 test/qa-r6-c04.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ownerAccount, sql } = require('./helpers');

const LISTINGS = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'listings.js'), 'utf8');

let srv; let owner; let property; let counter = 0;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'ladder-host@example.com', 'Ladder Host');
  property = (await owner.post('/api/properties', { property_name: 'Ladder House', property_type: 'condominium', address: 'Bicutan Ave', city: 'Paranaque', province: 'Metro Manila' })).data.property;
});
test.after(async () => { await srv.close(); });

// No nightly rate on these units, so the plan's listing limit does not apply.
const create = (discounts) => owner.post(`/api/properties/${property.property_id}/units`, { unit_name: `Ladder ${(counter += 1)}`, unit_type: 'studio', ...discounts });
const patch = (unit, body) => owner.patch(`/api/units/${unit.unit_id}`, body);
const saved = async (unit) => (await sql('SELECT weekly_discount, fortnight_discount, monthly_discount FROM units WHERE unit_id = $1', [unit.unit_id]))[0];
const unitCount = async () => (await sql('SELECT COUNT(*)::int AS n FROM units WHERE property_id = $1', [property.property_id]))[0].n;

test('a create with a weekly discount above the 14+ night discount is refused on the 14+ night field and saves nothing', async () => {
  const before = await unitCount();
  const r = await create({ weekly_discount: 25, fortnight_discount: 20 });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.deepEqual(Object.keys(r.data.fields), ['fortnight_discount']);
  assert.equal(r.data.fields.fortnight_discount, "The 14+ night discount (20%) can't be smaller than the weekly discount (25%). Longer stays get the same or a bigger discount.");
  assert.equal(await unitCount(), before);
});

test('a create with a monthly discount below the weekly one is refused on the monthly field when the 14+ night discount is off', async () => {
  const r = await create({ weekly_discount: 10, fortnight_discount: 0, monthly_discount: 5 });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.deepEqual(Object.keys(r.data.fields), ['monthly_discount']);
  assert.equal(r.data.fields.monthly_discount, "The monthly discount (5%) can't be smaller than the weekly discount (10%). Longer stays get the same or a bigger discount.");
});

test('orders that never shrink as stays get longer save, including discounts that are off', async () => {
  for (const d of [{ weekly_discount: 10, fortnight_discount: 20, monthly_discount: 0 }, { weekly_discount: 0, fortnight_discount: 0, monthly_discount: 30 },
    { weekly_discount: 10, fortnight_discount: 20, monthly_discount: 30 }, { weekly_discount: 10, fortnight_discount: 10, monthly_discount: 10 }]) {
    const r = await create(d);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.deepEqual(await saved(r.data.unit), d);
  }
});

test('a PATCH that makes the monthly discount smaller than the 14+ night discount is refused and changes nothing', async () => {
  const unit = (await create({ weekly_discount: 10, fortnight_discount: 20, monthly_discount: 30 })).data.unit;
  const r = await patch(unit, { monthly_discount: 5 });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.deepEqual(Object.keys(r.data.fields), ['monthly_discount']);
  assert.equal(r.data.fields.monthly_discount, "The monthly discount (5%) can't be smaller than the 14+ night discount (20%). Longer stays get the same or a bigger discount.");
  assert.deepEqual(await saved(unit), { weekly_discount: 10, fortnight_discount: 20, monthly_discount: 30 });
});

test('a PATCH is checked against the saved values: a monthly discount alone is refused against a saved 14+ night discount', async () => {
  const unit = (await create({ weekly_discount: 10, fortnight_discount: 20, monthly_discount: 0 })).data.unit;
  const r = await patch(unit, { monthly_discount: 5 });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.deepEqual(Object.keys(r.data.fields), ['monthly_discount']);
});

test('a PATCH that raises the weekly discount above the saved 14+ night discount is refused on the 14+ night field', async () => {
  const unit = (await create({ weekly_discount: 5, fortnight_discount: 20, monthly_discount: 30 })).data.unit;
  const r = await patch(unit, { weekly_discount: 25 });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.deepEqual(Object.keys(r.data.fields), ['fortnight_discount']);
  assert.deepEqual(await saved(unit), { weekly_discount: 5, fortnight_discount: 20, monthly_discount: 30 });
});

test('a PATCH that keeps the order saves', async () => {
  const unit = (await create({ weekly_discount: 10, fortnight_discount: 20, monthly_discount: 30 })).data.unit;
  const r = await patch(unit, { weekly_discount: 15, fortnight_discount: 25, monthly_discount: 35 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(await saved(unit), { weekly_discount: 15, fortnight_discount: 25, monthly_discount: 35 });
});

test('a PATCH that does not touch the discounts is not blocked by an order saved before this rule', async () => {
  const unit = (await create({ weekly_discount: 10, fortnight_discount: 20, monthly_discount: 30 })).data.unit;
  await sql('UPDATE units SET weekly_discount = 25 WHERE unit_id = $1', [unit.unit_id]);
  const r = await patch(unit, { description: 'Bright studio' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test('the listing form checks the discount order before it saves, with the same sentence the server uses', () => {
  assert.equal(LISTINGS.match(/checkDiscountOrder\(d\);/g)?.length, 3, 'the add and the edit form check first, and listingCheck runs it in the one pass');
  assert.match(LISTINGS, /can't be smaller than the/);
  assert.match(LISTINGS, /Longer stays get the same or a bigger discount\./);
});

test('a guest row for a names-only role shows the name and no stay chips or stay count', () => {
  assert.match(LISTINGS, /!g\.limited && h\('div', \{ class: 'row__end' \}/);
});

test('a names-only role gets the search box only on the guest list', () => {
  assert.match(LISTINGS, /const full = \['owner', 'manager'\]\.includes\(state\.user\.role\);/);
  assert.match(LISTINGS, /quick: full \? \[/);
  assert.match(LISTINGS, /more: full \? \[/);
});

test('a names-only guest profile says the details are limited and shows no stays, reviews or stay count', () => {
  assert.match(LISTINGS, /Guest details are limited to owners and managers\./);
  assert.match(LISTINGS, /!g\.limited && h\('p', null, \(\(n\) => `\$\{n\} stay/);
  assert.match(LISTINGS, /g\.limited \? limitedCard : h\('div', \{ class: 'grid grid--2' \}/);
});
