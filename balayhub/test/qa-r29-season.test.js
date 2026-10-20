'use strict';

// QA round 29, lane SEASON (pricing view): a season overlap names the other season once, in one sentence (MNY-2,
// D-111). Pure: the browser module is loaded with stubs, so no database is needed (the qa-r3-pricing-view pattern).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let view; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-pricing-r29-season-'));
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
const clash = (o) => ({ name: 'QA Season A', on: null, wins: 'other', takeovers: [], ...o });

test('MNY-2: the other season is named once, and the sentence says it wins the shared nights', () => {
  assert.equal(view.clashText(clash()), 'Overlaps QA Season A, which wins the shared nights.');
});

test('MNY-2: on a listing, the listing follows the name and the verdict follows the listing', () => {
  assert.equal(view.clashText(clash({ on: 'Paris 1208' })), 'Overlaps QA Season A on Paris 1208, which wins the shared nights.');
});

test('MNY-2: when this season wins, the name is still said once (the plain sentence is unchanged)', () => {
  assert.equal(view.clashText(clash({ wins: 'this' })), 'Overlaps QA Season A: this season wins the shared nights.');
  assert.equal(view.clashText(clash({ wins: 'this', on: 'Paris 1208' })), 'Overlaps QA Season A on Paris 1208: this season wins the shared nights.');
});

test('MNY-2: a third season that takes some shared nights is named once, whichever season wins', () => {
  assert.equal(view.clashText(clash({ takeovers: ['QA Season B'] })),
    'Overlaps QA Season A, which wins the nights they share, except where QA Season B takes over.');
  assert.equal(view.clashText(clash({ wins: 'this', takeovers: ['QA Season B'] })),
    'Overlaps QA Season A: this season wins the nights they share, except where QA Season B takes over.');
  assert.equal(view.clashText(clash({ on: 'Paris 1208', takeovers: ['B', 'C'] })),
    'Overlaps QA Season A on Paris 1208, which wins the nights they share, except where B or C takes over.');
});

test('MNY-2: a season that sets no price only overlaps, with no verdict', () => {
  assert.equal(view.clashText(clash({ wins: null })), 'Overlaps QA Season A.');
  assert.equal(view.clashText(clash({ wins: null, on: 'Paris 1208' })), 'Overlaps QA Season A on Paris 1208.');
});

test('MNY-2: no overlap sentence names the other season twice', () => {
  const cases = [
    clash(), clash({ on: 'Paris 1208' }), clash({ wins: 'this' }), clash({ wins: 'this', on: 'Paris 1208' }),
    clash({ takeovers: ['QA Season B'] }), clash({ wins: 'this', takeovers: ['QA Season B'] }),
    clash({ on: 'Paris 1208', takeovers: ['QA Season B'] }), clash({ wins: null }),
  ];
  for (const c of cases) {
    const text = view.clashText(c);
    assert.equal(text.split(c.name).length - 1, 1, text);
  }
});

test('MNY-2: the Seasons table reads its overlaps from the real season list, naming the other season once', () => {
  const a = S({ name: 'QA Season A', unit_id: 'p', unit_name: 'Paris 1208', start_date: '2031-11-20', end_date: '2031-11-22', nightly_rate: '3100' });
  const b = S({ name: 'QA Season B', unit_id: 'p', unit_name: 'Paris 1208', start_date: '2031-11-20', end_date: '2031-11-21', nightly_rate: '3200', created_at: '2026-10-13T10:05:00.000Z' });
  const seasons = [a, b];
  assert.equal(view.clashText(view.seasonClashes(a, seasons)[0]), 'Overlaps QA Season B, which wins the shared nights.');
  assert.equal(view.clashText(view.seasonClashes(b, seasons)[0]), 'Overlaps QA Season A: this season wins the shared nights.');
});

test('MNY-2: an all-listings season that overlaps a listing season names the listing and the other season once', () => {
  const paris = S({ name: 'Paris Dec', unit_id: 'p', unit_name: 'Paris 1208', start_date: '2031-12-10', end_date: '2031-12-12', nightly_rate: '3100' });
  const all = S({ name: 'QA All Dec', start_date: '2031-12-09', end_date: '2031-12-11', adjust_pct: 10 });
  assert.equal(view.clashText(view.seasonClashes(all, [paris, all]).find((c) => c.name === 'Paris Dec')),
    'Overlaps Paris Dec on Paris 1208, which wins the shared nights.');
});
