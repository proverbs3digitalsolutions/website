'use strict';

// QA round 2, lane R2 owners cancel (owners view). Frontend source scan only: the view imports the app shell, which does not load in Node.
// Cancelling the "Pay more than the statement?" prompt closes it quietly (D-84): onSubmit returns false, so makeForm keeps the payout form open with no message.
// node --test --test-concurrency=1 test/qa-r2-owners-view.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('cancelling the over-statement prompt returns false with no error (owners cancel, D-84)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/owners.js'), 'utf8');
  const submit = src.slice(src.indexOf('const recordPayout = () => formModal('), src.indexOf('const voidPayout = async'));
  assert.match(submit, /Pay more than the statement\?/);
  assert.doesNotMatch(submit, /throw new Error\(/);
  assert.doesNotMatch(submit, /throw new ApiError\(/);
  assert.match(submit, /title: 'Pay more than the statement\?'[^\n]*\)\) return false;/);
  assert.match(src, /import \{ get, post, patch, qs \} from '\.\.\/api\.js';/);
});
