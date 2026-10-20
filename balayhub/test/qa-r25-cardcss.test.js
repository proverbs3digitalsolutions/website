'use strict';
// QA R25 CARDCSS: D-107 - no focus ring on the h2 the app focuses; the real alert keeps its ring.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'cardcheck.css'), 'utf8');

test('cardcheck.css gives no focus outline to the focused headings', () => {
  assert.ok(!/\.cc-success h2:focus/.test(css), 'cc-success h2:focus must be gone');
  assert.ok(!/\.cc-wait h2:focus/.test(css), 'cc-wait h2:focus must be gone');
});

test('cardcheck.css keeps the focus ring on the form alert', () => {
  assert.match(css, /\.cc-form \.alert:focus\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\)/);
});
