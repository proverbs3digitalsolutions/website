'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/housekeeping.js'), 'utf8');
const block = src.slice(src.indexOf('let uploading'), src.indexOf('const actionBtn'));

test('Add photo input carries a focus key so the redraw can put focus back on its replacement', () => {
  assert.match(block, /'data-focus-key': 'hk-photo'/);
});

test('Add photo is never disabled (a disabled control drops focus to the body); a busy flag blocks a second pick', () => {
  assert.doesNotMatch(block, /\.disabled\s*=/);
  assert.match(block, /let uploading = false/);
  assert.match(block, /'aria-disabled'/);
  assert.match(block, /preventDefault\(\)/);
  assert.match(block, /if \(uploading \|\| /);
});
