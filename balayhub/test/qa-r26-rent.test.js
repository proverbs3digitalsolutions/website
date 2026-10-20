'use strict';

// QA r26 RENT (MNY-1, D-105 (a3)): an empty receipt file is refused on the device; a receipt that fails after the save gives one error toast, never a success toast on top.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/rent.js'), 'utf8');

function loadReceiptProblem() {
  const start = src.indexOf('const RECEIPT_TYPES');
  const end = src.indexOf('function receiptField');
  const body = src.slice(start, end).replace('export function', 'function');
  return new Function(`${body}; return receiptProblem;`)();
}
const formWith = (file) => ({ querySelector: () => ({ files: file ? [file] : [] }) });

test('receiptProblem refuses an empty file, accepts a 1 MB JPG, keeps the type and size messages', () => {
  const rp = loadReceiptProblem();
  assert.equal(rp(formWith({ type: 'application/pdf', size: 0 })), 'This file is empty. Choose the receipt file again.');
  assert.equal(rp(formWith({ type: 'image/jpeg', size: 1024 * 1024 })), undefined);
  assert.equal(rp(formWith(null)), undefined);
  assert.match(rp(formWith({ type: 'text/plain', size: 10 })), /Upload a PDF, JPG, PNG or WEBP file up to 10 MB\./);
  assert.match(rp(formWith({ type: 'image/png', size: 11 * 1024 * 1024 })), /up to 10 MB/);
});

test('attachReceipt shows no toast of its own and returns true or the server message', async () => {
  const start = src.indexOf('async function attachReceipt');
  const fn = src.slice(start, src.indexOf('\n}\n', start) + 2);
  assert.doesNotMatch(fn, /toast\(/, 'no toast inside attachReceipt');
  const make = (uploadFile) => new Function('uploadFile', `${fn}; return attachReceipt;`)(uploadFile);
  const withFile = { querySelector: () => ({ files: [{}] }) };
  assert.equal(await make(async () => {})(withFile, 'expense', 1), true);
  assert.equal(await make(async () => {})(formWith(null), 'expense', 1), true);
  assert.equal(await make(async () => { throw new Error('File type not allowed.'); })(withFile, 'expense', 1), 'File type not allowed.');
});

test('each caller shows exactly one toast: failure says so, success is not shown', () => {
  assert.match(src, /const up = await attachReceipt\(form, 'expense'[\s\S]*?up !== true[\s\S]*?Expense saved, but the receipt didn't upload: \$\{up\}`, 'error'/);
  assert.match(src, /const up = await attachReceipt\(form, 'payment'[\s\S]*?up !== true[\s\S]*?Payment saved, but the receipt didn't upload: \$\{up\}`, 'error'/);
  assert.match(src, /This expense was already saved\./);
  assert.match(src, /This payment was already saved\./);
});
