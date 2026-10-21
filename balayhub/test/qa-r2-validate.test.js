'use strict';
require('./helpers');

// QA round 2, lane B26 (calendar#6, settings#5). A well-formed money amount with too many whole
// digits says "<Label> is too large.", not "must be a valid amount". The 99,999,999.99 cap stays,
// and text that is not an amount keeps the "valid amount" message.

const test = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../src/lib/validate');

const spec = { amount: { type: 'money', label: 'Accommodation total' } };

// Returns the field message for a refused amount; fails the test if the amount is accepted.
function refusal(raw) {
  try {
    validate({ amount: raw }, spec);
  } catch (err) {
    assert.equal(err.status, 400);
    return err.extra.fields.amount;
  }
  assert.fail(`expected ${JSON.stringify(raw)} to be refused`);
}

test('a well-formed amount with too many whole digits says "is too large."', () => {
  assert.equal(refusal('100000000'), 'Accommodation total is too large.');
  assert.equal(refusal('12345678901'), 'Accommodation total is too large.');
  assert.equal(refusal(12345678901), 'Accommodation total is too large.');
  assert.equal(refusal('₱12,345,678,901.50'), 'Accommodation total is too large.');
  assert.equal(refusal('9'.repeat(400)), 'Accommodation total is too large.');
});

test('the 99,999,999.99 cap is kept, and text that is not an amount keeps its message', () => {
  assert.deepEqual(validate({ amount: '99999999.99' }, spec), { amount: '99999999.99' });
  assert.equal(refusal('abc'), 'Accommodation total must be a valid amount (e.g. 8500 or 8500.50).');
  assert.equal(refusal('12345678901.234'), 'Accommodation total must be a valid amount (e.g. 8500 or 8500.50).');
});

test('a huge negative amount is refused for the sign first, as a small one is', () => {
  assert.equal(refusal('-12345678901'), 'Accommodation total cannot be negative.');
  assert.equal(refusal('-5000'), 'Accommodation total cannot be negative.');
});
