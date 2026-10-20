'use strict';
// QA r20 STR: a page drawn under a skeleton gets heading focus even if a redirect ends on the page it left. Source pin, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('app.js focuses the heading when no old page was kept', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  assert.match(src, /headingFocusDue\(\{ drawnPath, path, prevKept: Boolean\(prev\), redirected, addressChange \}\)\) focusPageHeading\(mount\)/);
  // Truth table of the decision helper, taken from the source line.
  const fn = new Function(`${src.match(/export const headingFocusDue = [^\n]+/)[0].replace('export ', '')}; return headingFocusDue;`)();
  assert.equal(fn({ drawnPath: null, path: '/a', prevKept: true, redirected: false }), true);
  assert.equal(fn({ drawnPath: '/b', path: '/a', prevKept: true, redirected: false }), true);
  assert.equal(fn({ drawnPath: '/a', path: '/a', prevKept: false, redirected: false }), true);
  assert.equal(fn({ drawnPath: '/a', path: '/a', prevKept: true, redirected: true }), true);
  assert.equal(fn({ drawnPath: '/a', path: '/a', prevKept: true, redirected: false }), false);
});
