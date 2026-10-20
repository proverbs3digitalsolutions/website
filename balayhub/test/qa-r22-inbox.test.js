'use strict';

// QA r22 lane INBOX (INB-2): at 390 px the inbox search hint was cut. A short placeholder plus a full aria-label. Source scan, no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js'), 'utf8');

test('inbox search: short placeholder, full meaning kept in the label', () => {
  assert.match(src, /search: \{ placeholder: 'Guest or code', label: 'Search guest, listing or booking code' \}/);
  assert.doesNotMatch(src, /placeholder: 'Guest, listing or code'/);
});
