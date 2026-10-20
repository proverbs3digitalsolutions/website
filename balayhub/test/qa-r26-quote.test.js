'use strict';

// GST-1 (D-108): the quote page says the consent rule with the booking page's one sentence,
// "Please agree to continue.", and shows it in Taglish through the shared dictionary.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/quote.js'), 'utf8');
const book = fs.readFileSync(path.join(__dirname, '../public/js/views/book.js'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, '../public/js/i18n.js'), 'utf8');

test('quote consent uses the one booking sentence through tServer', () => {
  assert.match(src, /problems\.consent = tServer\('Please agree to continue\.'\)/);
  assert.ok(!src.includes('Please tick this box to continue.'));
  assert.match(book, /errors\.consent = tServer\('Please agree to continue\.'\)/);
});

test('Taglish for that sentence comes from the shared dictionary, same as booking', () => {
  assert.match(i18n, /\^Please agree to continue\\\.\$\/, \(\) => 'Paki-agree para makatuloy\.'/);
});

test('quote name and mobile sentences stay', () => {
  assert.match(src, /problems\.name = t\('Please enter your full name\.'\)/);
  assert.match(src, /problems\.phone = t\('Please enter your mobile number\.'\)/);
});
