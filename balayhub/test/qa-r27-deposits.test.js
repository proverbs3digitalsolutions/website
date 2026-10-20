'use strict';

// QA r27 DEPOSITS (BKG-1, D-107): the Return deposit form reports the deduction problems in its check hook, before the early-return question;
// the Reason field is marked required while the deduction is above 0.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/deposits.js'), 'utf8');

function load() {
  const start = src.indexOf('export function deductionProblem');
  const end = src.indexOf('export function returnLine');
  const body = src.slice(start, end).replace(/export function/g, 'function');
  const parseAmount = (s) => (String(s).trim() === '' ? 0 : Number(String(s).replace(/[₱,\s]/g, '')));
  const peso = (n) => `₱${Number(n).toFixed(2)}`;
  return new Function('parseAmount', 'peso', `${body}; return { deductionProblem, settleProblems: typeof settleProblems === 'function' ? settleProblems : null, markReason: typeof markReason === 'function' ? markReason : null };`)(parseAmount, peso);
}

test('settleProblems: 100 with an empty reason gives the reason message only', () => {
  const { settleProblems } = load();
  assert.ok(settleProblems, 'settleProblems is exported');
  assert.deepEqual(settleProblems({ deduction_amount: '100', deduction_reason: '  ' }, 500), { deduction_reason: 'Explain the deduction (the guest sees this).' });
});

test('settleProblems: 600 on a 500 deposit with an empty reason gives both messages in one pass', () => {
  const { settleProblems } = load();
  const p = settleProblems({ deduction_amount: '600', deduction_reason: '' }, 500);
  assert.match(p.deduction_amount, /can't be more than the deposit/);
  assert.equal(p.deduction_reason, 'Explain the deduction (the guest sees this).');
});

test('settleProblems: 0 and an empty reason gives none; a reason typed clears it', () => {
  const { settleProblems } = load();
  assert.equal(settleProblems({ deduction_amount: '0', deduction_reason: '' }, 500), null);
  assert.equal(settleProblems({ deduction_amount: '100', deduction_reason: 'Broken glass' }, 500), null);
});

test('markReason: asterisk and aria-required on at 100, off at 0', () => {
  const { markReason } = load();
  assert.ok(markReason, 'markReason is exported');
  const attrs = {}; const req = { hidden: false }; const ta = { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
  const el = { querySelector: (s) => (s === '.req' ? req : ta) };
  markReason(el, true);
  assert.equal(req.hidden, false); assert.equal(attrs['aria-required'], 'true');
  markReason(el, false);
  assert.equal(req.hidden, true); assert.equal(attrs['aria-required'], undefined);
});

test('settle wires the check hook before the question; onSubmit no longer throws the deduction problem', () => {
  const settle = src.slice(src.indexOf('const settle = () =>'), src.indexOf('const reopen'));
  assert.match(settle, /check: \(d\) => settleProblems\(d, dep\.amount\)/);
  assert.match(settle, /markRequired: true/);
  assert.match(settle, /markReason\(reasonField, /);
  const submit = settle.slice(settle.indexOf('onSubmit'));
  assert.doesNotMatch(submit, /deductionProblem/);
});
