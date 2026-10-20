'use strict';

// QA round 2, lane B22 (pricing): the preview's copy, season overlap warnings (listing and all-listings
// seasons, and equal first nights), the duplicate-rule confirmation, and the bulk preview's count of
// nights that fall below a listing's lowest price (D-66, D-74, D-76).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);
let srv; let owner; let paris; let hill;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'b22-pricing@example.com', 'B22 Pricing Stays');
  const prop = (await owner.post('/api/properties', { property_name: 'Paris', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const unit = async (name) => (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  paris = await unit('Paris 1208');
  hill = await unit('Hill 2');
});
test.after(async () => { await srv.close(); });

const season = (b) => owner.post('/api/pricing/seasons', b);
// [name, listing the overlap is on (null when it is every listing), who wins]
const shape = (overlaps) => overlaps.map((o) => [o.name, o.on, o.wins]);

test('listings#3: seasons with the same first night: the one saved later wins, and the warning says so', async () => {
  const a = await season({ unit_id: paris.unit_id, name: 'QA Season A', start_date: '2031-11-20', end_date: '2031-11-22', nightly_rate: '3100' });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  const b = await season({ unit_id: paris.unit_id, name: 'QA Season B', start_date: '2031-11-20', end_date: '2031-11-21', nightly_rate: '3200' });
  assert.equal(b.status, 201, JSON.stringify(b.data));
  assert.deepEqual(shape(b.data.overlaps), [['QA Season A', null, 'new']]);
  // The engine agrees: the later-created season prices the shared nights.
  const { nights } = (await owner.get(`/api/pricing/preview?unit_id=${paris.unit_id}&from=2031-11-20&days=1`)).data;
  assert.equal(nights[0].label, 'QA Season B');
});

test('listings#4: an all-listings season and a listing season that overlap warn, and name the listing where the listing season wins', async () => {
  assert.equal((await season({ unit_id: paris.unit_id, name: 'QA Paris Dec', start_date: '2031-12-10', end_date: '2031-12-12', nightly_rate: '3100' })).status, 201);

  // An all-listings season saved over Paris's season: Paris keeps its own price on the shared nights.
  const all = await season({ name: 'QA All Dec', start_date: '2031-12-09', end_date: '2031-12-11', adjust_pct: 10 });
  assert.equal(all.status, 201, JSON.stringify(all.data));
  assert.deepEqual(shape(all.data.overlaps), [['QA Paris Dec', 'Paris 1208', 'existing']]);

  // A listing season saved over the all-listings season: the new listing season wins on its listing.
  const hillDec = await season({ unit_id: hill.unit_id, name: 'QA Hill Dec', start_date: '2031-12-10', end_date: '2031-12-10', nightly_rate: '2900' });
  assert.equal(hillDec.status, 201, JSON.stringify(hillDec.data));
  assert.deepEqual(shape(hillDec.data.overlaps), [['QA All Dec', 'Hill 2', 'new']]);

  // Paris's season covers the 12th, but a season on Hill does not warn about Paris.
  const hillOnly = await season({ unit_id: hill.unit_id, name: 'QA Hill Only', start_date: '2031-12-12', end_date: '2031-12-12', nightly_rate: '2950' });
  assert.equal(hillOnly.status, 201, JSON.stringify(hillOnly.data));
  assert.deepEqual(hillOnly.data.overlaps, []);
});

test('listings#4: a listing season saved over an all-listings season wins on its listing, and the warning names that listing', async () => {
  assert.equal((await season({ name: 'QA All Jan', start_date: '2032-01-05', end_date: '2032-01-07', adjust_pct: 10 })).status, 201);
  const p = await season({ unit_id: paris.unit_id, name: 'QA Paris Jan', start_date: '2032-01-06', end_date: '2032-01-06', nightly_rate: '3000' });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  assert.deepEqual(shape(p.data.overlaps), [['QA All Jan', 'Paris 1208', 'new']]);
});

test('the duplicate check on rules is still the server\'s: a second rule of one kind on one listing is refused', async () => {
  // The client asks before it changes a rule of the same kind; the server still refuses a second one.
  assert.equal((await owner.post('/api/pricing/rules', { kind: 'gap_night', days: 2, adjust_pct: -10, unit_id: paris.unit_id })).status, 201);
  assert.equal((await owner.post('/api/pricing/rules', { kind: 'gap_night', days: 3, adjust_pct: -5, unit_id: paris.unit_id })).status, 409);
});

test('N3: a percentage cut that puts nights below the lowest price is allowed, and the preview counts those nights', async () => {
  await sql('UPDATE units SET min_price = 1500 WHERE unit_id = $1', [paris.unit_id]);
  // Night d(40) has a calendar price of 2800; night d(41) has the base rate of 2000.
  assert.equal((await owner.post('/api/bulk/prices', { unit_ids: [paris.unit_id], from: d(40), to: d(40), action: 'set', price: '2800' })).status, 200);

  const preview = await owner.post('/api/bulk/prices', { unit_ids: [paris.unit_id], from: d(40), to: d(41), action: 'percent', percent: -50, dry_run: true });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.deepEqual(preview.data.changes.map((c) => c.to_price), ['1400.00', '1000.00']);
  assert.equal(preview.data.below_lowest, 2);

  // A cut that stays at or above the lowest price counts nothing.
  const gentle = await owner.post('/api/bulk/prices', { unit_ids: [paris.unit_id], from: d(40), to: d(41), action: 'percent', percent: -10, dry_run: true });
  assert.equal(gentle.data.below_lowest, 0);

  // The change is still allowed, and the apply writes exactly what the preview showed.
  const applied = await owner.post('/api/bulk/prices', { unit_ids: [paris.unit_id], from: d(40), to: d(41), action: 'percent', percent: -50 });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(applied.data.below_lowest, 2);
  const rows = await sql('SELECT price FROM nightly_rates WHERE unit_id = $1 AND rate_date BETWEEN $2 AND $3 ORDER BY rate_date', [paris.unit_id, d(40), d(41)]);
  assert.deepEqual(rows.map((r) => r.price), ['1400.00', '1000.00']);
});

// ---------------------------------------------------------------- the browser module, loaded with stubs
let view; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-pricing-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { role: \'owner\' } };\n');
  // The real addDays, copied from reservations.js so the test cannot drift from it.
  const reservations = fs.readFileSync(path.join(__dirname, '../public/js/views/reservations.js'), 'utf8');
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), reservations.match(/export function addDays[\s\S]*?\n}\n/)[0]);
  fs.copyFileSync(path.join(__dirname, '../public/js/views/pricing.js'), path.join(dir, 'views', 'pricing.js'));
  fs.copyFileSync(path.join(__dirname, '../public/js/rates.js'), path.join(dir, 'rates.js')); // pricing.js imports the rate check (QA round 12, C13)
  globalThis.Element = class { };
  view = await import(pathToFileURL(path.join(dir, 'views', 'pricing.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const S = (o) => ({ unit_id: null, unit_name: null, nightly_rate: null, adjust_pct: null, created_at: '2026-10-13T10:00:00.000Z', ...o });

test('listings#3: on equal first nights the season created later is the one that wins, in the table note too', () => {
  const a = S({ name: 'QA Season A', unit_id: 'p', unit_name: 'Paris 1208', start_date: '2031-11-20', end_date: '2031-11-22', nightly_rate: '3100' });
  const b = S({ name: 'QA Season B', unit_id: 'p', unit_name: 'Paris 1208', start_date: '2031-11-20', end_date: '2031-11-21', nightly_rate: '3200', created_at: '2026-10-13T10:05:00.000Z' });
  const seasons = [a, b];
  assert.equal(view.clashText(view.seasonClashes(a, seasons)[0]), 'Overlaps QA Season B, which wins the shared nights.');
  assert.equal(view.clashText(view.seasonClashes(b, seasons)[0]), 'Overlaps QA Season A: this season wins the shared nights.');
});

test('listings#4: an all-listings season and a listing season that share nights name the listing where the listing season wins', () => {
  const paris = S({ name: 'Paris Dec', unit_id: 'p', unit_name: 'Paris 1208', start_date: '2031-12-10', end_date: '2031-12-12', nightly_rate: '3100' });
  const all = S({ name: 'QA All Dec', start_date: '2031-12-09', end_date: '2031-12-11', adjust_pct: 10 });
  const hill = S({ name: 'Hill Dec', unit_id: 'h', unit_name: 'Hill 2', start_date: '2031-12-10', end_date: '2031-12-10', nightly_rate: '2900' });
  const seasons = [paris, all, hill];
  assert.equal(view.clashText(view.seasonClashes(all, seasons).find((c) => c.name === 'Paris Dec')), 'Overlaps Paris Dec on Paris 1208, which wins the shared nights.');
  assert.equal(view.clashText(view.seasonClashes(paris, seasons).find((c) => c.name === 'QA All Dec')), 'Overlaps QA All Dec on Paris 1208: this season wins the shared nights.');
  // A season on another listing does not touch Paris.
  assert.deepEqual(view.seasonClashes(paris, [paris, hill]), []);
});

test('replaceRuleText says what changes when a rule of the same kind is replaced', () => {
  const old = { kind: 'last_minute', days: 3, adjust_pct: -15, active: true, unit_name: null };
  const next = { kind: 'last_minute', days: 5, adjust_pct: -20, unit_id: null };
  assert.equal(view.replaceRuleText(old, next),
    'All listings already has a Last-minute rule: “Stays starting within 3 days: 15% off”. It will change to “Stays starting within 5 days: 20% off”.');
  const off = { ...old, active: false, unit_name: 'Paris 1208' };
  assert.match(view.replaceRuleText(off, next), /It is off now, so this turns it on\.$/);
});

test('listings#2: the price preview says each night is priced as a one-night stay', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/pricing.js'), 'utf8');
  assert.ok(src.includes('Each night priced as a one-night stay. Longer stays can get gap, weekly or monthly prices; the quote shows the exact total.'));
  assert.ok(!src.includes('as guests would be quoted them'));
});

test('listings#5: a rule of a kind that already exists asks first; the old value is never replaced silently', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/pricing.js'), 'utf8');
  assert.ok(!src.includes('if (dup) await patch('), 'no silent replace of the duplicate rule');
  assert.match(src, /confirmDialog\(\{ title: 'Change the existing rule\?'/);
});

test('N3: the bulk preview warns how many nights will be below the lowest price', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/pricing.js'), 'utf8');
  assert.match(src, /r\.below_lowest/);
});
