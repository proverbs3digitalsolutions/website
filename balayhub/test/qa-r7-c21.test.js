'use strict';

// QA round 7, lane C21: changedKeys must not treat number-looking or boolean-looking TEXT as unchanged
// (a door code or Wi-Fi password change would go unlogged). Coercion only between a real number/boolean and text.

const test = require('node:test');
const assert = require('node:assert/strict');
const { changedKeys } = require('../src/lib/auditdiff');

const diff = (a, b) => changedKeys({ k: a }, { k: b });

test('text-vs-text is never coerced', () => {
  assert.deepEqual(diff('0123', '123'), ['k']);
  assert.deepEqual(diff('1234', '1234.0'), ['k']);
  assert.deepEqual(diff('1234', '+1234'), ['k']);
  assert.deepEqual(diff('12345678901234567890', '12345678901234567891'), ['k']);
  assert.deepEqual(diff('true', 'True'), ['k']);
  assert.deepEqual(diff('"true"', 'true'), ['k']);
  assert.deepEqual(diff('1e3', '1000'), ['k']);
  assert.deepEqual(diff(' 1234 ', '1234'), []);
});

test('real number/boolean vs canonical text is equal', () => {
  assert.deepEqual(diff(4200, '4200.00'), []);
  assert.deepEqual(diff('4200.00', 4200), []);
  assert.deepEqual(diff(true, 'true'), []);
  assert.deepEqual(diff('false', false), []);
  assert.deepEqual(diff(true, 'false'), ['k']);
  assert.deepEqual(diff(true, '"true"'), ['k']);
  assert.deepEqual(diff(4200, '4201'), ['k']);
});

test('numbers beyond the safe range are never compared numerically', () => {
  assert.deepEqual(diff(2 ** 60, '1152921504606846976'), ['k']);
  assert.deepEqual(diff(1e21, '1000000000000000000000'), ['k']);
});

test('time rule still holds', () => {
  assert.deepEqual(diff('14:00:00', '14:00'), []);
});
