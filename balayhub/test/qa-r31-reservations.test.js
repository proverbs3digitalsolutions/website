'use strict';
require('./helpers');

// QA round 31, RESERVATIONS (BKG-1, BKG-2). Frontend only: source scans and literal extracts of public/js/views/reservations.js.
// BKG-1: the Move to box starts on "Select…", so an untouched press never moves a booking (D-113, round 14's rule).
// BKG-2: an empty saved view names its own view; "Nothing here yet" is kept for All reservations only (D-113).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/reservations.js'), 'utf8');

// The body of a top-level function, from its first line to its closing brace on a line of its own.
function topLevel(start) {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `${start} is declared`);
  return src.slice(from, src.indexOf('\n}\n', from) + 3);
}

// A top-level const literal (an array or an object), evaluated from its own source text.
function literal(name) {
  const m = src.match(new RegExp(`const ${name} = ([\\[{][\\s\\S]*?\\n[\\]}]);`));
  assert.ok(m, `const ${name} is declared`);
  return new Function(`return ${m[1]};`)();
}

test('BKG-1: the Move to box has no placeholderOption, so it starts on "Select…" and never on the first listing', () => {
  const move = topLevel('async function moveModal(');
  const line = move.split('\n').find((l) => l.includes("name: 'unit_id'"));
  assert.ok(line, 'the Move to field is in moveModal');
  assert.match(line, /label: 'Move to'/);
  assert.ok(!line.includes('placeholderOption'), 'the shared select shows its own "Select…" placeholder');
  assert.match(line, /required: true/, 'an untouched press still says "Move to is required."');
});

test('BKG-2: every saved view has its own empty title, with the exact copy, and All reservations keeps "Nothing here yet"', () => {
  assert.ok(src.indexOf('const EMPTY_VIEW = {') < src.indexOf('export async function reservationsView('), 'EMPTY_VIEW sits above reservationsView');
  const views = literal('VIEWS').map(([v]) => v);
  const empty = literal('EMPTY_VIEW');
  assert.deepEqual(Object.keys(empty).sort(), [...views].sort(), 'one empty title per saved view, no extra keys');
  assert.deepEqual(empty, {
    upcoming: 'No upcoming bookings',
    hosting: 'No guests staying right now',
    arrivals_today: 'No check-ins today',
    departures_today: 'No check-outs today',
    arrivals_tomorrow: 'No check-ins tomorrow',
    departures_tomorrow: 'No check-outs tomorrow',
    unpaid: 'No unpaid reservations',
    past: 'No past stays',
    cancelled: 'No cancelled reservations',
    recent: 'No reservations created recently',
    all: 'Nothing here yet',
  });
});

test('BKG-2: the empty state reads the saved view, keeps the add-or-import line only for All and Upcoming, and says where to look elsewhere', () => {
  const view = topLevel('export async function reservationsView(');
  assert.ok(view.includes("title: filtered ? 'No results found' : EMPTY_VIEW[filters.view],"), 'the title comes from EMPTY_VIEW for the view on screen');
  assert.ok(
    view.includes("text: filtered ? 'Try removing a filter or choosing another view.' : ['all', 'upcoming'].includes(filters.view) ? 'Reservations you add, or import from Airbnb/Booking.com, appear here.' : 'Choose another saved view to see your other reservations.',"),
    'the four sentences of the empty state are exact',
  );
  assert.ok(
    view.includes("action: !filtered && canManage && h('button', { class: 'btn btn--primary', onclick: () => newReservationModal() }, icon('plus'), 'New reservation'),"),
    'the New reservation button is unchanged',
  );
  assert.ok(!view.includes("'Nothing here yet'"), 'the view no longer hard-codes the All reservations title for every view');
});
