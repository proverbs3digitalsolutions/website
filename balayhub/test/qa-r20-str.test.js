'use strict';
// QA r20 STR: a page drawn under a skeleton gets heading focus even if a redirect ends on the page it left. Source pin, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('app.js focuses the heading when no old page was kept', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  assert.match(src, /drawnPath !== null && \(!prev \|\| drawnPath !== path\)\) focusPageHeading\(mount\)/);
});
