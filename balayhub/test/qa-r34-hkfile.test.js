'use strict';
require('./helpers');

// QA round 34, HKFILE (GST-1, D-116). Every housekeeping file box is named by its own visible, linked label.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/housekeeping.js'), 'utf8');

test('no file input carries an aria-label', () => {
  const inputs = src.match(/h\('input',\s*\{[^}]*type: 'file'[^}]*\}/g) || [];
  assert.ok(inputs.length >= 2, 'file inputs found');
  for (const i of inputs) assert.ok(!i.includes('aria-label'), i);
});

test('photoField links its label to the input id; ids are unique per box', () => {
  assert.match(src, /id: `hk-photo-opt-\$\{\+\+photoSeq\}`/);
  assert.match(src, /h\('label', \{ for: input\.id \}, T\('Photo \(optional\)'\)\)/);
});

test('task page upload box has id hk-photo-file, a for label "Add photo", and keeps its focus key', () => {
  assert.match(src, /id: 'hk-photo-file'/);
  assert.match(src, /h\('label', \{ for: 'hk-photo-file' \}, T\('Add photo'\)\)/);
  assert.match(src, /'data-focus-key': 'hk-photo'/);
});
