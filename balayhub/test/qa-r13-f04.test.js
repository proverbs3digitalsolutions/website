'use strict';
// QA round 13, lane F04 (calendar, pricing, rates; frontend only, no database).
// rates.js: highStayTotalOk and highAddonPriceOk (the "Save anyway?" questions for a booking total and an add-on price).
// pricing.js: seasonModeProblem (#31), overlapLine (#30), a fixed season price asks above the ceiling (#28).
// calendar.js: compactCalendarFilters (#43), focus keys on night cells and booking tiles (#2).
// node --test --test-concurrency=1 test/qa-r13-f04.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..', 'public', 'js');
const calendar = fs.readFileSync(path.join(root, 'views', 'calendar.js'), 'utf8');
const pricing = fs.readFileSync(path.join(root, 'views', 'pricing.js'), 'utf8');

// rates.js and pricing.js load from a temp copy. ui.js re-exports the real one with confirmDialog replaced by a recorder.
let dir; let view;
test.before(async () => {
  globalThis.Element = class { };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r13-f04-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  fs.copyFileSync(path.join(root, 'api.js'), path.join(dir, 'api.js'));
  fs.copyFileSync(path.join(root, 'ui.js'), path.join(dir, 'ui-real.js'));
  fs.writeFileSync(path.join(dir, 'ui.js'), [
    "export * from './ui-real.js';",
    'export const asked = [];',
    'export let answer = true;',
    'export function setAnswer(v) { answer = v; }',
    'export async function confirmDialog(opts) { asked.push(opts); return answer; }',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner' } };\n");
  const reservations = fs.readFileSync(path.join(root, 'views', 'reservations.js'), 'utf8');
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), reservations.match(/export function addDays[\s\S]*?\n}\n/)[0]);
  fs.copyFileSync(path.join(root, 'views', 'pricing.js'), path.join(dir, 'views', 'pricing.js'));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

async function loaded() {
  fs.copyFileSync(path.join(root, 'rates.js'), path.join(dir, 'rates.js'));
  const rates = await import(pathToFileURL(path.join(dir, 'rates.js')).href);
  const ui = await import(pathToFileURL(path.join(dir, 'ui.js')).href);
  ui.asked.length = 0;
  ui.setAnswer(true);
  return { ...rates, ui };
}
const pricingView = () => (view ||= import(pathToFileURL(path.join(dir, 'views', 'pricing.js')).href));

test('highStayTotalOk: 60,000 for 2 nights is 30,000 a night and asks nothing', async () => {
  const { highStayTotalOk, ui } = await loaded();
  assert.equal(await highStayTotalOk(60000, 2), true);
  assert.equal(ui.asked.length, 0);
});

test('highStayTotalOk: 60,000 for 1 night asks, in plain words', async () => {
  const { highStayTotalOk, ui } = await loaded();
  assert.equal(await highStayTotalOk(60000, 1), true);
  assert.deepEqual(ui.asked[0], {
    title: 'Check the total', text: 'This is ₱60,000.00 a night (₱60,000.00 for 1 night). Save anyway?', confirmText: 'Save anyway', cancelText: 'Change it',
  });
  ui.setAnswer(null);
  assert.equal(await highStayTotalOk(120000, 2), false, 'Change it saves nothing');
  assert.match(ui.asked[1].text, /for 2 nights\)/);
});

test('highStayTotalOk: not a number, or no whole night count, goes ahead', async () => {
  const { highStayTotalOk, ui } = await loaded();
  for (const [t, n] of [[NaN, 1], [60000, 0], [60000, 1.5], [60000, undefined]]) assert.equal(await highStayTotalOk(t, n), true);
  assert.equal(ui.asked.length, 0);
});

test('highAddonPriceOk: asks above 50,000 only', async () => {
  const { highAddonPriceOk, ui } = await loaded();
  assert.equal(await highAddonPriceOk(1500), true);
  assert.equal(await highAddonPriceOk(50000), true);
  assert.equal(await highAddonPriceOk(''), true);
  assert.equal(ui.asked.length, 0);
  assert.equal(await highAddonPriceOk(99999999), true);
  assert.deepEqual(ui.asked[0], { title: 'Check the price', text: 'This add-on costs ₱99,999,999.00. Save anyway?', confirmText: 'Save anyway', cancelText: 'Change it' });
  ui.setAnswer(false);
  assert.equal(await highAddonPriceOk('60,000'), false);
});

test('#31 seasonModeProblem names the box the chosen mode needs', async () => {
  await loaded();
  const { seasonModeProblem } = await pricingView();
  assert.deepEqual(seasonModeProblem({ mode: 'fixed', nightly_rate: '' }), { nightly_rate: 'Enter a nightly rate for a fixed price.' });
  assert.deepEqual(seasonModeProblem({ mode: 'pct', adjust_pct: '' }), { adjust_pct: 'Enter a percentage change.' });
  assert.equal(seasonModeProblem({ mode: 'fixed', nightly_rate: '2500' }), null);
  assert.equal(seasonModeProblem({ mode: 'pct', adjust_pct: '-10' }), null);
  assert.equal(seasonModeProblem({ mode: 'pct', adjust_pct: '0' }), null);
  assert.equal(seasonModeProblem({ mode: 'none' }), null);
});

test('#30 overlapLine puts the season that lost first and the winner last', async () => {
  await loaded();
  const { overlapLine } = await pricingView();
  assert.equal(overlapLine('QA overlap', 'Christmas rush'), 'Christmas rush also covers this night, but QA overlap takes it.');
  assert.equal(overlapLine('C', 'A', 'B'), 'A, B also cover this night, but C takes it.');
});

test('#43 compactCalendarFilters folds for 3 or fewer listings', () => {
  const fn = new Function(`${calendar.match(/export const compactCalendarFilters = [^\n]+/)[0].replace('export ', '')}; return compactCalendarFilters;`)();
  assert.equal(fn(2), true);
  assert.equal(fn(3), true);
  assert.equal(fn(4), false);
});

test('#28 the season save asks about a fixed price through highRateOk, with the mode check first', () => {
  const save = pricing.slice(pricing.indexOf("onSubmit: async (d, { form }) => {\n      const { price_mode"));
  const problem = save.indexOf('seasonModeProblem(');
  const ask = save.indexOf('highRateOk(');
  const post_ = save.indexOf("post('/pricing/seasons'");
  assert.ok(problem > 0 && ask > problem && post_ > ask, 'mode check, then the question, then the save');
  assert.match(save, /mode === 'fixed' && !await highRateOk\(/);
});

test('#2 night cells and booking tiles carry their focus keys; the filters and legend fold', () => {
  assert.match(calendar, /'data-focus-key': `cal-night-\$\{l\.unit_id\}-\$\{d\}`/);
  assert.match(calendar, /'data-focus-key': `cal-booking-\$\{b\.booking_id\}`/);
  assert.match(calendar, /fold\('Filter', filterBar\(/);
  assert.match(calendar, /fold\('What the colours mean', legend, false\)/);
});
