'use strict';

// GST-3: the quote page uses the shared email rule and the one sentence
// "Enter a valid email address." (English and Taglish).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/quote.js'), 'utf8');

test('quote page uses the shared EMAIL_RE and the one email sentence', () => {
  assert.match(src, /import \{[^}]*\bEMAIL_RE\b[^}]*\} from '\.\.\/ui\.js'/);
  assert.match(src, /EMAIL_RE\.test\(/);
  assert.ok(!src.includes('Please enter a valid email address.'));
  assert.match(src, /problems\.email = t\('Enter a valid email address\.'\)/);
});

test('Taglish text for the email sentence is unchanged', () => {
  assert.match(src, /'Enter a valid email address\.': 'Maglagay ng tamang email address\.'/);
});
