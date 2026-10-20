'use strict';
// QA round 17, lane DP (deposits view, frontend only, no database).
// #3: a negative deduction is flagged at the field with the server's sentence, before any question.
// K1: the deposit photo uploads as soon as it is picked (no second "Add photo" step).
// node --test --test-concurrency=1 test/qa-r17-dp.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/deposits.js'), 'utf8');
const peso = (v) => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const parseAmount = (v) => Number(String(v).replace(/[₱,\s]/g, ''));
const m = src.match(/export function deductionProblem[\s\S]*?\n}\n/);
assert.ok(m, 'deductionProblem not found');
const deductionProblem = new Function('peso', 'parseAmount', `${m[0].replace('export ', '')}\nreturn deductionProblem;`)(peso, parseAmount);

test('#3 a negative deduction says so at the field', () => {
  assert.equal(deductionProblem('-5', '1000'), 'Deduction cannot be negative.');
  assert.equal(deductionProblem('0', '1000'), null);
  assert.equal(deductionProblem('', '1000'), null);
  assert.match(deductionProblem('1500', '1000'), /can't be more than the deposit/);
});

test('K1 the photo uploads on pick; no Add photo button, no Choose a photo first', () => {
  assert.match(src, /onchange: async \(\) => \{[\s\S]*?uploadFile\('deposit'/);
  assert.match(src, /id: 'deposit-photo-file'/);
  assert.match(src, /for: 'deposit-photo-file'/);
  assert.doesNotMatch(src, /'Add photo'/);
  assert.doesNotMatch(src, /Choose a photo first/);
  assert.ok(src.includes("Damage photos: add them on the deposit card (before or after saving)."));
});
