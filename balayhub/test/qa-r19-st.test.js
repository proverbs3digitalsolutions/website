'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// settings.js needs the browser shell, so pull the pure helper out of the source.
const src = fs.readFileSync(path.join(__dirname, '../public/js/views/settings.js'), 'utf8');
const payDefaultPlan = new Function(`${src.match(/^export (const payDefaultPlan = .*);$/m)[1]}; return payDefaultPlan;`)();
const bill = { options: [{ key: 'starter' }, { key: 'growth' }, { key: 'pro' }] };

test('pay picker default: renewal plan, else current paid plan, else growth', () => {
  assert.equal(payDefaultPlan({ plan: 'starter' }, { ...bill, renewal_plan: 'pro' }), 'pro');
  assert.equal(payDefaultPlan({ plan: 'starter' }, bill), 'starter');
  assert.equal(payDefaultPlan({ plan: 'trial' }, bill), 'growth');
});

test('no saved card, no saved-card pay button; failed return shows the alert', () => {
  assert.match(src, /const savedBtn = saved && !pending \? h\(/);
  assert.match(src, /r\.status === 'failed'[^\n]*role: 'alert'/);
});

test('a payment waiting at the bank: sentence, no saved-card pay button, no coupon box', () => {
  const pendingText = new Function(`${src.match(/^export (const pendingText = [\s\S]*?\));$/m)[1]}; return pendingText;`)();
  const money = (v) => `₱${v}`;
  assert.equal(pendingText({ amount: '499.50', minutes_left: 12 }, money), 'A payment of ₱499.50 is waiting for your bank. Finish it in the bank window, or try again in 12 minutes.');
  assert.equal(pendingText({ amount: '499.50', minutes_left: 0 }, money), 'A payment of ₱499.50 is still waiting for your bank. Pay another way, or try again later.');
  assert.match(src, /const savedBtn = saved && !pending \?/);
  assert.match(src, /!pending && box,/);
  assert.match(src, /role: 'status' \}, pendingText\(pending/);
});
