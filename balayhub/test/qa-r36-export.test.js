'use strict';
require('./helpers');

// QA round 36 MNY-1 (D-118): Stay reports, a typed date outside 2000 to 2100 is refused on screen,
// so Download CSV must not keep the last good range. Source scans of the view.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/stayreports.js'), 'utf8');

test('the refused-date branch turns the export off before it returns', () => {
  const m = /if \(outOfWindow\(e\.target\.value\)\) \{([^\n]*)\}/.exec(src);
  assert.ok(m, 'branch exists');
  const body = m[1];
  const off = body.indexOf("exportReady(false, 'Fix the dates to export.')");
  assert.ok(off > body.indexOf('status.textContent'), 'exportReady(false, ...) after the status line');
  assert.ok(off < body.indexOf('return;'), 'and before return');
});

test('load() keeps the export off while a typed date is refused', () => {
  assert.ok(src.includes('const refused = Object.keys(typed).length > 0;'));
  assert.match(src, /const exportOk = !refused && \(filters\.period !== 'range' \|\| Boolean\(filters\.from && filters\.to && !backwards && !tooLong\)\);/);
  assert.ok(src.includes("refused ? 'Fix the dates to export.' : tooLong ? 'Choose up to two years to export.' : exportHint("));
});
