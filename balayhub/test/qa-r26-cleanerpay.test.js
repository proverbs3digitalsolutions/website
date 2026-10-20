'use strict';

// QA r26 CLEANERPAY (OPS-1): managers can't see or add rates, so their copy says "ask the owner". Frontend-only: source scan.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/cleanerpay.js'), 'utf8');

test('no-rate text: owners keep "Add a rate or pick", others are told to ask the owner', () => {
  assert.match(src, /const noPayText = \(x, owner\)/);
  assert.match(src, /noPayText\(x, isOwner\)/);
  assert.ok(src.includes('No rate for this name. Add a rate or pick the team member.'));
  assert.ok(src.includes('No rate for this name. Ask the owner to add a rate.'));
});

test('empty state: "Check the rates below" is owner-only', () => {
  const owner = 'Pay shows up here once a cleaner marks a clean as done. Check the rates below if amounts are missing.';
  const other = 'Pay shows up here once a cleaner marks a clean as done.';
  assert.ok(src.includes(owner));
  assert.match(src, /isOwner \? '[^']*Check the rates below[^']*' : '[^']*done\.'/);
  assert.ok(src.includes(other));
});
