'use strict';

// QA round 3, lane C20 (pricing view): the season clash text. When a third season beats both of two overlapping
// seasons on some of the nights they share, the text names it, instead of saying one season wins every shared night
// (O-b; the precedence rule is D-66 and D-76). Pure: the browser module is loaded with stubs, so no database is needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let view; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-pricing-r3-'));
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
const clashFor = (s, seasons, name) => view.clashText(view.seasonClashes(s, seasons).find((c) => c.name === name));

test('O-b: a third season that takes some shared nights is named, instead of one season being said to win all of them', () => {
  // Paris: A (1st to 5th, saved first) and B (1st to 3rd, saved later, so it beats A). An all-listings season runs 2nd to 4th.
  const a = S({ name: 'QA rvC A', unit_id: 'p', unit_name: 'Paris 1208', start_date: '2031-06-01', end_date: '2031-06-05', nightly_rate: '2000' });
  const b = S({ name: 'QA rvC B', unit_id: 'p', unit_name: 'Paris 1208', start_date: '2031-06-01', end_date: '2031-06-03', nightly_rate: '2100', created_at: '2026-10-13T10:05:00.000Z' });
  const all = S({ name: 'QA rvC All', start_date: '2031-06-02', end_date: '2031-06-04', adjust_pct: 10, created_at: '2026-10-13T10:10:00.000Z' });
  const seasons = [a, b, all];
  // A beats the all-listings season, but B prices the 2nd and 3rd, so A only wins the 4th.
  assert.equal(clashFor(all, seasons, 'QA rvC A'),
    'Overlaps QA rvC A on Paris 1208: QA rvC A beats this season on the nights they share, except where QA rvC B takes over.');
  assert.equal(clashFor(a, seasons, 'QA rvC All'),
    'Overlaps QA rvC All on Paris 1208: this season beats QA rvC All on the nights they share, except where QA rvC B takes over.');
  // B beats both A and the all-listings season on every night they share, so those lines stay as they were.
  assert.equal(clashFor(all, seasons, 'QA rvC B'), 'Overlaps QA rvC B on Paris 1208: QA rvC B wins the shared nights.');
  assert.equal(clashFor(b, seasons, 'QA rvC All'), 'Overlaps QA rvC All on Paris 1208: this season wins the shared nights.');
  assert.equal(clashFor(b, seasons, 'QA rvC A'), 'Overlaps QA rvC A: this season wins the shared nights.');
  assert.equal(clashFor(a, seasons, 'QA rvC B'), 'Overlaps QA rvC B: QA rvC B wins the shared nights.');
});

test('a third season the winner still beats on the shared nights leaves the pair\'s text alone', () => {
  const a = S({ name: 'QA Season A', unit_id: 'p', unit_name: 'Paris 1208', start_date: '2031-06-01', end_date: '2031-06-05', nightly_rate: '2000' });
  const b = S({ name: 'QA Season B', unit_id: 'p', unit_name: 'Paris 1208', start_date: '2031-06-01', end_date: '2031-06-03', nightly_rate: '2100', created_at: '2026-10-13T10:05:00.000Z' });
  // C is saved between A and B, so it beats A but B beats it. It never prices a night that B also covers.
  const c = S({ name: 'QA Season C', unit_id: 'p', unit_name: 'Paris 1208', start_date: '2031-06-01', end_date: '2031-06-05', nightly_rate: '2050', created_at: '2026-10-13T10:02:00.000Z' });
  assert.equal(clashFor(a, [a, b, c], 'QA Season B'), 'Overlaps QA Season B: QA Season B wins the shared nights.');
  assert.equal(clashFor(b, [a, b, c], 'QA Season A'), 'Overlaps QA Season A: this season wins the shared nights.');
});

test('the save toast names the overlapping seasons and leaves who wins to the notes under the list', () => {
  // The server's overlap answer is pairwise, so a win label in the toast would repeat the over-claim. The table notes say it per night.
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/pricing.js'), 'utf8');
  const line = src.split('\n').find((l) => l.includes('const clash = overlaps.map'));
  assert.ok(line, 'the save toast builds its list from overlaps');
  assert.ok(!line.includes('wins'), 'no win label in the save toast');
  assert.ok(!src.includes('(that one wins)') && !src.includes('(this season wins)'));
});

test('the Seasons table\'s last column has a visually hidden Actions label, as on the other tables', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/pricing.js'), 'utf8');
  const line = src.split('\n').find((l) => l.includes('\'Price\', \'Min. nights\''));
  assert.ok(line, 'the Seasons header row');
  assert.ok(line.includes('h(\'span\', { class: \'sr-only\' }, \'Actions\')'), 'the last header cell is a visually hidden Actions label');
  assert.ok(!line.includes('\'Min. nights\', \'\''), 'no empty header cell');
});

test('a third season counts only when it sets a price on this listing', () => {
  const a = S({ name: 'QA Season A', unit_id: 'p', unit_name: 'Paris 1208', start_date: '2031-06-01', end_date: '2031-06-05', nightly_rate: '2000' });
  const all = S({ name: 'QA All', start_date: '2031-06-02', end_date: '2031-06-04', adjust_pct: 10, created_at: '2026-10-13T10:10:00.000Z' });
  // Beats A and the all-listings season, but sets no price (minimum stay only), so it takes no night.
  const minOnly = S({ name: 'QA Min Stay', unit_id: 'p', unit_name: 'Paris 1208', start_date: '2031-06-01', end_date: '2031-06-05', min_nights: 3, created_at: '2026-10-13T10:20:00.000Z' });
  // Sets a price, but on Hill 2, so it never touches Paris.
  const hill = S({ name: 'QA Hill', unit_id: 'h', unit_name: 'Hill 2', start_date: '2031-06-01', end_date: '2031-06-05', nightly_rate: '2900', created_at: '2026-10-13T10:30:00.000Z' });
  assert.equal(clashFor(all, [a, all, minOnly], 'QA Season A'), 'Overlaps QA Season A on Paris 1208: QA Season A wins the shared nights.');
  assert.equal(clashFor(all, [a, all, hill], 'QA Season A'), 'Overlaps QA Season A on Paris 1208: QA Season A wins the shared nights.');
});
