'use strict';
require('./helpers');

// QA r36 BOOK (GST-1, D-103, D-118): a guest count the place can't take is never priced. Typing it clears the old total and turns
// Continue off at once; the box's own message still comes on change. Frontend only: source scan.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/book.js'), 'utf8');
const m = /num_guests\?\.addEventListener\('input', \(\) => \{([\s\S]*?)\n  \}\);/.exec(src);

test('input handler: an out-of-range count drops the quote, turns Continue off and says why in the summary', () => {
  assert.ok(m, 'input listener on num_guests');
  const out = /if \(!guestCountInRange\(\)\) \{([\s\S]*?)\n    \}/.exec(m[1]);
  assert.ok(out, 'out-of-range branch is a block');
  const b = out[1];
  assert.match(b, /current = null/);
  assert.match(b, /submit\.disabled = true/);
  assert.match(b, /clearTimeout\(guestTyping\)/);
  assert.match(b, /summary\.replaceChildren/);
  assert.match(b, /This place allows up to \{n\} guests\./);
  assert.match(b, /Enter the number of guests to see the total\./);
  assert.match(b, /return;/);
  assert.doesNotMatch(b, /focus\(/);
});

test('both summary sentences have Taglish (book.js keeps one, i18n.js the other)', () => {
  const i18n = fs.readFileSync(path.join(__dirname, '../public/js/i18n.js'), 'utf8');
  assert.match(src, /'This place allows up to \{n\} guests\.': '/);
  assert.match(i18n, /'Enter the number of guests to see the total\.': '/);
});

test('valid counts still re-quote after 500 ms', () => {
  assert.match(m[1], /setTimeout\([^\n]*updateQuote\(\)[^\n]*500\)/);
});
