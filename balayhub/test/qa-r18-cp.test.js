'use strict';

// QA r18 CP: cleaner pay "How you paid" has no default method and must be chosen (D-92 O4). The server already requires method.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/cleanerpay.js'), 'utf8');
const line = src.split('\n').find((l) => l.includes("name: 'method'"));

test('Mark paid method starts on Choose… with no cash default', () => {
  assert.ok(line, 'method field present');
  assert.ok(!line.includes("value: 'cash'"));
  assert.ok(line.includes("placeholderOption: 'Choose…'"));
});

test('Mark paid asks for the method before saving', () => {
  assert.ok(src.includes("{ method: 'Choose how you paid the cleaner.' }"));
});
