'use strict';
require('./helpers');

// QA round 35 MNY-1 (D-117): Stay reports, Custom dates over two years: Download CSV is disabled with a reason,
// because the export would answer 400 and download nothing. The limit mirrors src/routes/stayreports.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/stayreports.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../src/routes/stayreports.js'), 'utf8');

function loadSpanDays() {
  const m = src.match(/const spanDays = [^\n]*\n/);
  assert.ok(m, 'spanDays exists');
  return new Function(`${m[0]}; return spanDays;`)();
}

test('spanDays: two years is allowed, longer is over the limit', () => {
  const s = loadSpanDays();
  assert.equal(s('2026-10-01', '2028-10-01'), 731);
  assert.ok(s('2026-10-01', '2030-06-01') > 731);
});

test('the page limit is the server limit', () => {
  const n = /daysBetween\(q\.from, q\.to\) > (\d+)/.exec(server)[1];
  assert.ok(src.includes(`spanDays(filters.from, filters.to) > ${n}`));
});

test('exportOk includes !tooLong and the hint sentence is exact', () => {
  assert.match(src, /const exportOk = filters\.period !== 'range' \|\| Boolean\(filters\.from && filters\.to && !backwards && !tooLong\);/);
  assert.ok(src.includes("tooLong ? 'Choose up to two years to export.' : exportHint("));
});
