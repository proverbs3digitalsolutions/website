'use strict';

// QA r25 RENT-DRAFT (D-106): a restored Record payment draft shows the Current balance line; a restored expense draft refills its unit list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/rent.js'), 'utf8');

test('recordPaymentModal draws the balance line for a restored tenant, without touching the amount', () => {
  const modal = src.slice(src.indexOf('export async function recordPaymentModal'), src.indexOf('// ---------------------------------------------------------------- add expense'));
  const afterForm = modal.slice(modal.indexOf('formModal({'));
  assert.match(afterForm, /\n  \}\);\n[\s\S]*leaseField\.querySelector\('select'\)\.value[\s\S]*!balanceInfo\.firstChild[\s\S]*showBalance\(/, 'balance drawn after formModal for a restored tenant');
  const tail = afterForm.slice(afterForm.lastIndexOf('\n  });\n'));
  assert.doesNotMatch(tail, /filled\s*=|nextSuggestedAmount/, 'restored amount is not re-suggested');
});

test('addExpenseModal refills units for a restored property', () => {
  const modal = src.slice(src.indexOf('export async function addExpenseModal'));
  const tail = modal.slice(modal.indexOf('\n  });\n'));
  assert.match(tail.slice(0, 600), /fillUnits\(/, 'units refilled after the draft is restored');
});
