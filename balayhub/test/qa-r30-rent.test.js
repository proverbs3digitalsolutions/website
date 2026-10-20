'use strict';
require('./helpers');

// QA r30 RENT (LT-1): a renamed file is refused on the device, in the same save as every other problem, before the payment or expense is written.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/rent.js'), 'utf8');
const CONTENT = "This file isn't a real PDF, JPG, PNG or WEBP. Choose the file again.";
const EMPTY = 'This file is empty. Choose the file again.';
const TYPE = 'Upload a PDF, JPG, PNG or WEBP file up to 10 MB.';

// Load receiptCheck from the view without its imports; fileContentError is a stub that records its calls.
function load(stubResult) {
  const calls = [];
  const fileContentError = async (f) => { calls.push(f); return stubResult; };
  const consts = src.match(/const RECEIPT_[A-Z_]+ = [^\n]+\n/g) || [];
  const grab = (name) => { const m = src.match(new RegExp(`export (async )?function ${name}[\\s\\S]*?\\n\\}\\n`)); assert.ok(m, `${name} is exported from rent.js`); return m[0].replace('export ', ''); };
  const receiptCheck = new Function('fileContentError', `${consts.join('')}${grab('fileProblem')}${grab('receiptProblem')}${grab('receiptCheck')}; return receiptCheck;`)(fileContentError);
  return { receiptCheck, calls };
}
const formWith = (f) => ({ querySelector: (s) => (s === 'input[name="__receipt"]' ? { files: f ? [f] : [] } : null) });

test('receiptCheck: empty file gives the empty sentence and never reads the bytes', async () => {
  const { receiptCheck, calls } = load(CONTENT);
  assert.equal(await receiptCheck(formWith({ type: 'application/pdf', size: 0 })), EMPTY);
  assert.equal(calls.length, 0);
});

test('receiptCheck: wrong type or size gives the type sentence, bytes not read', async () => {
  const { receiptCheck, calls } = load(CONTENT);
  assert.equal(await receiptCheck(formWith({ type: 'text/plain', size: 10 })), TYPE);
  assert.equal(calls.length, 0);
});

test('receiptCheck: a renamed file gets the content sentence', async () => {
  const f = { type: 'image/png', size: 5 };
  const { receiptCheck, calls } = load(CONTENT);
  assert.equal(await receiptCheck(formWith(f)), CONTENT);
  assert.equal(calls[0], f);
});

test('receiptCheck: a real file or no file passes', async () => {
  const { receiptCheck } = load(null);
  assert.ok(!(await receiptCheck(formWith({ type: 'image/png', size: 5 }))));
  assert.ok(!(await receiptCheck(formWith(null))));
});

test('both receipt forms await receiptCheck in an async check; Correct expense skips it', () => {
  assert.match(src, /import \{[^}]*\bfileContentError\b[^}]*\} from '\.\.\/api\.js'/);
  const pay = src.slice(src.indexOf('export async function recordPaymentModal'), src.indexOf('// ---------------------------------------------------------------- add expense'));
  assert.match(pay, /check: async \(d, form\)[\s\S]*await receiptCheck\(form\)[\s\S]*out\.__receipt/, 'Record payment');
  const exp = src.slice(src.indexOf('export async function addExpenseModal'));
  assert.match(exp.slice(0, exp.indexOf('onSubmit')), /check: async \(d, form\)[\s\S]*!expense && await receiptCheck\(form\)/, 'Add expense');
});
