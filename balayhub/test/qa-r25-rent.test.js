'use strict';

// QA r25 RENT (LT-2, MNY-2): Method shows the required mark without the `required` attribute; a wrong or oversized receipt is refused in the same pass as the form's other problems.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '../public/js/views/rent.js');
const src = fs.readFileSync(file, 'utf8');

// Load receiptProblem from the view without its imports.
function loadReceiptProblem() {
  const m = src.match(/export function receiptProblem[\s\S]*?\n\}\n/);
  assert.ok(m, 'receiptProblem is exported from rent.js');
  const f = src.match(/export function fileProblem[\s\S]*?\n\}\n/);
  assert.ok(f, 'fileProblem is exported from rent.js');
  const consts = src.match(/const RECEIPT_[A-Z_]+ = [^\n]+\n/g) || [];
  return new Function(`${consts.join('')}${f[0].replace('export ', '')}${m[0].replace('export ', '')}; return receiptProblem;`)();
}
const formWith = (f) => ({ querySelector: (s) => (s === 'input[name="__receipt"]' ? { files: f ? [f] : [] } : null) });
const MSG = 'Upload a PDF, JPG, PNG or WEBP file up to 10 MB.';

test('receiptProblem refuses a wrong type or an oversized file, passes a good one or none', () => {
  const p = loadReceiptProblem();
  assert.equal(p(formWith({ type: 'text/plain', size: 10 })), MSG);
  assert.equal(p(formWith({ type: 'application/pdf', size: 11 * 1024 * 1024 })), MSG);
  assert.equal(p(formWith({ type: 'image/jpeg', size: 1024 * 1024 })), undefined);
  assert.equal(p(formWith({ type: 'application/pdf', size: 10 * 1024 * 1024 })), undefined);
  assert.equal(p(formWith(null)), undefined);
});

test('receiptField is a proper field wrapper with an error line', () => {
  const fn = src.slice(src.indexOf('function receiptField'), src.indexOf('async function attachReceipt'));
  assert.match(fn, /'data-field': '__receipt'/);
  assert.match(fn, /class: 'error'[^)]*id: 'receipt-input-err'|id: 'receipt-input-err'[^)]*class: 'error'/);
  assert.match(fn, /'aria-describedby'/);
});

test('every form with a receipt box adds receiptProblem to its check', () => {
  const pay = src.slice(src.indexOf('export async function recordPaymentModal'), src.indexOf('// ---------------------------------------------------------------- add expense'));
  assert.match(pay, /check: \(d, form\)[\s\S]*receiptProblem\(form\)[\s\S]*out\.__receipt/, 'Record payment');
  const exp = src.slice(src.indexOf('export async function addExpenseModal'));
  assert.match(exp.slice(0, exp.indexOf('onSubmit')), /check: \(d, form\)[\s\S]*receiptProblem\(form\)/, 'Add expense');
});

test('Record payment Method has the required mark but not the required attribute', () => {
  const pay = src.slice(src.indexOf('export async function recordPaymentModal'));
  const m = pay.match(/field\(\{ name: 'payment_method'[^\n]*\n/);
  assert.ok(m);
  assert.match(m[0], /markRequired: true/);
  assert.doesNotMatch(m[0], /\brequired: true/);
  assert.match(pay, /Choose how the money was received\./, 'the D-92 sentence stays');
});
