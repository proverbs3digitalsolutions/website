'use strict';

// QA r26 lane REFUNDS (BKG-1): the Record refund Method choice is insisted on, so it shows the asterisk (markRequired)
// without the browser's own `required`, and refundCheck keeps the view's sentence. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/refunds.js'), 'utf8');

test('BKG-1 the Method field is marked required but does not carry required', () => {
  const m = src.match(/field\(\{ name: 'method'[^\n]*\)\),?\n/);
  assert.ok(m, 'Method field not found');
  assert.match(m[0], /markRequired: true/);
  assert.doesNotMatch(m[0], /\brequired: true/);
});

test('BKG-1 an empty Method still gets the view sentence together with the other messages', () => {
  const grab = (name) => src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`))[0].replace('export ', '');
  const parseAmount = (v) => Number(String(v).replace(/,/g, ''));
  const refundAmountProblem = new Function('parseAmount', `${grab('refundAmountProblem')}\nreturn refundAmountProblem;`)(parseAmount);
  const refundCapProblem = new Function(`${grab('refundCapProblem')}\nreturn refundCapProblem;`)();
  const refundCheck = new Function('parseAmount', 'refundAmountProblem', 'refundCapProblem', `${grab('refundCheck')}\nreturn refundCheck;`)(parseAmount, refundAmountProblem, refundCapProblem);
  const f = refundCheck({ amount: '0', method: '', reason: 'x'.repeat(501) }, { refundable: '1000.00' });
  assert.equal(f.method, 'Choose how the money was refunded.');
  assert.ok(f.amount && f.reason);
});
