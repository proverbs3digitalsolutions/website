'use strict';
require('./helpers');

// QA round 36, CALENDAR (BKG-1). The price dialog says every rule in one press: the order of the nights,
// one year at most, and a price of 0 (the same sentences as src/routes/stays.js). Frontend only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/calendar.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../src/routes/stays.js'), 'utf8');
const body = src.slice(src.indexOf('function priceModal('), src.indexOf('async function blockMenu('));
const ORDER = 'Must be on or after the start date.';
const YEAR = 'Up to one year at a time.';
const ZERO = 'Price must be greater than zero. Leave it blank to use your usual price.';

function loadCheck() {
  const span = body.match(/const nightsSpan = [^\n]*?;(?= \/\/)/);
  assert.ok(span, 'nightsSpan is defined in priceModal');
  const m = body.match(/check: \(d\) => \{[\s\S]*?\n {4}\},\n/) || body.match(/check: \(d\) => \{[\s\S]*?\n {6}\},\n/) || body.match(/check: \(d\) => \{[\s\S]*?\n\s*\},\n/);
  assert.ok(m, 'priceModal passes a check to formModal');
  return new Function(`${span[0]}; return (${m[0].replace(/^check: /, '').replace(/,\n$/, '')});`)();
}

test('check: order, one year and price 0 in the same press', () => {
  const c = loadCheck();
  assert.deepEqual(c({ start_date: '2026-10-21', end_date: '2026-10-19', price: '0' }), { end_date: ORDER, price: ZERO });
  assert.deepEqual(c({ start_date: '2026-10-21', end_date: '2027-11-01', price: '' }), { end_date: YEAR });
  assert.equal(c({ start_date: '2026-10-21', end_date: '2027-10-22', price: '' }), null);
  assert.equal(c({ start_date: '2026-10-21', end_date: '2026-10-21', price: '' }), null);
  assert.equal(c({ start_date: '2026-10-21', end_date: '2026-10-21', price: '2950' }), null);
});

test('onSubmit no longer throws for price 0; the sentences match the server', () => {
  const onSubmit = body.slice(body.indexOf('onSubmit:'));
  assert.ok(!onSubmit.includes('ApiError'), 'no price-0 throw left in onSubmit');
  for (const s of [ORDER, YEAR]) assert.ok(server.includes(s), s);
  assert.ok(body.includes(ZERO));
});
