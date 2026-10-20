'use strict';

// QA round 26, lane PRICING (MNY-2): Add a season with a fixed price of 0 also reports it, together with the other problems.
// Pure: the browser module is loaded with stubs, so no database is needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let view; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-pricing-r26-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'rates.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { role: \'owner\' } };\n');
  const reservations = fs.readFileSync(path.join(__dirname, '../public/js/views/reservations.js'), 'utf8');
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), reservations.match(/export function addDays[\s\S]*?\n}\n/)[0]);
  fs.copyFileSync(path.join(__dirname, '../public/js/views/pricing.js'), path.join(dir, 'views', 'pricing.js'));
  globalThis.Element = class { };
  view = await import(pathToFileURL(path.join(dir, 'views', 'pricing.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const ZERO = 'Nightly rate must be greater than zero.';

test('seasonModeProblem: a fixed price of zero or less is refused with the server sentence', () => {
  for (const v of ['0', '0.00', '-5', ' 0 ']) assert.deepEqual(view.seasonModeProblem({ mode: 'fixed', nightly_rate: v }), { nightly_rate: ZERO }, v);
});

test('seasonModeProblem: blank keeps its own sentence; positive and unparsable text pass through', () => {
  assert.deepEqual(view.seasonModeProblem({ mode: 'fixed', nightly_rate: '' }), { nightly_rate: 'Enter a nightly rate for a fixed price.' });
  assert.equal(view.seasonModeProblem({ mode: 'fixed', nightly_rate: '2,500' }), null);
  assert.equal(view.seasonModeProblem({ mode: 'fixed', nightly_rate: 'abc' }), null);
});

test('seasonModeProblem: pct and none modes have no rate message even with rate 0', () => {
  assert.equal(view.seasonModeProblem({ mode: 'pct', nightly_rate: '0', adjust_pct: '-10' }), null);
  assert.equal(view.seasonModeProblem({ mode: 'none', nightly_rate: '0' }), null);
});

test('seasonProblems: price 0 and reversed dates are both reported in one pass', () => {
  const p = view.seasonProblems({ price_mode: 'fixed', nightly_rate: '0', min_nights: '-1', start_date: '2031-06-05', end_date: '2031-06-01' });
  assert.deepEqual(Object.keys(p).sort(), ['end_date', 'nightly_rate']);
  assert.equal(p.nightly_rate, ZERO);
  assert.equal(view.seasonProblems({ price_mode: 'pct', nightly_rate: '0', adjust_pct: '-10', start_date: '2031-06-01', end_date: '2031-06-02' }), null);
});

test('Add a season: the check hook feeds seasonProblems so the minimum-nights device pass and the rate show together', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/pricing.js'), 'utf8');
  assert.match(src, /check: \(d\) => seasonProblems\(d\)/);
  assert.match(src, /name: 'min_nights'[^\n]*min: 1/);
});
