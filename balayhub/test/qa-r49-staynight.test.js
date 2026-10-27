'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// stayreports.js needs the browser shell, so run the two template literals pulled out of the source.
const src = fs.readFileSync(path.join(__dirname, '../public/js/views/stayreports.js'), 'utf8');
const grab = (re) => {
  const m = src.match(re);
  assert.ok(m, `template not found: ${re}`);
  return new Function('t', `return \`${m[1]}\`;`);
};
const revenue = grab(/`(\$\{t\.stays\} check-in[^`]*)`/);
const average = grab(/`(Average stay .*\$\{t\.cancelled \? ` · \$\{t\.cancelled\} cancelled` : ''\}\.)`/);

test('one night: "1 night", never "1 nights"', () => {
  const t = { stays: 1, nights: 1, avg_stay: 1, cancelled: 0 };
  assert.equal(revenue(t), '1 check-in · 1 night');
  assert.equal(average(t), 'Average stay 1 night (whole stays, check-ins in this period).');
});

test('several nights and a decimal average stay stay plural', () => {
  const t = { stays: 2, nights: 5, avg_stay: 2.5, cancelled: 2 };
  assert.equal(revenue(t), '2 check-ins · 5 nights');
  assert.equal(average(t), 'Average stay 2.5 nights (whole stays, check-ins in this period) · 2 cancelled.');
  assert.equal(average({ stays: 1, nights: 1, avg_stay: '1.0', cancelled: 0 }), 'Average stay 1.0 night (whole stays, check-ins in this period).');
  assert.equal(average({ stays: 1, nights: 1, avg_stay: 1.5, cancelled: 0 }), 'Average stay 1.5 nights (whole stays, check-ins in this period).');
});
