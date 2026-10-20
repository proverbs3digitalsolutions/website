'use strict';

// QA r21 CPAY: the count beside "Select all unpaid" counts unpaid cleans only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/cleanerpay.js'), 'utf8');

test('the bar count reads unpaid cleans only, not every row shown', () => {
  const unpaidCount = new Function(`${src.match(/export const unpaidCount = [^\n]+/)[0].replace('export ', '')}; return unpaidCount;`)();
  assert.equal(unpaidCount(2), '2 unpaid');
  assert.equal(unpaidCount(0), 'Nothing unpaid');
  assert.ok(src.includes("unpaidCount(rows.filter((x) => x.pay_status === 'unpaid').length)"));
});
