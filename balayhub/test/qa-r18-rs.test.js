'use strict';

// Round 18 lane RS: Record payment reports amount and method errors together; the unpaid saved view has its new name.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const res = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/reservations.js'), 'utf8');

test('Record payment check reports the amount problem and the method problem in one pass', () => {
  const m = res.match(/const recordPayment = [\s\S]*?fields: \[/)[0];
  assert.match(m, /refundAmountProblem/);
  assert.match(m, /must be a valid amount \(e\.g\. 8500 or 8500\.50\)\./);
  assert.match(m, /Choose how the guest paid\./);
  // The amount and the method are collected into one object, not returned one at a time.
  assert.doesNotMatch(m, /\? \{ payment_method: 'Choose how the guest paid\.' \} : null/);
});

test("saved view 'Upcoming unpaid' is renamed", () => {
  assert.doesNotMatch(res, /Upcoming unpaid/);
  assert.match(res, /\['unpaid', 'Unpaid, not yet checked out'\]/);
});
