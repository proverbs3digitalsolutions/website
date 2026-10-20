// Round 25 SUPPLIES: short message labels so form problems read as sentences (OPS-1).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/supplies.js'), 'utf8');

test('supplies fields give a short msgLabel', () => {
  assert.match(src, /name: 'par_level'[^\n]*msgLabel: 'Low-stock level'/);
  assert.match(src, /name: 'on_hand'[^\n]*msgLabel: 'On hand'/);
  assert.match(src, /name: 'quantity'[^\n]*msgLabel: 'Quantity'/);
});

test('visible labels are unchanged', () => {
  assert.match(src, /label: 'Keep at least'/);
  assert.match(src, /label: 'On hand now'/);
  assert.match(src, /How many \$\{s\.unit_label\}\?/);
});
