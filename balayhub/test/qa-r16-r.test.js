'use strict';
// QA round 16, lane R (#1): the Nights and Guests filters name the real limit (1 to 99). Frontend only, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/reservations.js'), 'utf8');

test('both number filters say the 1 to 99 sentence and not the old one', () => {
  assert.equal(src.split("patternText: 'Enter a number from 1 to 99.'").length - 1, 2);
  assert.ok(!src.includes("patternText: 'Enter a whole number, 1 or more.'"));
});
