'use strict';
require('./helpers');

// QA round 32, RESERVATIONS (BKG-1, D-114). The unit-mode price line is the rates' price, so it says so;
// the Accommodation total box is what saves. Source scan of refreshQuote; frontend-only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raw = fs.readFileSync(path.join(__dirname, '../public/js/views/reservations.js'), 'utf8');
const src = raw.replace(/^\s*\/\/.*$/gm, '');

test('unit-mode price line starts "From your rates: "', () => {
  assert.match(src, /: `From your rates: \$\{nights\} night\$\{nights > 1 \? 's' : ''\} · \$\{peso\(q\.accommodation_total\)\} for the stay/);
});

test('missing-rates sentence and type-mode guide are unchanged', () => {
  assert.ok(src.includes("This listing has no nightly rate for some nights — enter the total yourself."));
  assert.ok(src.includes("Each room is priced from the listing BalayHub picks; leave the boxes empty to use that price."));
  assert.ok(src.includes("typeMode() && !q.missing_rates ? `${nights} night${nights > 1 ? 's' : ''}.${guide}`"));
});

test('offerNow is called only from change and applyQuote', () => {
  const calls = src.split('\n').filter((l) => /offerNow\(\)/.test(l) && !/const offerNow/.test(l));
  assert.equal(calls.length, 3); // applyQuote, the "Use ₱X" click, the change listener
  assert.ok(calls.some((l) => /addEventListener\('change'/.test(l)));
  assert.ok(!/addEventListener\('input'[^\n]*offerNow/.test(src));
});

test('the rates-price comment is present', () => {
  assert.ok(raw.includes('// The line is the rates\' price; the Accommodation total box is what saves, and "Use ₱X from your rates" offers the difference (D-114).'));
});
