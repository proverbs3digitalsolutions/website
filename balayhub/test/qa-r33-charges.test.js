'use strict';
require('./helpers');
// Round 33 CHARGES (RSN-R, BKG-2): Void charge posts inside confirmDialog's onConfirm so a refusal keeps the typed reason.
// node --test --test-concurrency=1 test/qa-r33-charges.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/charges.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
const start = src.indexOf('const voidCharge = async');
const handler = src.slice(start, src.indexOf('const row = ', start));

test('Void charge dialog sends the request through onConfirm', () => {
  assert.ok(start > 0, 'voidCharge not found');
  assert.match(handler, /onConfirm:\s*\(why\)\s*=>\s*post\(`\/charges\/\$\{c\.charge_id\}\/void`,\s*\{\s*reason:\s*why\s*\}\)/);
});

test('nothing is posted after the dialog closes', () => {
  const after = handler.slice(handler.indexOf('if (!reason) return;'));
  assert.ok(after.includes('if (!reason) return;'));
  assert.doesNotMatch(after, /post\(/);
  assert.match(after, /toast\('Charge voided\.'\);\s*rerender\(\);/);
});
