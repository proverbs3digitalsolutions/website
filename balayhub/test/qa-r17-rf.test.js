'use strict';

// QA r17 lane RF: the refund form reports Amount, Method and Reason in one pass (#2), and the two reason boxes
// (refund, reject a proof) have no maxlength; the form checks 500 characters instead (O5). Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ref = read('public/js/views/refunds.js');
const proofs = read('public/js/views/proofs.js');
const grab = (src, name) => {
  const m = src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `export function ${name} not found`);
  return m[0].replace('export ', '');
};
const parseAmount = (v) => Number(String(v).replace(/,/g, ''));
const refundAmountProblem = new Function('parseAmount', `${grab(ref, 'refundAmountProblem')}\nreturn refundAmountProblem;`)(parseAmount);
const refundCapProblem = new Function(`${grab(ref, 'refundCapProblem')}\nreturn refundCapProblem;`)();
const refundCheck = new Function('parseAmount', 'refundAmountProblem', 'refundCapProblem', `${grab(ref, 'refundCheck')}\nreturn refundCheck;`)(parseAmount, refundAmountProblem, refundCapProblem);
const data = { refundable: '1000.00', paid: '1000.00', refunded: '0.00' };

test('#2 a zero amount, no method and no reason: Amount and Method are reported together', () => {
  const f = refundCheck({ amount: '0', method: '', reason: '' }, data);
  assert.equal(f.amount, 'Amount must be greater than zero.');
  assert.equal(f.method, 'Choose how the money was refunded.');
});

test('#2 negative and over-cap amounts are reported at the field; a good form passes', () => {
  assert.equal(refundCheck({ amount: '-5', method: 'cash', reason: 'x' }, data).amount, 'Amount cannot be negative.');
  assert.match(refundCheck({ amount: '5000', method: 'cash', reason: 'x' }, data).amount, /^Only ₱1,000\.00 is left to refund/);
  assert.equal(refundCheck({ amount: '', method: 'cash', reason: 'x' }, data), null, 'empty is the required-field message, not ours');
  assert.equal(refundCheck({ amount: '500', method: 'cash', reason: 'x'.repeat(500) }, data), null);
});

test('#6 a 501-character reason gets the standard sentence on the Reason field', () => {
  assert.equal(refundCheck({ amount: '500', method: 'cash', reason: 'x'.repeat(501) }, data).reason, 'Reason must be at most 500 characters.');
});

test('#2 the form uses refundCheck; onSubmit keeps its own checks', () => {
  assert.match(ref, /check: \(d\) => refundCheck\(d, data\)/);
  assert.match(ref, /refundAmountProblem\(amount\)/);
});

test('#6 no maxlength: 300 on either reason box; proofs checks the length in check', () => {
  assert.doesNotMatch(ref, /maxlength: 300/);
  assert.doesNotMatch(proofs, /maxlength: 300/);
  assert.match(proofs, /Reason must be at most 500 characters\./);
  assert.match(proofs, /check: /);
});
