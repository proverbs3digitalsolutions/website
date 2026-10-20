'use strict';

// QA round 26, GST-1: the check-in house-rules sentence is the booking page's sentence, in English and Taglish.
// The name (as on your ID) and building-registration consent sentences stay different on purpose.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/checkin.js'), 'utf8');
const book = fs.readFileSync(path.join(__dirname, '../public/js/views/book.js'), 'utf8');
const KEY = 'Please read and agree to the house rules.';

test('check-in uses the booking page house-rules sentence', () => {
  assert.ok(src.includes(`problems.accept_rules = t('${KEY}')`));
  assert.ok(!src.includes('Please accept the house rules to continue.'));
});

test('the Tagalog equals the booking page Tagalog', () => {
  const re = /'Please read and agree to the house rules\.': '([^']+)'/;
  const a = src.match(re), b = book.match(re);
  assert.ok(a && b, 'both dictionaries carry the key');
  assert.equal(a[1], b[1]);
});

test('name and consent sentences are unchanged', () => {
  assert.ok(src.includes('Please agree so your host can register you with the building.'));
  assert.ok(src.includes('Please enter your full name, as on your ID.'));
});
