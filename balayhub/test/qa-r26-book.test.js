'use strict';

// QA r26 BOOK (GST-1): blank full name and blank mobile on the booking form read like the quote page, in English and Taglish. Source scan, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/views/book.js'), 'utf8');
const QUOTE = fs.readFileSync(path.join(__dirname, '../public/js/views/quote.js'), 'utf8');

function tagalog(src, key) {
  const m = src.match(new RegExp("'" + key.replace(/[.]/g, '\\.') + "': '([^']+)'"));
  return m && m[1];
}

for (const key of ['Please enter your full name.', 'Please enter your mobile number.']) {
  test('booking form uses "' + key + '" for the blank rule', () => {
    assert.ok(SRC.includes("t('" + key + "')"), 'validation uses t() with the shared sentence');
    assert.ok(tagalog(SRC, key), 'has a Tagalog entry');
    assert.equal(tagalog(SRC, key), tagalog(QUOTE, key), 'same Tagalog as the quote page');
  });
}

test('old booking wording is gone from the blank checks', () => {
  assert.ok(!SRC.includes("tServer('Full name is required.')"));
  assert.ok(!SRC.includes("tServer('Mobile number is required.')"));
  assert.ok(SRC.includes("tServer('Enter a valid phone number.')"), 'shape message unchanged');
});
