'use strict';

// QA r28 RENT (a1): an empty receipt or attachment gets one sentence on every rent page control (D-110).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/rent.js'), 'utf8');
const EMPTY = 'This file is empty. Choose the file again.';
const OLD = 'This file is empty. Choose the receipt file again.';

function load() {
  const body = src.slice(src.indexOf('const RECEIPT_TYPES'), src.indexOf('function receiptField')).replace(/export function/g, 'function');
  return new Function(`${body}; return { fileProblem, receiptProblem };`)();
}

test('fileProblem: an empty file gets the one wording, whatever its type', () => {
  const { fileProblem } = load();
  assert.equal(fileProblem({ size: 0, type: 'application/pdf' }), EMPTY);
  assert.equal(fileProblem({ size: 0, type: 'image/png' }), EMPTY);
});

test('fileProblem: the type and size sentence and a good file are unchanged', () => {
  const { fileProblem } = load();
  assert.match(fileProblem({ type: 'text/plain', size: 10 }), /^Upload a PDF, JPG, PNG or WEBP file up to 10 MB\.$/);
  assert.equal(fileProblem({ size: 1024 * 1024, type: 'image/jpeg' }), undefined);
  assert.equal(fileProblem(undefined), undefined);
});

test('the old receipt-only sentence is gone from rent.js', () => {
  assert.equal(src.includes(OLD), false, 'old sentence still in rent.js');
  assert.equal(src.includes('Choose the receipt file again'), false, 'old wording still in rent.js');
});

test('the new sentence is written once in rent.js, exactly as the strategy words it', () => {
  assert.equal(src.split(EMPTY).length - 1, 1);
});
