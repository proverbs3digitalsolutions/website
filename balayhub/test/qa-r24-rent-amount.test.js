'use strict';

// QA r24 RENT-AMOUNT (D-106): an amount the app filled is a suggestion; only what the person typed is theirs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
test('rent.js: tenant change replaces only app-filled amounts', async () => {
  const src = fs.readFileSync(path.join(JS, 'views/rent.js'), 'utf8');
  assert.match(src, /nextSuggestedAmount/);
  const m = src.match(/export function nextSuggestedAmount[\s\S]*?\n}\n/);
  assert.ok(m, 'helper exported');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r24ra-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'h.js'), m[0]);
  const { nextSuggestedAmount: n } = await import(pathToFileURL(path.join(dir, 'h.js')));
  assert.equal(n('', '', '18000.00'), '18000.00');           // blank: fill
  assert.equal(n('12000.00', '12000.00', '18000.00'), '18000.00'); // app-filled: replace
  assert.equal(n('12000.00', '12000.00', '0.00'), '');       // new tenant owes nothing: clear
  assert.equal(n('12000.00', '12000.00', undefined), '');    // missing: clear
  assert.equal(n('500', '12000.00', '18000.00'), null);      // typed: keep
  assert.equal(n('500', '', '18000.00'), null);              // typed with nothing filled: keep
  assert.equal(n('  ', '', '100.00'), '100.00');
});

test('rent.js: wiring remembers the initial suggestion and each fill', () => {
  const src = fs.readFileSync(path.join(JS, 'views/rent.js'), 'utf8');
  assert.match(src, /let filled = ''/);
  assert.match(src, /nextSuggestedAmount\(amt\.value, filled, l\?\.outstanding\)/);
  assert.match(src, /filled = amountField\.querySelector\('input'\)\.value/);
});
