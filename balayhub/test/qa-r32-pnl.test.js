'use strict';
require('./helpers');

// QA round 32, PNL (OPS-1, carry item 6): the profit-and-loss table is never a live region (D-114).
// Frontend only, no database: a source scan with comments stripped.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('pnl.js has no aria-live', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'pnl.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/aria-live/.test(src), 'the whole table must not sit in a live region');
});
