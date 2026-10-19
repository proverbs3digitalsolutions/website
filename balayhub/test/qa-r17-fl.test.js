'use strict';

// QA r17 lane FL: a number filter the box cannot hold is dropped from the filter and the address; Done returns focus to Filters.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../public/js/filters.js'), 'utf8');

test('number box that cannot hold the value resets the filter and drops the key from the address', () => {
  assert.match(src, /f\.type === 'number' && String\(values\[f\.name\] \?\? ''\) !== '' && input\.value === ''\) \{ values\[f\.name\] = defaults\[f\.name\] \?\? ''; dropFromAddress\(\[f\.name\]\); \}/);
  assert.ok(src.indexOf("input.value === ''") > src.indexOf("const input = h('input', { class: 'input', id, 'data-flt': f.name, type: f.type"));
});

test('Done closes the panel then focuses the Filters button', () => {
  assert.match(src, /onclick: \(\) => \{ toggle\(false\); moreBtn\.focus\(\); \} \}, 'Done'\)/);
});
