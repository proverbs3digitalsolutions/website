'use strict';
// MNY-4: the discount code toggle cell carries cell-action so CSS can centre its button on the row's first line.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/guestcare.js'), 'utf8');

test('the discount code toggle td has class cell-action', () => {
  assert.match(src, /h\('td', \{ class: 'cell-action' \}, canManage && h\('button'/);
});
