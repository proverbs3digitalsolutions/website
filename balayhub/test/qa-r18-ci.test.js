'use strict';
// Host check-in card: "5 (booked for 3)" like the gate pass; fewer registered shows just the count.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/checkin.js'), 'utf8');
const m = src.match(/export const registeredText = ([^\n]+);\n/);

test('registeredText wording', () => {
  assert.ok(m, 'helper exported');
  const f = eval(m[1]); // eslint-disable-line no-eval
  assert.equal(f(5, 3), '5 (booked for 3)');
  assert.equal(f(2, 1), '2 (booked for 1)');
  assert.equal(f(3, 3), '3');
  assert.equal(f(2, 3), '2');
  assert.equal(f(2, null), '2');
  assert.doesNotMatch(src, /registered · booked for/);
  assert.match(src, /registeredText\(reg, d\.num_guests\)/);
});
