'use strict';

// QA round 2, B24 charges and refunds. money#9: add-on charges read "Add-on", not the raw "addon".
// money#12: the refund suggestion on a live reservation is labelled "If cancelled today", and the
// Record refund form is only prefilled with it once the reservation is cancelled.
// Frontend-only: no database. node --test --test-concurrency=1 test/qa-r2-charges-refunds.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chargesSrc = fs.readFileSync(path.join(__dirname, '../public/js/views/charges.js'), 'utf8');
const refundsSrc = fs.readFileSync(path.join(__dirname, '../public/js/views/refunds.js'), 'utf8');
const serverChargesSrc = fs.readFileSync(path.join(__dirname, '../src/routes/charges.js'), 'utf8');

// The views import browser modules, so pull the pure pieces out of the source and evaluate them.
const block = (src, re) => {
  const m = src.match(re);
  assert.ok(m, `not found in source: ${re}`);
  return m[0];
};

test('add-on charges are labelled "Add-on", and every category the server accepts has a label', () => {
  const categories = block(chargesSrc, /const CATEGORY = \{[\s\S]*?\n\};/);
  const labels = block(chargesSrc, /const LABEL = [^\n]*;/);
  const { CATEGORY, LABEL } = new Function(`${categories}\n${labels}\nreturn { CATEGORY, LABEL };`)();

  assert.equal(LABEL.addon, 'Add-on');
  assert.equal(LABEL.damage, 'Damage', 'existing labels are unchanged');
  assert.equal(CATEGORY.addon, undefined, 'hosts are not offered add-on in the Add charge form');

  const serverCategories = block(serverChargesSrc, /const CATEGORIES = \[[^\]]*\];/);
  const accepted = new Function(`${serverCategories}\nreturn CATEGORIES;`)();
  for (const c of accepted) assert.ok(LABEL[c], `no label for category ${c}`);
});

test('the refund suggestion says "If cancelled today" until the reservation is cancelled', () => {
  const fn = block(refundsSrc, /export function suggestionText[\s\S]*?\n}\n/).replace('export ', '');
  const suggestionText = new Function('peso', `${fn}\nreturn suggestionText;`)((c) => `₱${c}`);
  const s = { amount: '1000.00', percent: 50, rule: '50% refund: cancelled at least 7 days before check-in' };

  assert.equal(suggestionText(s, false),
    'If cancelled today, suggested refund: ₱1000.00 (50%). 50% refund: cancelled at least 7 days before check-in.');
  assert.equal(suggestionText(s, true),
    'Suggested refund: ₱1000.00 (50%). 50% refund: cancelled at least 7 days before check-in.');
});

test('the refund card uses the label, and prefills the Record refund form only once cancelled', () => {
  assert.match(refundsSrc, /const cancelled = reservation\.status === 'cancelled';/);
  assert.match(refundsSrc, /suggestionText\(data\.suggestion, cancelled\)/);
  assert.match(refundsSrc, /value: cancelled && Number\(data\.suggestion\?\.remaining\) > 0 \? data\.suggestion\.remaining : undefined/);
});
