'use strict';

// R27 COPY27: an empty email on the quote page says the booking page's missing-field sentence; a malformed one keeps its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/quote.js'), 'utf8');
const book = fs.readFileSync(path.join(__dirname, '../public/js/views/book.js'), 'utf8');

test('empty email uses the booking sentence through tServer', () => {
  assert.match(book, /if \(!email\) errors\.email = tServer\('Email is required\.'\)/);
  assert.match(src, /if \(!String\(v\.email \|\| ''\)\.trim\(\)\) problems\.email = tServer\('Email is required\.'\)/);
});

test('malformed email keeps its own sentence', () => {
  assert.match(src, /else if \(!EMAIL_RE\.test\(String\(v\.email\)\.trim\(\)\)\) problems\.email = t\('Enter a valid email address\.'\)/);
});

test('Tagalog for the missing-email sentence comes from the shared "(.+) is required." rule and the page knows "Email"', () => {
  const i18n = fs.readFileSync(path.join(__dirname, '../public/js/i18n.js'), 'utf8');
  assert.match(i18n, /is required\\\.\$\//);
  assert.match(src, /'Email': 'Email'/);
});
