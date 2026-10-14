'use strict';
// QA round 3, lane C27 (N10): the Used/Restocked select on the Supplies used form is named
// "Used or restocked: <item name>", not just the item name, so a screen reader says what it controls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/housekeeping.js'), 'utf8');

test('the Used/Restocked select is named "Used or restocked: <item name>"', () => {
  assert.match(src, /h\('select', \{ class: 'input', 'aria-label': `\$\{T\('Used or restocked'\)\}: \$\{sp\.name\}` \}/);
});

test('the select is no longer labelled with the item name alone', () => {
  assert.doesNotMatch(src, /h\('select', \{ class: 'input', 'aria-label': sp\.name \}/);
});

test('the new label has a Taglish wording for cleaners', () => {
  assert.match(src, /'Used or restocked': 'Nagamit o nadagdag'/);
});
