// QA r33 BKG-1: the deposit card's damage photo box is named by its visible label (label for + input id), not an aria-label.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/deposits.js'), 'utf8');
const start = src.indexOf("const upload = h('input'");
const block = src.slice(start, src.indexOf('if (!dep) {', start));

test('the file input has id deposit-photo-file and no aria-label', () => {
  assert.match(block, /id: 'deposit-photo-file'/);
  assert.doesNotMatch(block, /aria-label/);
});

test('the visible label points at the file input', () => {
  assert.match(src, /h\('label', \{[^}]*\bfor: 'deposit-photo-file'[^}]*\}, 'Damage \/ condition photos'\)/);
});

test('uploadField wrapping is unchanged', () => {
  assert.match(src, /const up = uploadField\(upload\);/);
  assert.match(src, /up\.wrap\)/);
});
