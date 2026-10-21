'use strict';
require('./helpers');

// R34 PAYFILE: the guest's file box on a proof waiting for its screenshot is named by a visible linked label (D-116), not an aria-label.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_34_payfile node --test --test-concurrency=1 test/qa-r34-payfile.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/pay.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
const start = src.indexOf('if (!p.has_file) {');
const block = src.slice(start, src.indexOf('return row;', start));

test('the pending-proof file box has an id carrying the proof and no aria-label', () => {
  assert.ok(start > 0 && block.length > 100);
  const input = block.match(/const file = h\('input'[^\n]*/)[0];
  assert.match(input, /id: `proof-add-\$\{p\.proof_id\}`/);
  assert.doesNotMatch(input, /aria-label/);
});

test('a visible label is linked to it with the same name', () => {
  assert.match(block, /h\('label', \{ for: `proof-add-\$\{p\.proof_id\}` \}, t\('Screenshot or receipt'\)\)/);
});
