'use strict';

// QA round 23, lane PRICING (MNY-2): Bulk changes names every problem at once, with a mark on each box.
// Pure: the browser module is loaded with stubs, so no database is needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let view; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-pricing-r23-'));
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

const ok = { from: '2031-06-01', to: '2031-06-05', action: 'set', price: '2500', unit_ids: ['u1'] };

test('bulkProblems: reversed dates and a blank price are both reported', () => {
  const p = view.bulkProblems({ ...ok, to: '2031-05-01', price: '' });
  assert.deepEqual(Object.keys(p).sort(), ['price', 'to']);
  assert.equal(p.to, 'The last night must be on or after the first night.');
  assert.equal(p.price, 'Enter the new price per night.');
});

test('bulkProblems: price format, zero, and the other actions', () => {
  assert.match(view.bulkProblems({ ...ok, price: 'abc' }).price, /valid amount/);
  assert.equal(view.bulkProblems({ ...ok, price: '0' }).price, 'New price per night must be greater than zero.');
  assert.deepEqual(Object.keys(view.bulkProblems({ ...ok, action: 'percent', percent: NaN })), ['percent']);
  assert.deepEqual(Object.keys(view.bulkProblems({ ...ok, action: 'block', reason: '' })), ['reason']);
  assert.deepEqual(Object.keys(view.bulkProblems({ ...ok, unit_ids: [], from: '' })).sort(), ['from', 'unit_ids']);
  assert.deepEqual(Object.keys(view.bulkProblems({ ...ok, unit_ids: undefined, tag: '' })), ['tag']);
  assert.deepEqual(view.bulkProblems(ok), {});
  assert.deepEqual(view.bulkProblems({ ...ok, action: 'clear', price: 'abc' }), {}); // hidden box is not checked
});
