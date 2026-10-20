require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// QA r33 HKP-R: Set pay / Edit pay redraw after the dialog has closed, so focus goes back to the button (D-115).
const src = fs.readFileSync(path.join(__dirname, '../public/js/views/housekeeping.js'), 'utf8');
const payModal = src.slice(src.indexOf('function payModal('), src.indexOf('\nfunction ', src.indexOf('function payModal(') + 1));
const code = payModal.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('payModal redraws on a timer after the dialog closes, never directly', () => {
  assert.match(code, /toast\('Pay saved\.'\); setTimeout\(onSaved\);/);
  assert.doesNotMatch(code, /onSaved\(\)/);
});

test('the Set pay / Edit pay button keeps its hk-pay focus key', () => {
  assert.match(src, /'data-focus-key': 'hk-pay', onclick: \(\) => payModal\(t, rerender\)/);
});
