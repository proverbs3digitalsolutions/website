'use strict';
require('./helpers');

// QA round 33, REFUNDS (RSN-R, D-115). Void refund sends its request from inside the dialog, so a refusal
// is said there and the typed reason stays. Frontend-only source scan.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/refunds.js'), 'utf8');
const start = src.indexOf('const voidRefund = async');
const fn = src.slice(start, src.indexOf('\n  };\n', start) + 6);

test('voidRefund: reason dialog posts from onConfirm', () => {
  assert.ok(start > -1);
  assert.match(fn, /reason: true/);
  assert.match(fn, /onConfirm: \(why\) => post\(`\/refunds\/\$\{r\.refund_id\}\/void`, \{ reason: why \}\)/);
});

test('voidRefund: nothing is posted after the dialog and no try/catch is left', () => {
  const after = fn.slice(fn.indexOf('if (!reason) return;'));
  assert.ok(after.length > 0);
  assert.doesNotMatch(after, /post\(/);
  assert.doesNotMatch(fn, /try \{|catch/);
  assert.match(after, /toast\('Refund voided\.'\); rerender\(\);/);
});
