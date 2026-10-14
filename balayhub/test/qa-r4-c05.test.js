'use strict';

// QA round 4, lane C05 (calendar view).
// calendar#1: the Set nightly price box starts empty. A pre-filled price was saved for every night in the range.
// The hint says what the night costs now and where it comes from, and a blank Save reports the server's `cleared` count.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CALENDAR_JS = path.join(__dirname, '..', 'public', 'js', 'views', 'calendar.js');
const source = fs.readFileSync(CALENDAR_JS, 'utf8');

// The text of one function in calendar.js, from its declaration up to the next named function.
function functionBody(declaration, next) {
  const start = source.indexOf(declaration);
  assert.ok(start > -1, `${declaration} is in calendar.js`);
  const end = source.indexOf(next, start);
  assert.ok(end > start, `${next} follows ${declaration}`);
  return source.slice(start, end);
}

const priceModal = () => functionBody('function priceModal(', 'async function blockMenu(');
const cellMenu = () => functionBody('function cellMenu(', 'function blockModal(');

test('the Set nightly price box starts empty, not with the night\'s current price', () => {
  const body = priceModal();
  assert.doesNotMatch(body, /value: price\b/, 'the price is not written into the box');
  const field = body.match(/field\(\{ name: 'price'[^\n]*\}\)/);
  assert.ok(field, 'the price field is on one line this test can read');
  assert.doesNotMatch(field[0], /value:/, 'the price field has no value');
});

test('the hint names the current price and where it comes from, with a line for a night with no price', () => {
  const body = priceModal();
  assert.match(body, /Now \$\{pesoShort\(price\)\} from your usual rates\. Type a price to set it for these nights; leave empty to use your usual rates\./);
  assert.match(body, /Now \$\{pesoShort\(price\)\}, set on the calendar\. Leave empty to go back to your usual rates\./);
  assert.match(body, /No price is set for this night yet\./);
  assert.match(body, /overridden \?/, 'the hint depends on whether the night has a set price');
});

test('a blank Save reads the server\'s cleared count; a typed price keeps "Price saved."', () => {
  const body = priceModal();
  assert.match(body, /const res = await api\('PUT', '\/rates', \{ \.\.\.d, unit_id: listing\.unit_id \}\);/);
  assert.match(body, /if \(d\.price\.trim\(\) === ''\)/, 'the blank case is checked before choosing the message');
  assert.match(body, /res\.cleared > 0/);
  assert.match(body, /Set prices cleared\. These nights use your usual rates again\./);
  assert.match(body, /No set prices to clear\. These nights already use your usual rates\./);
  assert.match(body, /toast\('Price saved\.'\)/);
});

test('the price form lets server errors reach the field: the save is not caught here', () => {
  const body = priceModal();
  assert.match(body, /Price must be greater than zero\./, 'the zero refusal stays');
  assert.match(body, /throw new ApiError\(/);
  assert.doesNotMatch(body, /catch/, 'the server message is thrown on, so the form shows it on the price field');
});

test('the calendar cell passes whether the night has a set price into the menu and the price form', () => {
  assert.match(source, /onclick: \(\) => cellMenu\(l, d, price, p, rates\.has\(`\$\{l\.unit_id\}\|\$\{d\}`\)\),/);
  assert.match(cellMenu(), /function cellMenu\(listing, date, price, rule, overridden\)/);
  assert.match(cellMenu(), /priceModal\(listing, date, price, overridden\)/);
});
