'use strict';

// QA r23 lane REPORTS (MNY-4): only the Performance headline row carries the phone-stacking modifier class
// (the CSS rule .stats--stack-phone is owned by the shell lane). Source scan, no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/stayreports.js'), 'utf8');

test('Performance headline row stacks on phones', () => {
  assert.match(src, /class: 'grid grid--4 stats stats--stack-phone'/);
  assert.equal(src.split('stats--stack-phone').length - 1, 1, 'only one row carries the modifier');
});
