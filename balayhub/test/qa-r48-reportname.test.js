'use strict';
require('./helpers');

// Round 48 REPORTNAME (C6, D-130): the Stay reports page and the Reports page are named as the menu names them. Frontend only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public/js/views', f), 'utf8');
const stay = read('stayreports.js');
const rep = read('reports.js');

// Run the extracted expression with a stand-in state.
const titleFor = (src, re, type) => {
  const m = src.match(re);
  assert.ok(m, `expression not found: ${re}`);
  return new Function('state', `return ${m[1]};`)({ user: { business_type: type } });
};

test('stayreports: all three pageHead calls use pageTitle()', () => {
  assert.equal((stay.match(/pageHead\(\{ title: pageTitle\(\), sub: 'Short-term rentals'/g) || []).length, 3);
  assert.ok(!/pageHead\(\{ title: 'Reports'/.test(stay));
  assert.match(stay, /import \{ navigate, state \} from '\.\.\/app\.js';/);
});

test('stayreports: pageTitle by business type', () => {
  const re = /const pageTitle = \(\) => (\([^;]*\));/;
  assert.equal(titleFor(stay, re, 'both'), 'Stay reports');
  assert.equal(titleFor(stay, re, 'short_term'), 'Reports');
  assert.equal(titleFor(stay, re, 'long_term'), 'Reports');
});

test('reports: title by business type', () => {
  const re = /title: (state\.user\?\.business_type === 'both' \? 'Rental reports' : 'Reports'), sub:/;
  assert.equal(titleFor(rep, re, 'both'), 'Rental reports');
  assert.equal(titleFor(rep, re, 'short_term'), 'Reports');
  assert.equal(titleFor(rep, re, 'long_term'), 'Reports');
});
