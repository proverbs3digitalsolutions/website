'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, client, sql } = require('./helpers');
const { quote, nightlyPrices } = require('../src/lib/pricing');
const { addDays } = require('../src/lib/holidays');
const { hashPassword } = require('../src/lib/auth');

// Engine checks pass a fixed "today" so the booking-window rules are deterministic.
// 2027-09-06 is a Monday. 2027-09-10 (Fri) and 2027-09-11 (Sat) are weekend nights. September has no holidays.
const TODAY = '2027-09-06';
const day = (n) => addDays(TODAY, n);
const PASSWORD = 'correct-horse-1';

let srv; let owner; let orgId; let harbor; let hill; let mgr; let staff;
const units = {};

async function makeUnit(name, prop, fields) {
  const r = await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: name, unit_type: 'studio', ...fields });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.unit;
}

async function addUser(email, fullName, role, propertyId) {
  const [{ user_id: userId }] = await sql(
    `INSERT INTO users (organization_id, email, password_hash, full_name, role, email_verified_at)
     VALUES ($1, $2, $3, $4, $5, now()) RETURNING user_id`, [orgId, email, await hashPassword(PASSWORD), fullName, role]);
  await sql('INSERT INTO property_assignments (user_id, property_id) VALUES ($1, $2)', [userId, propertyId]);
  const c = client(srv.base);
  const r = await c.post('/api/auth/login', { email, password: PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return c;
}

const booking = (unit, ci, co, kind, code) => sql(
  `INSERT INTO bookings (organization_id, unit_id, kind, check_in, check_out, guest_label, confirmation_code)
   VALUES ($1, $2, $3, $4, $5, 'Engine test', $6)`, [orgId, unit.unit_id, kind, ci, co, code]);

const quoteAt = (u, ci, co) => quote(u.unit_id, ci, co, undefined, { today: TODAY });
// Price and the rules applied to the first night of a quote, as [price, [[kind, adjust_pct], ...]].
const first = (q) => [q.nights[0].price, q.nights[0].applied.map((a) => [a.kind, a.adjust_pct])];

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'rules-host@example.com', 'Rules Host');
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Rules Host'`))[0].organization_id;
  harbor = (await owner.post('/api/properties', { property_name: 'Harbor', property_type: 'condominium', address: 'Bicutan Ave', city: 'Paranaque', province: 'Metro Manila' })).data.property;
  hill = (await owner.post('/api/properties', { property_name: 'Hill', property_type: 'condominium', address: 'Macapagal Ave', city: 'Pasay', province: 'Metro Manila' })).data.property;
  units.u1 = await makeUnit('Harbor 1', harbor, { nightly_rate: '2000', weekend_rate: '2500', holiday_rate: '4000', weekly_discount: 10, monthly_discount: 20 });
  units.u2 = await makeUnit('Harbor 2', harbor, { nightly_rate: '2000' });
  units.u3 = await makeUnit('Harbor 3', harbor, { nightly_rate: '2000', min_nights: 3 });
  units.u4 = await makeUnit('Harbor 4', harbor, { nightly_rate: '2000' });
  units.u5 = await makeUnit('Harbor 5', harbor, { nightly_rate: '1999.99' });
  units.u6 = await makeUnit('Harbor 6', harbor, { nightly_rate: '1000', weekly_discount: 10, monthly_discount: 20 });
  units.hill = await makeUnit('Hill 1', hill, { nightly_rate: '2000' });
  // Listing fields that the properties screen sets; set directly here.
  await sql('UPDATE units SET fortnight_discount = 15 WHERE unit_id = $1', [units.u6.unit_id]);
  await sql('UPDATE units SET min_price = 1900 WHERE unit_id = $1', [units.u4.unit_id]);
  mgr = await addUser('mina@example.com', 'Mina Manager', 'manager', harbor.property_id);
  staff = await addUser('sam@example.com', 'Sam Staff', 'staff', harbor.property_id);
});
test.after(async () => { await srv.close(); });

test('a percentage season changes the weekend or base rate; a holiday still wins over it', async () => {
  const pct = await owner.post('/api/pricing/seasons', { name: 'Pct peak', unit_id: units.u1.unit_id, start_date: day(4), end_date: day(6), nightly_rate: '', adjust_pct: 20 });
  assert.equal(pct.status, 201, JSON.stringify(pct.data));
  // Fri and Sat are weekend nights (2500 + 20%); Sun is a base night (2000 + 20%).
  const q = await quoteAt(units.u1, day(4), day(7));
  assert.deepEqual(q.nights.map((n) => [n.price, n.kind, n.label]), [['3000.00', 'season', 'Pct peak'], ['3000.00', 'season', 'Pct peak'], ['2400.00', 'season', 'Pct peak']]);
  assert.deepEqual(q.nights[0].applied, [{ kind: 'season', label: 'Pct peak', adjust_pct: 20 }]);
  assert.equal(q.subtotal, '8400.00');

  assert.equal((await owner.post('/api/pricing/seasons', { name: 'Christmas push', unit_id: units.u1.unit_id, start_date: '2027-12-24', end_date: '2027-12-25', adjust_pct: 50 })).status, 201);
  // Christmas Eve and Christmas Day are holiday nights at 4000; the +50% season does not change them.
  const xmas = await quote(units.u1.unit_id, '2027-12-24', '2027-12-26', undefined, { today: TODAY });
  assert.deepEqual(xmas.nights.map((n) => [n.price, n.kind]), [['4000.00', 'holiday'], ['4000.00', 'holiday']]);
});

test('length-of-stay discounts: weekly from 7, fortnight from 14, monthly from 28 (one discount, the strongest that applies)', async () => {
  const q7 = await quoteAt(units.u6, day(0), day(7));
  assert.deepEqual([q7.subtotal, q7.discount_pct, q7.discount_label, q7.accommodation_total], ['7000.00', 10, '10% weekly discount', '6300.00']);
  const q13 = await quoteAt(units.u6, day(0), day(13));
  assert.deepEqual([q13.discount_pct, q13.accommodation_total], [10, '11700.00']);
  const q14 = await quoteAt(units.u6, day(0), day(14));
  assert.deepEqual([q14.discount_pct, q14.discount_label, q14.accommodation_total], [15, '15% fortnight discount', '11900.00']);
  const q28 = await quoteAt(units.u6, day(0), day(28));
  assert.deepEqual([q28.discount_pct, q28.discount_label, q28.accommodation_total], [20, '20% monthly discount', '22400.00']);
});

test('gap night: a stay that exactly fills a free gap gets the rule and waives the minimum stay', async () => {
  // Reservation 9/15 to 9/20, block 9/22 to 9/25: the gap is 9/20 to 9/22, two nights.
  await booking(units.u3, day(9), day(14), 'reservation', 'GAPRES1');
  await booking(units.u3, day(16), day(19), 'block', 'GAPBLK1');
  const gap = await owner.post('/api/pricing/rules', { kind: 'gap_night', days: 3, adjust_pct: -15, unit_id: units.u3.unit_id });
  assert.equal(gap.status, 201, JSON.stringify(gap.data));

  const q = await quoteAt(units.u3, day(14), day(16));
  assert.equal(q.gap_night, true);
  assert.deepEqual(q.nights.map((n) => n.price), ['1700.00', '1700.00']);
  assert.deepEqual(q.nights[0].applied, [{ kind: 'gap_night', label: 'Fills a gap between bookings', adjust_pct: -15 }]);
  assert.deepEqual([q.min_nights, q.min_nights_waived, q.min_nights_reason, q.accommodation_total], [1, 3, null, '3400.00']);

  // One night of the gap does not fill it, so the rule and the waiver do not apply.
  const partial = await quoteAt(units.u3, day(15), day(16));
  assert.deepEqual([partial.gap_night, partial.nights[0].price, partial.min_nights, partial.min_nights_waived], [false, '2000.00', 3, null]);
  // A stay that runs into the block does not fill the gap.
  assert.equal((await quoteAt(units.u3, day(14), day(17))).gap_night, false);
  // Longer than the gap allows (days 1): no rule.
  const patched = await owner.patch(`/api/pricing/rules/${gap.data.rule_id}`, { days: 1 });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.equal((await quoteAt(units.u3, day(14), day(16))).gap_night, false);
  assert.equal((await owner.patch(`/api/pricing/rules/${gap.data.rule_id}`, { days: 3 })).status, 200);

  // nightlyPrices (calendar) prices each night as a one-night stay and flags booked nights.
  const nights = await nightlyPrices(units.u3.unit_id, day(12), day(18), undefined, { today: TODAY });
  assert.deepEqual(nights.map((n) => n.booked), [true, true, false, false, true, true]);
  assert.deepEqual(nights.map((n) => n.price), ['2000.00', '2000.00', '2000.00', '2000.00', '2000.00', '2000.00']);
  assert.deepEqual(Object.keys(nights[0]).sort(), ['applied', 'booked', 'kind', 'label', 'night', 'price']);
});

test('booking window: last minute and far out use the workspace rule; a listing rule replaces it; at most one applies', async () => {
  assert.equal((await owner.post('/api/pricing/rules', { kind: 'last_minute', days: 7, adjust_pct: -20 })).status, 201);
  assert.equal((await owner.post('/api/pricing/rules', { kind: 'far_out', days: 60, adjust_pct: 10 })).status, 201);
  const u2 = units.u2;
  // Check-in 7 days away is inside the window; 8 days away is not; 60 is not more than 60 away; 61 is.
  assert.deepEqual(first(await quoteAt(u2, day(7), day(8))), ['1600.00', [['last_minute', -20]]]);
  assert.deepEqual(first(await quoteAt(u2, day(8), day(9))), ['2000.00', []]);
  assert.deepEqual(first(await quoteAt(u2, day(60), day(61))), ['2000.00', []]);
  assert.deepEqual(first(await quoteAt(u2, day(61), day(62))), ['2200.00', [['far_out', 10]]]);

  // A listing rule of the same kind replaces the workspace one, days and percentage.
  const listingLm = await owner.post('/api/pricing/rules', { kind: 'last_minute', days: 3, adjust_pct: -50, unit_id: u2.unit_id });
  assert.equal(listingLm.status, 201, JSON.stringify(listingLm.data));
  assert.deepEqual(first(await quoteAt(u2, day(2), day(3))), ['1000.00', [['last_minute', -50]]]);
  assert.deepEqual(first(await quoteAt(u2, day(5), day(6))), ['2000.00', []]);

  // An inactive listing rule switches that kind off for this listing (it still replaces the workspace rule).
  const listingFo = await owner.post('/api/pricing/rules', { kind: 'far_out', days: 31, adjust_pct: 30, unit_id: u2.unit_id });
  assert.equal(listingFo.status, 201);
  assert.deepEqual(first(await quoteAt(u2, day(61), day(62))), ['2600.00', [['far_out', 30]]]);
  assert.equal((await owner.patch(`/api/pricing/rules/${listingFo.data.rule_id}`, { active: false })).status, 200);
  assert.deepEqual(first(await quoteAt(u2, day(61), day(62))), ['2000.00', []]);
});

test('the lowest price is a floor for non-custom nights; a custom calendar price is never changed', async () => {
  // Base 2000, last minute -20% gives 1600, raised to the 1900 floor. Night 9/8 is a custom price below the floor.
  await sql('INSERT INTO nightly_rates (unit_id, rate_date, price) VALUES ($1, $2, 1000)', [units.u4.unit_id, day(2)]);
  const q = await quoteAt(units.u4, day(1), day(4));
  assert.deepEqual(q.nights.map((n) => [n.price, n.kind]), [['1900.00', 'base'], ['1000.00', 'custom'], ['1900.00', 'base']]);
  assert.deepEqual(q.nights[0].applied.map((a) => [a.kind, a.adjust_pct]), [['last_minute', -20], ['min_price', null]]);
  assert.deepEqual(q.nights[1].applied, []);
});

test('rule percentages are applied per night and rounded to the centavo', async () => {
  // 1999.99 with -33%: 1339.9933, which rounds to 1339.99.
  assert.equal((await owner.post('/api/pricing/rules', { kind: 'last_minute', days: 7, adjust_pct: -33, unit_id: units.u5.unit_id })).status, 201);
  const q = await quoteAt(units.u5, day(1), day(2));
  assert.equal(q.nights[0].price, '1339.99');
  assert.equal(q.accommodation_total, '1339.99');
});

test('rules: days and percentage limits per kind, duplicates, and the listing must exist', async () => {
  const post = (body) => owner.post('/api/pricing/rules', body);
  const bad = [
    { kind: 'last_minute', days: 31, adjust_pct: -10 },
    { kind: 'far_out', days: 30, adjust_pct: 10 },
    { kind: 'far_out', days: 541, adjust_pct: 10 },
    { kind: 'gap_night', days: 0, adjust_pct: -10 },
    { kind: 'gap_night', days: 8, adjust_pct: -10 },
    { kind: 'weekly', days: 7, adjust_pct: -10 },
    { kind: 'last_minute', days: 3, adjust_pct: 0 },
    { kind: 'last_minute', days: 3, adjust_pct: -91 },
    { kind: 'last_minute', days: 3, adjust_pct: 301 },
  ];
  for (const body of bad) assert.equal((await post(body)).status, 400, JSON.stringify(body));
  const fields = (await post({ kind: 'gap_night', days: 8, adjust_pct: -10 })).data.fields;
  assert.deepEqual(Object.keys(fields), ['days']);
  // Workspace-wide last minute already exists.
  assert.equal((await post({ kind: 'last_minute', days: 5, adjust_pct: -5 })).status, 409);
  // The listing already has a last minute rule.
  assert.equal((await post({ kind: 'last_minute', days: 5, adjust_pct: -5, unit_id: units.u2.unit_id })).status, 409);
  assert.equal((await post({ kind: 'last_minute', days: 5, adjust_pct: -5, unit_id: '00000000-0000-4000-8000-000000000000' })).status, 404);
});

test('rules are scoped: managers only on their listings; workspace-wide rules are the owner\'s; staff cannot change prices', async () => {
  const ownLm = await mgr.post('/api/pricing/rules', { kind: 'last_minute', days: 5, adjust_pct: -10, unit_id: units.u1.unit_id });
  assert.equal(ownLm.status, 201, JSON.stringify(ownLm.data));
  assert.equal((await mgr.post('/api/pricing/rules', { kind: 'last_minute', days: 5, adjust_pct: -10, unit_id: units.hill.unit_id })).status, 404);
  assert.equal((await mgr.post('/api/pricing/rules', { kind: 'far_out', days: 90, adjust_pct: 5 })).status, 400, 'a manager needs a listing');

  const hillFo = await owner.post('/api/pricing/rules', { kind: 'far_out', days: 90, adjust_pct: 5, unit_id: units.hill.unit_id });
  assert.equal(hillFo.status, 201);
  assert.equal((await mgr.patch(`/api/pricing/rules/${hillFo.data.rule_id}`, { days: 100 })).status, 404);
  assert.equal((await mgr.post(`/api/pricing/rules/${hillFo.data.rule_id}/remove`)).status, 404);

  const wsLm = (await owner.get('/api/pricing')).data.rules.find((r) => r.kind === 'last_minute' && r.unit_id === null);
  assert.equal((await mgr.patch(`/api/pricing/rules/${wsLm.rule_id}`, { days: 9 })).status, 403);
  assert.equal((await mgr.post(`/api/pricing/rules/${wsLm.rule_id}/remove`)).status, 403);
  assert.equal((await mgr.patch(`/api/pricing/rules/${ownLm.data.rule_id}`, { days: 4 })).status, 200);

  assert.equal((await staff.post('/api/pricing/rules', { kind: 'last_minute', days: 5, adjust_pct: -10, unit_id: units.u1.unit_id })).status, 403);
  assert.equal((await staff.get(`/api/pricing/preview?unit_id=${units.u1.unit_id}`)).status, 403);
});

test('rules: owner can change, switch off and remove a rule; bad changes are refused', async () => {
  const { rules } = (await owner.get('/api/pricing')).data;
  const wsFo = rules.find((r) => r.kind === 'far_out' && r.unit_id === null);
  assert.deepEqual(Object.keys(wsFo).sort(), ['active', 'adjust_pct', 'days', 'kind', 'rule_id', 'unit_id', 'unit_name']);
  assert.equal(wsFo.unit_name, null);

  assert.equal((await owner.patch(`/api/pricing/rules/${wsFo.rule_id}`, { days: 40 })).status, 200);
  const wsLm = rules.find((r) => r.kind === 'last_minute' && r.unit_id === null);
  assert.equal((await owner.patch(`/api/pricing/rules/${wsLm.rule_id}`, { days: 40 })).status, 400, 'last minute stops at 30');
  assert.equal((await owner.patch(`/api/pricing/rules/${wsLm.rule_id}`, { adjust_pct: 0 })).status, 400);
  assert.equal((await owner.patch(`/api/pricing/rules/${wsLm.rule_id}`, { days: null })).status, 400);
  const patched = await owner.patch(`/api/pricing/rules/${wsLm.rule_id}`, { adjust_pct: -25, active: false });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.deepEqual([patched.data.rule.adjust_pct, patched.data.rule.active], [-25, false]);

  assert.equal((await owner.post(`/api/pricing/rules/${wsFo.rule_id}/remove`)).status, 200);
  assert.equal((await owner.post(`/api/pricing/rules/${wsFo.rule_id}/remove`)).status, 404);
  assert.equal((await owner.patch('/api/pricing/rules/not-a-uuid', { days: 3 })).status, 404);
});

test('preview: nights with price, kind, the rules applied and booked; 60 days by default, at most 120', async () => {
  const pv = (qs) => owner.get(`/api/pricing/preview?${qs}`);
  const r = await pv(`unit_id=${units.u3.unit_id}&from=${day(12)}&days=6`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.nights.map((n) => n.date), [day(12), day(13), day(14), day(15), day(16), day(17)]);
  assert.deepEqual(r.data.nights.map((n) => n.booked), [true, true, false, false, true, true]);
  assert.deepEqual(Object.keys(r.data.nights[0]).sort(), ['applied', 'booked', 'date', 'kind', 'label', 'price']);
  assert.equal((await pv(`unit_id=${units.u1.unit_id}`)).data.nights.length, 60);
  assert.equal((await pv(`unit_id=${units.u1.unit_id}&days=120`)).data.nights.length, 120);
  assert.equal((await pv(`unit_id=${units.u1.unit_id}&days=121`)).status, 400);
  assert.equal((await pv(`unit_id=${units.u1.unit_id}&days=0`)).status, 400);
  assert.equal((await pv(`unit_id=${units.u1.unit_id}&from=2027-02-30`)).status, 400);
  assert.equal((await pv('from=2027-09-10')).status, 400, 'a listing is required');
  assert.equal((await mgr.get(`/api/pricing/preview?unit_id=${units.hill.unit_id}`)).status, 404, 'a manager cannot preview another property');
  assert.equal((await mgr.get(`/api/pricing/preview?unit_id=${units.u1.unit_id}&days=2`)).status, 200);
});

test('seasons take a percentage change, not together with a fixed rate; the list shows it', async () => {
  const from = day(30); const to = day(31);
  const both = await owner.post('/api/pricing/seasons', { name: 'Both', unit_id: units.u1.unit_id, start_date: from, end_date: to, nightly_rate: '3000', adjust_pct: 10 });
  assert.equal(both.status, 400);
  assert.deepEqual(Object.keys(both.data.fields), ['adjust_pct']);
  assert.equal((await owner.post('/api/pricing/seasons', { name: 'None', unit_id: units.u1.unit_id, start_date: from, end_date: to })).status, 400);
  assert.equal((await owner.post('/api/pricing/seasons', { name: 'Zero', unit_id: units.u1.unit_id, start_date: from, end_date: to, adjust_pct: 0 })).status, 400);
  assert.equal((await owner.post('/api/pricing/seasons', { name: 'Huge', unit_id: units.u1.unit_id, start_date: from, end_date: to, adjust_pct: 301 })).status, 400);
  const ok = await owner.post('/api/pricing/seasons', { name: 'Pct later', unit_id: units.u1.unit_id, start_date: from, end_date: to, nightly_rate: '', adjust_pct: 25 });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const page = (await owner.get('/api/pricing')).data;
  const s = page.seasons.find((x) => x.season_id === ok.data.season_id);
  assert.deepEqual([s.adjust_pct, s.nightly_rate], [25, null]);
  const u1 = page.listings.find((l) => l.unit_id === units.u1.unit_id);
  assert.deepEqual([u1.fortnight_discount, u1.min_price], [0, null]);
  const u6 = page.listings.find((l) => l.unit_id === units.u6.unit_id);
  assert.equal(u6.fortnight_discount, 15);
  const u4 = page.listings.find((l) => l.unit_id === units.u4.unit_id);
  assert.equal(u4.min_price, '1900.00');
  assert.equal((await owner.post(`/api/pricing/seasons/${ok.data.season_id}/remove`)).status, 200);
});

test('every rule change is audited', async () => {
  const rows = await sql(`SELECT action, record_id FROM audit_logs WHERE organization_id = $1 AND action LIKE 'pricing_rule.%'`, [orgId]);
  const actions = new Set(rows.map((r) => r.action));
  for (const a of ['pricing_rule.created', 'pricing_rule.updated', 'pricing_rule.removed']) assert.ok(actions.has(a), a);
  assert.ok(rows.every((r) => r.record_id), 'each entry names the rule');
});

test('stacked percentages never take a night below 10% of its price; a custom calendar price is still exact', async () => {
  // Base 2000 with three -90% adjustments on the same night: a season, last minute and a gap night.
  const stack = await makeUnit('Harbor 7', harbor, { nightly_rate: '2000' });
  assert.equal((await owner.post('/api/pricing/seasons', { name: 'Clearance', unit_id: stack.unit_id, start_date: day(1), end_date: day(1), nightly_rate: '', adjust_pct: -90 })).status, 201);
  assert.equal((await owner.post('/api/pricing/rules', { kind: 'last_minute', days: 7, adjust_pct: -90, unit_id: stack.unit_id })).status, 201);
  assert.equal((await owner.post('/api/pricing/rules', { kind: 'gap_night', days: 3, adjust_pct: -90, unit_id: stack.unit_id })).status, 201);
  // One booking ends on check-in and another starts on check-out, so the single night fills the gap.
  await booking(stack, day(0), day(1), 'reservation', 'STACK1');
  await booking(stack, day(2), day(3), 'reservation', 'STACK2');
  await sql('INSERT INTO nightly_rates (unit_id, rate_date, price) VALUES ($1, $2, 1000)', [stack.unit_id, day(5)]);

  const q = await quoteAt(stack, day(1), day(2));
  assert.equal(q.gap_night, true);
  assert.equal(q.nights[0].price, '200.00', 'never below 10% of 2000');
  assert.deepEqual(q.nights[0].applied.map((a) => [a.kind, a.adjust_pct]), [['season', -90], ['last_minute', -90], ['gap_night', -90], ['max_discount', null]]);

  const custom = await quoteAt(stack, day(5), day(6));
  assert.deepEqual([custom.nights[0].price, custom.nights[0].kind, custom.nights[0].applied], ['1000.00', 'custom', []]);
});
