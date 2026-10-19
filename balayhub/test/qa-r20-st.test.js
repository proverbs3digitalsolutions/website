'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/settings.js'), 'utf8');

test('both plan Pay requests send seen_paid_until from the page data', () => {
  assert.equal((src.match(/seen_paid_until: bill\.paid_until \?\? null/g) || []).length, 2);
  assert.match(src, /post\('\/billing\/checkout', \{[^\n]*seen_paid_until/);
  assert.match(src, /post\('\/billing\/pay-saved', \{[^\n]*seen_paid_until/);
});

test('PAYMENT_RECEIVED shows the server message as a focused alert and redraws', () => {
  assert.equal((src.match(/err\.code === 'PAYMENT_RECEIVED'\) \{ carriedNotice = err\.message; await refreshUser\(\); rerender\(\); return; \}/g) || []).length, 2);
  assert.match(src, /carriedNotice\) \{ billingNotice = h\('div', \{ class: 'alert alert--error', role: 'alert', tabindex: '-1' \}, carriedNotice\)/);
  assert.match(src, /if \(billingNotice\) focusWhenAttached\(el, billingNotice\)/);
});

test('pending hint and per-row card text', () => {
  assert.match(src, /role: 'note' \}, 'This cancels the payment waiting at your bank\.'/);
  const rowCard = new Function(`const cardText = (c) => \`\${c.brand ? c.brand[0].toUpperCase() + c.brand.slice(1) : 'Card'} ending \${c.last4}\`; ${src.match(/^const (rowCard = .*);$/m)[0]}; return rowCard;`)();
  assert.equal(rowCard({ card_brand: 'visa', card_last4: '0007' }), ' · Visa ending 0007');
  assert.equal(rowCard({ card_brand: null, card_last4: null }), '');
});
