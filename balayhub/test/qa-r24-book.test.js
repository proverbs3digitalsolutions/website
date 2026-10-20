'use strict';

// QA r24 BOOK (GST-1, N-8): the Guests box clears its message as a valid count is typed, and the box limit matches the check (50 when none).
// Frontend-only source scan: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/book.js'), 'utf8');

test('N-8: the Guests box limit is the listing maximum or 50, never 20', () => {
  assert.match(src, /name: 'num_guests'[^\n]*max: l\.max_guests \|\| 50/);
  assert.doesNotMatch(src, /max_guests \|\| 20/);
});

test('GST-1: an input listener on Guests clears the message for a valid count and re-quotes after 500 ms', () => {
  const m = /num_guests\?\.addEventListener\('input', \(\) => \{([\s\S]*?)\n  \}\);/.exec(src);
  assert.ok(m, 'input listener on num_guests');
  const body = m[1];
  assert.match(body, /guestsFromServer = false/);
  assert.match(body, /setGuestsError\(''\)/);
  assert.match(body, /500/);
  assert.match(body, /updateQuote\(\)/);
  assert.doesNotMatch(body, /focus\(/);
  // an invalid count sets no message while typing
  assert.doesNotMatch(body, /guestCountMsg/);
});

test('GST-1: the valid check is a whole number from 1 to the maximum (50 when none)', () => {
  assert.match(src, /guestCountInRange[\s\S]{0,200}l\.max_guests \|\| 50/);
});
