'use strict';

// QA round 15, lane L1 (listings.js). Frontend only: no database. node --test --test-concurrency=1 test/qa-r15-l1.test.js
// #28 The filter bar follows the listing count without a reload (it only grows, a tag filter never rebuilds it).
// #34 Two sync rows that read the same get "(link 1)", "(link 2)" on the listing card.
// #44 The "until" occupancy link is a standalone link: link-tap.
// #30 The channels dialog asks (409 ICAL_NOT_CALENDAR) and resends with confirm_unusual_link.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'listings.js'), 'utf8');

// A one-line `export const name = ...;` taken out of the browser module, so the pure helper runs without a DOM.
function pure(name, ...deps) {
  const grab = (n) => { const m = src.match(new RegExp(`^export const ${n} = (.*);$`, 'm')); assert.ok(m, `${n} is exported as a one-line const`); return m[1]; };
  return new Function(...deps.map((d) => d), `return ${grab(name)};`);
}
const nextFilterMode = () => pure('nextFilterMode', 'listingFilterMode')(pure('listingFilterMode')());
const labelDuplicates = () => pure('labelDuplicates')();

test('nextFilterMode only grows, and a tag filter never changes it', () => {
  const next = nextFilterMode();
  assert.equal(next('compact', 4, false), 'full');
  assert.equal(next('full', 2, false), 'full');
  assert.equal(next('none', 1, false), 'compact');
  assert.equal(next('none', 0, false), 'none');
  assert.equal(next('compact', 9, true), 'compact');
  assert.equal(next('none', 9, true), 'none');
});

test('ensureBar swaps a bigger bar into the page with replaceWith', () => {
  const i = src.indexOf('function ensureBar(');
  assert.notEqual(i, -1);
  const body = src.slice(i, src.indexOf('\n  }\n', i));
  assert.match(body, /nextFilterMode\(/);
  assert.match(body, /replaceWith\(/);
  assert.doesNotMatch(body, /\.focus\(/);
});

test('labelDuplicates numbers only rows whose text repeats, in order', () => {
  const lab = labelDuplicates();
  assert.deepEqual(lab(['a', 'b', 'a']), ['a (link 1)', 'b', 'a (link 2)']);
  assert.deepEqual(lab(['a', 'b']), ['a', 'b']);
  assert.deepEqual(lab([]), []);
});

test('the sync alert on a card uses labelDuplicates', () => {
  assert.match(src, /labelDuplicates\(/);
});

test('the occupancy link is a link-tap link', () => {
  assert.match(src, /h\('a', \{ class: 'link-tap', href: `#\/reservations\/\$\{l\.current_booking_id\}`/);
});

test('the channels dialog handles ICAL_NOT_CALENDAR with confirm_unusual_link', () => {
  assert.match(src, /ICAL_NOT_CALENDAR/);
  assert.match(src, /confirm_unusual_link: true/);
  assert.match(src, /title: 'Check the calendar link'/);
  assert.match(src, /confirmText: 'Save anyway'/);
  assert.match(src, /cancelText: 'Change it'/);
});
