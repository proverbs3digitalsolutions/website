'use strict';

// QA r25 CLEANERPAY (OPS-2): the Per clean / Per hour select in Add rate is labelled "Rate type", not "Paid". Frontend-only: source scan.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/cleanerpay.js'), 'utf8');

test('Add rate: the rate_type select is labelled "Rate type", options unchanged', () => {
  assert.match(src, /name:\s*'rate_type',\s*label:\s*'Rate type'/);
  assert.doesNotMatch(src, /name:\s*'rate_type',\s*label:\s*'Paid'/);
  assert.match(src, /options:\s*\[\['per_clean', 'Per clean'\], \['per_hour', 'Per hour'\]\]/);
});
