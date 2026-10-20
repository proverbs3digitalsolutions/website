'use strict';

// QA r27 RENT (MNY-1): one file check shared by the Add forms and both detail-page upload buttons.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/rent.js'), 'utf8');

function load() {
  const body = src.slice(src.indexOf('const RECEIPT_TYPES'), src.indexOf('function receiptField')).replace(/export function/g, 'function');
  return new Function(`${body}; return { fileProblem, receiptProblem };`)();
}

test('fileProblem: empty, wrong type, too big, good, none', () => {
  assert.equal(typeof load().fileProblem, 'function', 'fileProblem exists');
  const { fileProblem } = load();
  assert.equal(fileProblem({ type: 'application/pdf', size: 0 }), 'This file is empty. Choose the receipt file again.');
  assert.match(fileProblem({ type: 'text/plain', size: 10 }), /Upload a PDF, JPG, PNG or WEBP file up to 10 MB\./);
  assert.match(fileProblem({ type: 'image/png', size: 11 * 1024 * 1024 }), /up to 10 MB/);
  assert.equal(fileProblem({ type: 'image/jpeg', size: 1024 * 1024 }), undefined);
  assert.equal(fileProblem(undefined), undefined);
});

test('receiptProblem uses fileProblem on the form box', () => {
  const { receiptProblem } = load();
  const form = (f) => ({ querySelector: () => ({ files: f ? [f] : [] }) });
  assert.match(receiptProblem(form({ type: 'application/pdf', size: 0 })), /empty/);
  assert.equal(receiptProblem(form(null)), undefined);
});

test('both detail upload buttons check the file before sending', () => {
  for (const [kind, id] of [['payment', 'p.payment_id'], ['expense', 'x.expense_id']]) {
    const re = new RegExp(`Choose a file first\\.[\\s\\S]{0,120}?fileProblem\\(upload\\.files\\[0\\]\\)[\\s\\S]{0,120}?toast\\(bad, 'error'\\); return;[\\s\\S]{0,80}?e\\.target\\.disabled = true;[\\s\\S]{0,60}?uploadFile\\('${kind}', ${id.replace('.', '\\.')}`);
    assert.match(src, re, kind);
  }
});

test('expenseNeedsAsk is still exported', () => {
  assert.match(src, /export (function|const) expenseNeedsAsk/);
});
