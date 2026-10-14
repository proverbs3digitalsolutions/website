'use strict';

// QA round 2, lane R2 owners cancel (owners view). Frontend source scan only: the view imports the app shell, which does not load in Node.
// Cancelling the "Pay more than the statement?" prompt must keep the payout form open with one clear message ("Payout not saved."),
// not the generic "Something went wrong" that makeForm shows for any error that is not an ApiError.
// node --test --test-concurrency=1 test/qa-r2-owners-view.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('cancelling the over-statement prompt says "Payout not saved." in the form (owners cancel)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/owners.js'), 'utf8');
  const submit = src.slice(src.indexOf('const recordPayout = () => formModal('), src.indexOf('const voidPayout = async'));
  assert.match(submit, /Pay more than the statement\?/);
  assert.doesNotMatch(submit, /throw new Error\(/);
  assert.match(submit, /throw new ApiError\('Payout not saved\.', \{ status: 400 \}\)/);
  assert.match(src, /import \{ get, post, patch, qs, ApiError \} from '\.\.\/api\.js';/);
});
