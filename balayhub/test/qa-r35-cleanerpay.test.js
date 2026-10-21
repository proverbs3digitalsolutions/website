'use strict';
require('./helpers');

// Round 35 (CLEANERPAY, OPS-1, D-117): the bulk Mark paid button keeps one focus key and is aria-disabled, never disabled,
// so after the save the focus guard can return focus to it even though its name changed and nothing is ticked.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/cleanerpay.js'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '');

const line = (re) => src.split('\n').find((l) => re.test(l)) || '';

test('bulk Mark paid button: one focus key, aria-disabled when nothing is ticked, no disabled key', () => {
  const l = line(/const markBtn = h\('button'/);
  assert.ok(l, 'markBtn line exists');
  assert.match(l, /'data-focus-key': 'cp-mark'/);
  assert.match(l, /'aria-disabled': selected\.size \? null : 'true'/);
  assert.doesNotMatch(l, /disabled: !selected/);
});

test('refresh toggles aria-disabled and never .disabled on the bulk button', () => {
  assert.doesNotMatch(src, /markBtn\.disabled/);
  assert.match(src, /markBtn\.removeAttribute\('aria-disabled'\)/);
  assert.match(src, /markBtn\.setAttribute\('aria-disabled', 'true'\)/);
});

test('markPaid still starts with the empty-rows return', () => {
  assert.match(src, /function markPaid\(\) \{\s*const rows = ticked\(\);\s*if \(!rows\.length\) return;/);
});
