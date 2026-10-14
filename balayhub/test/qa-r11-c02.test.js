'use strict';
// QA round 11, lane C02 (refunds and reservations views, frontend only, no database).
// #1 receipt overpaid line, #2 cap sentence once, #6 refund on a paid-up stay is asked, #3 source only for Direct, N7 string inputs.
// node --test --test-concurrency=1 test/qa-r11-c02.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const resSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/reservations.js'), 'utf8');
const refSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/refunds.js'), 'utf8');
const grab = (src, name) => {
  const m = src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `export function ${name} not found`);
  return m[0].replace('export ', '');
};
const peso = (v) => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const refundOwedAfter = new Function(`${grab(refSrc, 'refundOwedAfter')}\nreturn refundOwedAfter;`)();
const refundCapProblem = new Function(`${grab(refSrc, 'refundCapProblem')}\nreturn refundCapProblem;`)();
const receiptBalanceLine = new Function('peso', `${grab(resSrc, 'receiptBalanceLine')}\nreturn receiptBalanceLine;`)(peso);

test('#6 refundOwedAfter asks whenever a live stay would owe after the refund', () => {
  assert.equal(refundOwedAfter({ status: 'confirmed', balance: 0 }, 100), 100);
  assert.equal(refundOwedAfter({ status: 'confirmed', balance: 5200 }, 100), 5300);
  assert.equal(refundOwedAfter({ balance: -800 }, 500), 0);
  assert.equal(refundOwedAfter({ balance: -400 }, 1000), 600);
  assert.equal(refundOwedAfter({ status: 'cancelled', balance: 0 }, 100), 0);
  assert.equal(refundOwedAfter({ status: 'confirmed', balance: 0 }, NaN), 0);
});

test('#6 the second question has its own title and words', () => {
  assert.match(refSrc, /title: 'Refund leaves money owed\?'/);
  assert.match(refSrc, /After this \$\{peso\(amount\)\} refund the guest will owe \$\{peso\(owed\)\}\. Record it\?/);
});

test('N7 refundCapProblem with the string amounts the API returns', () => {
  assert.equal(refundCapProblem(99999, { refundable: '10000.00', paid: '10000.00', refunded: '0.00' }),
    'Only ₱10,000.00 is left to refund (₱10,000.00 paid, ₱0.00 already refunded).');
});

test('#2 the cap sentence is thrown at the field only; the banner points to it', () => {
  assert.match(refSrc, /new ApiError\('Please check the highlighted fields\.', \{ status: 400, fields: \{ amount: tooMuch \} \}\)/);
  assert.doesNotMatch(refSrc, /new ApiError\(tooMuch/);
});

test('#1 receiptBalanceLine says Overpaid by for a negative balance and is used by the receipt page', () => {
  assert.deepEqual(receiptBalanceLine('-800.00'), ['Overpaid by', '₱800.00']);
  assert.deepEqual(receiptBalanceLine('1200.00'), ['Remaining balance', '₱1,200.00']);
  assert.deepEqual(receiptBalanceLine('0.00'), ['Remaining balance', '₱0.00']);
  assert.match(resSrc, /receiptBalanceLine\(r\.balance_after\)/);
  assert.doesNotMatch(resSrc, /Math\.max\(0, Number\(r\.balance_after\)\)/);
});

test('#3 the source field shows only for Direct and is cleared when leaving Direct', () => {
  assert.match(resSrc, /src\.hidden = !direct/);
  assert.match(resSrc, /if \(switched && !direct && form\.elements\.source\) form\.elements\.source\.value = ''/);
});
