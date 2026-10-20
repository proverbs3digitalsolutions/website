// R25 OWNERS: MNY-1 and LT-2 class. Record payout reports a zero amount and a missing method in one save.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/owners.js'), 'utf8');
const start = src.indexOf('const recordPayout = () => formModal({');
const block = src.slice(start, src.indexOf('const voidPayout', start));

test('recordPayout amount is positive-only (zero gets "must be greater than zero" from the device pass)', () => {
  assert.ok(start > 0 && block.length > 100, 'recordPayout block found');
  assert.match(block, /name: 'amount'[^\n]*positive: true/);
});

test('recordPayout Method shows the required mark without the required attribute, so the view\'s own sentence wins', () => {
  const m = block.match(/field\(\{ name: 'method'[^\n]*\}\)/);
  assert.ok(m, 'method field found');
  assert.match(m[0], /markRequired: true/);
  assert.doesNotMatch(m[0], /\brequired: true/);
  assert.match(block, /Choose how you paid the owner\./);
});
