'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/landing.js'), 'utf8');

test('landing says the card check honestly (D-98), English and Taglish', () => {
  assert.ok(src.includes("'₱20 card check, then 14 days free. Works on your phone. English or Tagalog.'"));
  assert.ok(src.includes("'₱20 card check, tapos 14 araw na libre. Gumagana sa phone. English o Tagalog.'"));
  assert.ok(!/No credit card needed/i.test(src));
  assert.ok(!/Walang credit card/i.test(src));
});
