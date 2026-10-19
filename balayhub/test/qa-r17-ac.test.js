'use strict';

// QA round 17, lane AC: two-decimal total (#24), whole-list total (#25), coupon ceiling question (#22), list text (K5).
// node --test --test-concurrency=1 test/qa-r17-ac.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const view = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'admincoupons.js'), 'utf8');
const helpers = () => {
  const a = view.indexOf('// ---- helpers'); const b = view.indexOf('// ---- end helpers');
  return new Function(`${view.slice(a, b)}\nreturn { pesoText, discountText, toCentavos };`)();
};

test('pesoText keeps the centavos', () => {
  const { pesoText } = helpers();
  assert.equal(pesoText(59890), '₱598.90');
  assert.equal(pesoText(9999999900), '₱99,999,999.00');
  assert.equal(pesoText(5), '₱0.05');
});

test('discountText: separators, centavos only when present', () => {
  const { discountText } = helpers();
  assert.equal(discountText({ kind: 'fixed', amount_off: '99999999.00' }), '₱99,999,999 off');
  assert.equal(discountText({ kind: 'fixed', amount_off: '250.50' }), '₱250.50 off');
  assert.equal(discountText({ kind: 'fixed', amount_off: '200.00' }), '₱200 off');
});

test('view asks above the plan ceiling, resends with the flag, uses the server total', () => {
  assert.ok(view.includes("err.code !== 'AMOUNT_ABOVE_PLAN'"));
  assert.ok(view.includes('is more than the highest plan price ('));
  assert.ok(view.includes('so the plan would be free. Save anyway?'));
  assert.ok(view.includes("title: 'Check the amount off'"));
  assert.ok(view.includes('confirm_high_amount: true'));
  assert.ok(view.includes('f.elements.amount_off.focus(); return false;'));
  assert.ok(view.includes('pesoText(toCentavos(summary.discount_total))'));
  assert.doesNotMatch(view, /totalDiscount|parseFloat/);
});
