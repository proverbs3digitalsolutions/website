'use strict';

// QA round 8, lane C40 (calendar-view). Typing a date into "Go to date" one segment at a time.
// Typing the year reaches the change handler on the way to 2026 as 0002-12-20, 0020-12-20, 0202-12-20. The handler used
// to load each one; the server then answers "That date wasn't valid" and puts today back in the box, so the year was lost.
// Now only a complete date with a year from 2000 to 2100 (D-84) moves the grid. Any other non-empty value is left alone.
// Round 9 (K12): the handler acts 400 ms after the change, so each test runs mock timers and advances them 400 ms before
// it asserts. The asserted values are unchanged.
// Frontend-only: no database. A source scan pulls the real change handler out of calendar.js and runs it.
// node --test --test-concurrency=1 test/qa-r8-c40.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'calendar.js'), 'utf8');

// The "Go to date" change handler: the arrow function passed to dateInput.addEventListener('change', ...).
function changeHandler() {
  const start = src.indexOf("dateInput.addEventListener('change', ");
  assert.notEqual(start, -1, 'calendar.js listens to the Go to date box');
  const from = start + "dateInput.addEventListener('change', ".length;
  const end = src.indexOf('\n  const legend', from);
  assert.notEqual(end, -1, 'the handler ends before the legend');
  return src.slice(from, end).trim().replace(/\)\s*;$/, '');
}

// The handler bound to one box, one view, one load and one grid (the names the real closure uses).
function bind({ box, view, load, lastData }) {
  return new Function('dateInput', 'view', 'load', 'lastData', `return ${changeHandler()};`)(box, view, load, lastData);
}

// One change of the box, with the grid on 2026-10-20. The handler acts 400 ms later, so the test's mock clock runs past
// that before the result is read. Reports the box, the grid's start and how many loads ran.
function change(t, value, lastData = { start: '2026-10-20' }) {
  const box = { value };
  const view = { start: '2026-10-20' };
  let loads = 0;
  bind({ box, view, load: () => { loads += 1; }, lastData })();
  t.mock.timers.tick(400);
  return { box: box.value, start: view.start, loads };
}

test('a half-typed year does not load the grid and leaves the box as typed', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.deepEqual(change(t, '0002-12-20'), { box: '0002-12-20', start: '2026-10-20', loads: 0 });
  assert.deepEqual(change(t, '0020-12-20'), { box: '0020-12-20', start: '2026-10-20', loads: 0 });
  assert.deepEqual(change(t, '0202-12-20'), { box: '0202-12-20', start: '2026-10-20', loads: 0 });
});

test('typing the year 2026 one segment at a time loads the grid once, on the complete year', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const box = { value: '2026-12-20' };
  const view = { start: '2026-10-20' };
  let loads = 0;
  const handler = bind({ box, view, load: () => { loads += 1; }, lastData: { start: '2026-10-20' } });
  for (const typed of ['0002-12-20', '0020-12-20', '0202-12-20', '2026-12-20']) {
    box.value = typed;
    handler();
  }
  t.mock.timers.tick(400);
  assert.equal(loads, 1);
  assert.equal(view.start, '2026-12-20');
  assert.equal(box.value, '2026-12-20');
});

test('a picked date in range moves the grid to that date and loads it once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.deepEqual(change(t, '2026-12-20'), { box: '2026-12-20', start: '2026-12-20', loads: 1 });
});

test('the year range is inclusive: 2000 and 2100 load, 1999 and 2101 do not', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.deepEqual(change(t, '2000-01-01'), { box: '2000-01-01', start: '2000-01-01', loads: 1 });
  assert.deepEqual(change(t, '2100-12-31'), { box: '2100-12-31', start: '2100-12-31', loads: 1 });
  assert.deepEqual(change(t, '1999-12-31'), { box: '1999-12-31', start: '2026-10-20', loads: 0 });
  assert.deepEqual(change(t, '2101-01-01'), { box: '2101-01-01', start: '2026-10-20', loads: 0 });
});

test('an emptied box shows the grid start date again, and the grid is not reloaded', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.deepEqual(change(t, ''), { box: '2026-10-20', start: '2026-10-20', loads: 0 });
  assert.deepEqual(change(t, '', { start: '2026-11-03' }), { box: '2026-11-03', start: '2026-10-20', loads: 0 });
});
