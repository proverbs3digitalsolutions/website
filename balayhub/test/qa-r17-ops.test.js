'use strict';

// QA r17 OPS: maintenance status buttons have one focus key per target status (#35); the cleaner pay row box sits in a label tap target (#34).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public/js/views', f), 'utf8');

test('#35 maintenance status buttons use a per-target focus key', () => {
  const src = read('maintenance.js');
  assert.ok(src.includes("'data-focus-key': `mt-status-${s}`"));
  assert.ok(!src.includes("'data-focus-key': 'mt-status'"));
});

test('#34 the cleaner pay row box is wrapped in the ops-check__tap label', () => {
  const src = read('cleanerpay.js');
  assert.match(src, /h\('td', \{ class: 'ops-check' \}, h\('label', \{ class: 'ops-check__tap' \}, box1\)\)/);
  assert.ok(src.includes("'aria-label': `Select ${unitOf(x)}"), 'box keeps its aria-label');
});
