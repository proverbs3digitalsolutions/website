'use strict';

// QA round 22, lane PRICING (MNY-1b): Add season reports the missing price and the reversed dates in one pass.
// Pure: the browser module is loaded with stubs, so no database is needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let view; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-pricing-r22-'));
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

test('seasonProblems: a blank fixed price and reversed dates are both reported', () => {
  const p = view.seasonProblems({ price_mode: 'fixed', nightly_rate: '', start_date: '2031-06-05', end_date: '2031-06-01' });
  assert.deepEqual(Object.keys(p).sort(), ['end_date', 'nightly_rate']);
  assert.equal(p.end_date, 'The last night must be on or after the first night.');
});

test('seasonProblems: one problem alone, and none when fine', () => {
  assert.deepEqual(Object.keys(view.seasonProblems({ price_mode: 'pct', adjust_pct: '', start_date: '2031-06-01', end_date: '2031-06-01' })), ['adjust_pct']);
  assert.deepEqual(Object.keys(view.seasonProblems({ price_mode: 'none', start_date: '2031-06-05', end_date: '2031-06-01' })), ['end_date']);
  assert.equal(view.seasonProblems({ price_mode: 'fixed', nightly_rate: '2000', start_date: '2031-06-01', end_date: '2031-06-05' }), null);
  assert.equal(view.seasonProblems({ price_mode: 'none', start_date: '', end_date: '' }), null);
});
