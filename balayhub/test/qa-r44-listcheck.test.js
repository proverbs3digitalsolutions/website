'use strict';

require('./helpers');

// QA round 44, lane LISTCHECK (ONB44-1, D-105, D-126): the listing form's rate and discount-order checks run in the
// form's one pass, so one save shows every problem the device can see (the required boxes and these two together).
// listings.js imports the signed-in user from app.js, so the functions are read from the file text and run here, as
// qa-r6-c04 does. The server still refuses the same values (the onSubmit lines stay as backstops).
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_44_listcheck DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_44_listcheck node --test --test-concurrency=1 test/qa-r44-listcheck.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const UI = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ui.js'), 'utf8');
const LISTINGS_FILE = process.env.R44_LISTINGS_FILE || path.join(__dirname, '..', 'public', 'js', 'views', 'listings.js');
const LISTINGS = fs.readFileSync(LISTINGS_FILE, 'utf8');

// The source of one top-level function, from its first line to its closing brace (no braces inside strings here).
function fnSource(text, name) {
  const start = text.search(new RegExp(`^(export )?function ${name}\\(`, 'm'));
  if (start < 0) throw new Error(`${name} is not in listings.js`);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1).replace(/^export /, '');
    }
  }
  throw new Error(`${name} has no closing brace`);
}

// Runs the real listing checks against the stand-in ApiError the form would throw (its fields ride on err.fields).
function load() {
  class ApiError extends Error {
    constructor(message, { status = 0, fields } = {}) { super(message); this.status = status; this.fields = fields; }
  }
  const source = [
    ...UI.match(/^const MONEY_(COMMA_)?RE = .*$/gm),
    fnSource(UI, 'parseAmount'),
    LISTINGS.match(/^const DISCOUNT_ORDER = .*$/m)[0],
    fnSource(LISTINGS, 'checkDiscountOrder'),
    fnSource(LISTINGS, 'baseRateError'),
    fnSource(LISTINGS, 'listingCheck'),
    'return { listingCheck, baseRateError };',
  ].join('\n');
  return new Function('ApiError', source)(ApiError);
}

const ORDER_SENTENCE = "The monthly discount (5%) can't be smaller than the weekly discount (10%). Longer stays get the same or a bigger discount.";

test('a rate of zero and a monthly discount below the weekly one are both reported in one pass', () => {
  const { listingCheck } = load();
  assert.deepEqual(listingCheck({ nightly_rate: '0', weekly_discount: '10', monthly_discount: '5' }), {
    nightly_rate: 'Nightly rate must be greater than zero.',
    monthly_discount: ORDER_SENTENCE,
  });
});

test('a blank rate is left to the required-field check, and the discount order still shows', () => {
  const { listingCheck } = load();
  assert.deepEqual(listingCheck({ nightly_rate: '', weekly_discount: '10', monthly_discount: '5' }), { monthly_discount: ORDER_SENTENCE });
});

test('a rate that is not an amount gets the same sentence the form gives it on the save', () => {
  const { listingCheck } = load();
  assert.deepEqual(listingCheck({ nightly_rate: 'abc' }), { nightly_rate: 'Nightly rate must be a valid amount (e.g. 8500 or 8500.50).' });
});

test('good values give no message, so the save goes on to the questions and the server', () => {
  const { listingCheck } = load();
  assert.equal(listingCheck({ nightly_rate: '8500', weekly_discount: '5', fortnight_discount: '10', monthly_discount: '15' }), null);
  assert.equal(listingCheck({ nightly_rate: '8,500.50' }), null);
  assert.equal(listingCheck({ weekly_discount: '', monthly_discount: '' }), null);
});

test('both listing forms run listingCheck in their one pass, and the save-time checks stay as backstops', () => {
  assert.equal(LISTINGS.match(/check: listingCheck,/g)?.length, 2, 'the add and the edit form both check in the one pass');
  assert.doesNotMatch(LISTINGS, /check: \(d\) => \(String\(d\.nightly_rate/, 'the old rate-only check is gone from both forms');
  assert.equal(LISTINGS.match(/checkBaseRate\(d\);/g)?.length, 2, 'the add and the edit onSubmit keep the rate backstop');
  assert.equal(LISTINGS.match(/checkDiscountOrder\(d\);/g)?.length, 3, 'two onSubmit backstops and the one inside listingCheck');
});
