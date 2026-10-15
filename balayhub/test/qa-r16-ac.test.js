'use strict';

// QA round 16, lane AC: required marks follow the coupon kind (#20), unlimited free question and short-code hint (#21).
// node --test --test-concurrency=1 test/qa-r16-ac.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const view = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'admincoupons.js'), 'utf8');
const helpers = () => {
  const a = view.indexOf('// ---- helpers'); const b = view.indexOf('// ---- end helpers');
  return new Function(`${view.slice(a, b)}\nreturn { unlimitedFree, shortCode };`)();
};

test('unlimitedFree: only a free coupon with once-per-workspace off and no limit', () => {
  const { unlimitedFree } = helpers();
  assert.equal(unlimitedFree({ kind: 'free', once_per_workspace: false, limit_on: false }), true);
  assert.equal(unlimitedFree({ kind: 'free', once_per_workspace: true, limit_on: false }), false);
  assert.equal(unlimitedFree({ kind: 'free', once_per_workspace: false, limit_on: true }), false);
  assert.equal(unlimitedFree({ kind: 'percent', once_per_workspace: false, limit_on: false }), false);
});

test('shortCode: 3 to 7 characters after trim', () => {
  const { shortCode } = helpers();
  for (const [c, want] of [['', false], ['ab', false], ['abc', true], ['  abc ', true], ['ABCDEFG', true], ['ABCDEFGH', false], [null, false]]) assert.equal(shortCode(c), want, String(c));
});

test('view carries the question, the hint and the required toggles', () => {
  assert.ok(view.includes("title: 'Unlimited free months?'"));
  assert.ok(view.includes('Once per workspace is off and there is no total limit, so this free coupon could be used again and again. Save anyway?'));
  assert.ok(view.includes("confirmText: 'Save anyway', cancelText: 'Change it'"));
  assert.ok(view.includes('Short codes are easy to guess. Use 8 or more characters, or press Generate.'));
  assert.ok(view.includes("setReq(percentField, kind === 'percent'); setReq(amountField, kind === 'fixed');"));
});
