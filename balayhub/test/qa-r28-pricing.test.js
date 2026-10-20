'use strict';

// QA round 28, lane PRICING: MNY-1 (bulk percent is checked on the page with the server's four rules and words). Pure: no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/views/pricing.js'), 'utf8');
let view; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-pricing-r28-'));
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

const ok = { from: '2031-06-01', to: '2031-06-05', action: 'percent', unit_ids: ['u1'] };
const pct = (percent) => view.bulkProblems({ ...ok, percent }).percent;

test('MNY-1: bulk percent uses the server rules and words', () => {
  assert.equal(pct(NaN), 'Enter a percentage between -90 and 300.');
  assert.equal(pct(-150), 'Change (%) must be at least -90.');
  assert.equal(pct(301), 'Change (%) must be at most 300.');
  assert.equal(pct(2.5), 'Change (%) must be a whole number.');
  assert.equal(pct(0), 'Choose a change other than 0%.');
  for (const n of [-90, 300, -10]) assert.equal(pct(n), undefined);
});

test('MNY-1: other actions are unchanged', () => {
  assert.deepEqual(view.bulkProblems({ ...ok, action: 'set', price: '2500', percent: 999 }), {});
  assert.deepEqual(view.bulkProblems({ ...ok, action: 'clear', percent: NaN }), {});
});

test('MNY-1: body() sends NaN, not 0, for an empty percent box', () => {
  assert.match(SRC, /b\.percent = pct\.value\.trim\(\) === '' \? NaN : Number\(pct\.value\)/);
  assert.doesNotMatch(SRC, /b\.percent = Number\(pct\.value\);/);
});
