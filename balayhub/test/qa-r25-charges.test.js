'use strict';

// QA r25 CHARGES (BKG-2): Add charge price per unit is positive (the server's rule), so quantity 0 and price 0 are both named on the first save. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r25ch-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

const src = fs.readFileSync(path.join(JS, 'views/charges.js'), 'utf8');
const priceLine = src.split('\n').find((l) => l.includes("name: 'unit_price'"));

test('the unit_price field is positive, as the server requires', () => {
  assert.ok(priceLine, 'unit_price field found');
  assert.match(priceLine, /positive: true/);
});

const ctl = (sel, name, value, o = {}) => ({
  sel, name, value, disabled: false, min: o.min ?? '', max: '',
  closest: () => null,
  hasAttribute: (a) => a === 'data-positive' && !!o.positive,
  getAttribute: () => null,
});
const formOf = (...els) => ({ querySelectorAll: (s) => els.filter((e) => e.sel === s) });
const label = (el) => ({ quantity: 'Quantity', unit_price: 'Price per unit' }[el.name]);
// Mirrors the field the view builds: positive only when the source says so.
const positive = /positive: true/.test(priceLine || '');

test('quantity 0 and price 0 give both messages in one pass; quantity 1 and price 0 gives the price message', () => {
  const both = ui.typeProblems(formOf(
    ctl('input[type=number]', 'quantity', '0', { min: '1' }),
    ctl('.input-money input', 'unit_price', '0', { positive })), {}, label);
  assert.deepEqual(both, { quantity: 'Quantity must be at least 1.', unit_price: 'Price per unit must be greater than zero.' });
  const one = ui.typeProblems(formOf(
    ctl('input[type=number]', 'quantity', '1', { min: '1' }),
    ctl('.input-money input', 'unit_price', '0', { positive })), {}, label);
  assert.deepEqual(one, { unit_price: 'Price per unit must be greater than zero.' });
});
