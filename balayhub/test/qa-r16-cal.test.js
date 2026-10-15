'use strict';
// QA round 16, lane CAL (frontend only, no database): phone folds the calendar filters (#41), month bar gets cal-nav (#29).
// node --test --test-concurrency=1 test/qa-r16-cal.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const calendar = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'calendar.js'), 'utf8');
const calendarFolded = new Function(`${calendar.match(/export const calendarFolded = [^\n]+/)[0].replace('export ', '')}; return calendarFolded;`)();

test('#41 calendarFolded is true when small host or phone', () => {
  assert.equal(calendarFolded(true, false), true);
  assert.equal(calendarFolded(false, true), true);
  assert.equal(calendarFolded(true, true), true);
  assert.equal(calendarFolded(false, false), false);
});

test('#41 the bar and legend use folded, with the phone query below 960px', () => {
  assert.match(calendar, /matchMedia\('\(max-width: 959px\)'\)\.matches/);
  assert.match(calendar, /quick: folded \? \[\] : quick/);
  assert.match(calendar, /more: folded \? \[\.\.\.quick, \.\.\.more\] : more/);
  assert.match(calendar, /\(folded \? h\('details'/);
});

test('#29 the month bar carries cal-nav', () => {
  assert.match(calendar, /h\('div', \{ class: 'chips cal-nav' \}/);
});
