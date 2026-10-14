'use strict';

// QA round 9, lane C18 (calendar-view). K12: typing a year into "Go to date" loaded the grid at every step on the way
// (0002-12-20, 0202-12-20, then 2026-12-20). The change handler now waits 400 ms after the last change, loads only the
// date the box has settled on, and a newer change restarts the wait.
// Frontend-only: no database. A source scan pulls the real change handler out of calendar.js and runs it on mock timers.
// node --test --test-concurrency=1 test/qa-r9-c18.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'calendar.js'), 'utf8');

// The "Go to date" change handler: the expression passed to dateInput.addEventListener('change', ...).
function changeHandler() {
  const start = src.indexOf("dateInput.addEventListener('change', ");
  assert.notEqual(start, -1, 'calendar.js listens to the Go to date box');
  const from = start + "dateInput.addEventListener('change', ".length;
  const end = src.indexOf('\n  const legend', from);
  assert.notEqual(end, -1, 'the handler ends before the legend');
  return src.slice(from, end).trim().replace(/\)\s*;$/, '');
}

// The handler bound to one box, one view, one load and one lastData (the names the real closure uses).
function bind({ box, view, load, lastData }) {
  return new Function('dateInput', 'view', 'load', 'lastData', `return ${changeHandler()};`)(box, view, load, lastData);
}

// A box, a grid on 2026-10-20 and the handler, with timers mocked so the 400 ms wait is run by hand.
// fire() is one change event on the box; wait(ms) moves the clock on; loads records the start of each grid load.
function setup(t, { value = '' } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const box = { value };
  const view = { start: '2026-10-20' };
  const loads = [];
  const fire = bind({ box, view, load: () => { loads.push(view.start); }, lastData: { start: '2026-10-20' } });
  return { box, view, loads, fire, wait: (ms) => t.mock.timers.tick(ms) };
}

test('typing a year one segment at a time loads the grid once, for the date the box settles on', (t) => {
  const { box, view, loads, fire, wait } = setup(t);
  for (const typed of ['0002-12-20', '0020-12-20', '0202-12-20', '2026-12-20']) {
    box.value = typed;
    fire();
    wait(100);
  }
  assert.equal(loads.length, 0, 'nothing loads while the year is still being typed');
  wait(299);
  assert.equal(loads.length, 0, 'still inside the 400 ms wait after the last change');
  wait(1);
  assert.deepEqual(loads, ['2026-12-20']);
  assert.equal(view.start, '2026-12-20');
  assert.equal(box.value, '2026-12-20');
});

test('a single change loads the grid after 400 ms of quiet, not before', (t) => {
  const { box, loads, fire, wait } = setup(t, { value: '2026-11-01' });
  fire();
  wait(399);
  assert.equal(loads.length, 0);
  wait(1);
  assert.deepEqual(loads, ['2026-11-01']);
  assert.equal(box.value, '2026-11-01');
});

test('a newer change restarts the wait, so an older value never loads', (t) => {
  const { box, view, loads, fire, wait } = setup(t, { value: '2026-11-01' });
  fire();
  wait(300);
  box.value = '2026-11-15';
  fire();
  wait(300);
  assert.equal(loads.length, 0, 'the first value would already have loaded if it were not replaced');
  wait(100);
  assert.deepEqual(loads, ['2026-11-15']);
  assert.equal(view.start, '2026-11-15');
});

test('a complete date outside 2000 to 2100 is left in the box after the wait and does not load', (t) => {
  const { box, view, loads, fire, wait } = setup(t, { value: '0202-12-20' });
  fire();
  wait(400);
  assert.deepEqual(loads, []);
  assert.equal(box.value, '0202-12-20');
  assert.equal(view.start, '2026-10-20');
});

test('an emptied box shows the grid date again after the wait; a date typed inside the wait is kept', (t) => {
  const { box, view, loads, fire, wait } = setup(t, { value: '' });
  fire();
  wait(400);
  assert.equal(box.value, '2026-10-20');
  assert.deepEqual(loads, []);

  box.value = '';
  fire();
  wait(200);
  box.value = '2026-11-03';
  fire();
  wait(400);
  assert.deepEqual(loads, ['2026-11-03']);
  assert.equal(box.value, '2026-11-03');
  assert.equal(view.start, '2026-11-03');
});
