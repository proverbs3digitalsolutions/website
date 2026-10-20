'use strict';
// QA round 13, lane F03 (booking money views, frontend only, no database).
// #1 focus keys on stay and deposit buttons, #5 deduction checked before the early-return question,
// N4 booking total asks above 50,000 a night, K7a apiFilters takes one argument.
// node --test --test-concurrency=1 test/qa-r13-f03.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const res = read('public/js/views/reservations.js');
const dep = read('public/js/views/deposits.js');
const grab = (src, name) => {
  const m = src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `export function ${name} not found`);
  return m[0].replace('export ', '');
};
const peso = (v) => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const parseAmount = (v) => Number(String(v).replace(/[₱,\s]/g, ''));

test('#5 deductionProblem gives the server sentence above the deposit, null otherwise', () => {
  const deductionProblem = new Function('peso', 'parseAmount', `${grab(dep, 'deductionProblem')}\nreturn deductionProblem;`)(peso, parseAmount);
  assert.equal(deductionProblem('5000', '1000.00'), "The deduction can't be more than the deposit (₱1,000.00).");
  assert.equal(deductionProblem('500', '1000.00'), null);
  assert.equal(deductionProblem('1000', '1000.00'), null);
  assert.equal(deductionProblem('', '1000.00'), null);
});

test('#5 settle checks the deduction before the early-return question', () => {
  const i = dep.indexOf('check: (d) => settleProblems(d, dep.amount)');
  const j = dep.indexOf('askEarlyReturn(r, todayManila()) &&');
  assert.ok(i > 0 && j > 0 && i < j, 'the settle check (settleProblems) must run before askEarlyReturn');
  assert.match(dep, /export function settleProblems[\s\S]*?deductionProblem\(d\.deduction_amount, held\)/, 'settleProblems calls deductionProblem');
  assert.match(dep, /if \(tooMuch\) p\.deduction_amount = tooMuch;/, 'and sets p.deduction_amount');
});

test('N4 New and Edit reservation ask highStayTotalOk with the nights', () => {
  assert.match(res, /import \{[^}]*highStayTotalOk[^}]*\} from '\.\.\/rates\.js'/);
  assert.equal((res.match(/highStayTotalOk\(/g) || []).length, 2);
  const edit = res.slice(res.indexOf("title: 'Edit reservation'"));
  assert.match(edit, /'accommodation_total' in changes/);
  assert.ok(edit.indexOf("'accommodation_total' in changes") > edit.indexOf('Use the new price?'));
});

test('#1 stay buttons and deposit buttons carry their focus keys', () => {
  assert.equal((res.match(/'data-focus-key': 'stay-status'/g) || []).length, 4);
  assert.equal((dep.match(/'data-focus-key': 'deposit-action'/g) || []).length, 3);
});

test('K7a no apiFilters call passes a second argument', () => {
  for (const src of [res, dep, read('public/js/views/refunds.js'), read('public/js/views/groups.js')]) {
    assert.doesNotMatch(src, /apiFilters\([^()]*,/);
  }
});
