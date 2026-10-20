'use strict';
require('./helpers');

// QA round 33, lane HOME (ONB-1). Frontend only: no database.
// Home's daily overview shows a plain count, not "0/0", when nothing is due (D-115).
// node --test --test-concurrency=1 test/qa-r33-home.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'home.js'), 'utf8');
const from = src.indexOf('async function overviewCard()');
const to = src.indexOf('// ---------------------------------------------------------------- trends');
assert.ok(from > 0 && to > from, 'overviewCard is found in home.js');

// Whole-line comments are stripped (the new comment quotes the old "0/0" text on purpose), then whitespace is collapsed
// so the checks read the code as one line.
const code = src.slice(from, to)
  .split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n').replace(/\s+/g, ' ');

describe('Home daily overview with nothing due (ONB-1, D-115)', () => {
  it('the arrivals tile is a plain 0 labelled Arrivals when no arrivals are due', () => {
    assert.ok(code.includes(
      "o.arrivals.length ? tile(`${checkedIn}/${o.arrivals.length}`, 'Checked in', range === 'today' ? null : 'Arrivals', '#/reservations?view=arrivals_today') : tile('0', 'Arrivals', null, '#/reservations?view=arrivals_today'),"));
  });

  it('the departures tile is a plain 0 labelled Departures when no departures are due', () => {
    assert.ok(code.includes(
      "o.departures.length ? tile(`${checkedOut}/${o.departures.length}`, 'Checked out', range === 'today' ? null : 'Departures', '#/reservations?view=departures_today') : tile('0', 'Departures', null, '#/reservations?view=departures_today'),"));
  });

  it('the fraction and its Checked in / Checked out labels stay for a day with anything due', () => {
    assert.ok(code.includes("'Checked in'"));
    assert.ok(code.includes("'Checked out'"));
    assert.ok(code.includes("tile('0', 'Arrivals'"));
    assert.ok(code.includes("tile('0', 'Departures'"));
  });

  it('no 0/0 literal is left in the overview code', () => {
    assert.ok(!code.includes('0/0'));
  });

  it('the turnovers and staying tiles are unchanged', () => {
    assert.ok(code.includes("tile(String(o.turnovers.length), 'Turnovers', 'Same-day out & in')"));
    assert.ok(code.includes("tile(String(o.staying.length), 'Staying',"));
  });
});
