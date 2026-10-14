'use strict';

// QA round 8, lane C28 (calendar-view). One fix on the Multi-calendar page:
// #2: clearing the "Go to date" box leaves it blank and the grid unchanged. An emptied box now shows the grid's
// current start date again, and the grid is not reloaded.
// Frontend-only: no database. A source scan pulls the real change handler out of calendar.js and runs it.
// node --test --test-concurrency=1 test/qa-r8-c28.test.js

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

test('an emptied Go to date box shows the grid start date again, and the grid is left alone', () => {
  const box = { value: '' };
  const view = { start: '2026-10-20' };
  let loads = 0;
  bind({ box, view, load: () => { loads += 1; }, lastData: { start: '2026-10-20' } })();
  assert.equal(box.value, '2026-10-20');
  assert.equal(view.start, '2026-10-20');
  assert.equal(loads, 0);
});

test('the box goes back to the date on the grid, not a date a Later click asked for and has not drawn yet', () => {
  const box = { value: '' };
  const view = { start: '2026-10-27' };
  bind({ box, view, load: () => {}, lastData: { start: '2026-10-20' } })();
  assert.equal(box.value, '2026-10-20');
});

test('a picked date still moves the grid to that date and loads it once', () => {
  const box = { value: '2026-11-01' };
  const view = { start: '2026-10-20' };
  let loads = 0;
  bind({ box, view, load: () => { loads += 1; }, lastData: { start: '2026-10-20' } })();
  assert.equal(view.start, '2026-11-01');
  assert.equal(loads, 1);
  assert.equal(box.value, '2026-11-01');
});
