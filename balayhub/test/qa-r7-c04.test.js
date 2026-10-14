'use strict';

// QA round 7, lane C04 (calendar view). Frontend-only: no database.
// #4: staff read who is staying and which nights are open; the booking and price wording is for owners and managers.
// #5: a filter value in the link that is not an option this person is shown is reset before the first load.
// #6: the grid title names both months when the shown days run into the next month; the 1st of a month reads "Nov 1".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CALENDAR_JS = path.join(__dirname, '..', 'public', 'js', 'views', 'calendar.js');
const RESERVATIONS_JS = path.join(__dirname, '..', 'public', 'js', 'views', 'reservations.js');
const source = fs.readFileSync(CALENDAR_JS, 'utf8');
const reservationsSource = fs.readFileSync(RESERVATIONS_JS, 'utf8');

// calendar.js imports app.js (a browser shell), so its pure helpers are read out of the file and run here.
// A top-level function, from its declaration to the closing brace at column 0, without `export`.
function topLevelFunction(text, declaration) {
  const start = text.indexOf(declaration);
  assert.ok(start > -1, `${declaration} is in the file`);
  const end = text.indexOf('\n}\n', start);
  assert.ok(end > start, `${declaration} closes with a brace at column 0`);
  return text.slice(start, end + 2).replace(/^export /, '');
}

// A one-line top-level `const name = ...;`.
function oneLineConst(text, name) {
  const m = text.match(new RegExp(`^const ${name} = (.+);$`, 'm'));
  assert.ok(m, `${name} is a one-line const`);
  return m[0];
}

let helpers;
function loadHelpers() {
  helpers ??= new Function([
    oneLineConst(source, 'monthName'),
    oneLineConst(source, 'dayNum'),
    oneLineConst(source, 'dayLabel'),
    topLevelFunction(reservationsSource, 'export function addDays('),
    topLevelFunction(source, 'export function rangeTitle('),
    topLevelFunction(source, 'export function knownFilters('),
    'return { dayLabel, rangeTitle, knownFilters };',
  ].join('\n'))();
  return helpers;
}

test('staff read who is staying and which nights are open; booking and price wording is for owners and managers', () => {
  assert.match(source, /h\('p', null, canManage \? 'Tap an open night to book, block or change its price' : 'See who is staying and which nights are open\. Booking and price changes are for owners and managers\.'\)/);
});

test('the grid title names both months when the shown days run into the next month, and one month otherwise', () => {
  const { rangeTitle } = loadHelpers();
  assert.equal(rangeTitle('2026-10-01', 14), 'October 2026');
  assert.equal(rangeTitle('2026-10-28', 14), 'October – November 2026');
  assert.equal(rangeTitle('2026-10-18', 30), 'October – November 2026');
  assert.equal(rangeTitle('2026-12-25', 14), 'December 2026 – January 2027');
  assert.match(source, /title\.textContent = rangeTitle\(data\.start, data\.days\);/, 'the title is built from the shown range');
});

test('the 1st of a month reads "Nov 1" in the day header; every other day stays a number', () => {
  const { dayLabel } = loadHelpers();
  assert.equal(dayLabel('2026-11-01'), 'Nov 1');
  assert.equal(dayLabel('2026-10-02'), 2);
  assert.equal(dayLabel('2026-10-31'), 31);
  assert.match(source, /h\('b', null, dayLabel\(d\)\)/, 'the day header uses dayLabel');
});

test('a filter value that is not an option this person is shown is reset; a valid one stays', () => {
  const { knownFilters } = loadHelpers();
  const options = { property_id: ['p1', 'p2'], tag: ['beach'], unit_type: ['studio'], avail: ['open', 'empty', 'booked'], cleaning: ['dirty', 'clean'] };
  const values = { q: 'loft', property_id: 'p2', tag: 'zz', unit_type: 'studio', avail: 'bogus', cleaning: '' };
  assert.deepEqual(knownFilters(values, options), { q: 'loft', property_id: 'p2', tag: '', unit_type: 'studio', avail: '', cleaning: '' });
});

test('staff have no tag options, so a tag in the link is always reset', () => {
  const { knownFilters } = loadHelpers();
  assert.deepEqual(knownFilters({ tag: 'zz' }, { tag: [] }), { tag: '' });
});

test('unknown link values are dropped before the tag list is first asked for, and tag options come from the tags this person can see', () => {
  const at = source.indexOf('knownFilters(filters, {');
  const firstLoad = source.indexOf('\n  await loadTagUnits();');
  assert.ok(at > -1, 'the filter values are checked against the options');
  assert.ok(firstLoad > at, 'the check runs before the first tag lookup and the first load');
  assert.match(source, /tag: tags\.map\(\(t\) => t\.tag\)/, 'tag options come from the tags list (empty for staff)');
});
