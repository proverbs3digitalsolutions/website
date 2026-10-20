'use strict';
require('./helpers');

// QA r32 OPS-1 (D-114): the Lost and found list is never a live region.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('lostfound.js has no aria-live', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/lostfound.js'), 'utf8');
  assert.ok(!/aria-live/.test(src));
});
