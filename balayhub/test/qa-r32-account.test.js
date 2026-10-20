'use strict';
require('./helpers');

// Round 32 (ACCOUNT, INB-2, D-103): Notifications with "Only these properties" and none ticked says so and puts focus on the
// first property box, not on Save.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/account.js'), 'utf8');
const SENTENCE = 'Pick at least one property, or choose all properties.';
const submit = src.slice(src.indexOf('onsubmit: async (e) => {', src.indexOf("'Notifications'")), src.indexOf('save.disabled = true;'));

test('the no-property branch focuses the first property box before it returns', () => {
  const at = submit.indexOf(SENTENCE);
  assert.ok(at > -1, 'the sentence is there, exactly');
  const branch = submit.slice(at, submit.indexOf('return;', at) + 7);
  assert.match(branch, /propBoxes\[0\][^;]*\.focus\(\)/);
  assert.ok(branch.indexOf('.focus()') < branch.indexOf('return;'), 'focus before return');
});
