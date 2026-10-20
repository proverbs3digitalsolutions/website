// R24 REV: the Reports > Performance Revenue card detail is three short lines on a phone;
// the counting note sits once under the cards, not inside the Revenue card.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/stayreports.js'), 'utf8');
const revenueCall = src.split('\n').find((l) => l.includes("stat('Revenue', peso(t.revenue)")) || '';

test('Revenue card detail is three short lines with the same numbers', () => {
  assert.match(revenueCall, /\$\{t\.stays\} stay\$\{t\.stays === 1 \? '' : 's'\} · \$\{t\.nights\} nights/);
  assert.match(revenueCall, /Rooms \$\{peso\(t\.accommodation\)\}/);
  assert.match(revenueCall, /Cleaning and extras \$\{peso\(t\.fees\)\}/);
  assert.equal((revenueCall.match(/h\('br'\)/g) || []).length, 2, 'exactly three lines');
  assert.doesNotMatch(revenueCall, /counted by night/, 'the counting note is not inside the card');
});

test('the counting note appears once, as a footnote under the cards', () => {
  assert.equal((src.match(/Rooms counted by night; cleaning and extras by check-in\./g) || []).length, 1);
  assert.match(src, /h\('p', \{ class: 'muted small' \}, 'Rooms counted by night; cleaning and extras by check-in\.'\)/);
});
