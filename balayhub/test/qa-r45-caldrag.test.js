'use strict';
require('./helpers');

// QA round 45 CALDRAG (D-120, D-127): a calendar bar takes focus when its drag starts, and a move reloads the grid with the moved bar's key.
// Before this, the focus was on the page heading after a drag sent as DOM events, or in browsers that don't focus a button on a mouse press
// (Safari, Firefox on macOS). Frontend only, no database.
// R45_CALENDAR_JS (optional) points the test at another copy of calendar.js (used to prove it red on fee74b0 and on partial fixes).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CALENDAR_JS = process.env.R45_CALENDAR_JS || path.join(__dirname, '..', 'public', 'js', 'views', 'calendar.js');
const source = fs.readFileSync(CALENDAR_JS, 'utf8');

// The text of one function in calendar.js, from its declaration up to the next named function (as qa-r2-calendar does).
function functionBody(declaration, next) {
  const start = source.indexOf(declaration);
  assert.ok(start > -1, `${declaration} is in calendar.js`);
  const end = source.indexOf(next, start);
  assert.ok(end > start, `${next} follows ${declaration}`);
  return source.slice(start, end);
}

// The drag-start handler of a bar: its arrow function text, from `ondragstart:` up to `ondragend:`.
function dragStartSource() {
  const start = source.indexOf('ondragstart: (e) => {');
  assert.ok(start > -1, 'the bar has a drag-start handler');
  const end = source.indexOf('ondragend:', start);
  assert.ok(end > start, 'ondragend follows ondragstart');
  return source.slice(start + 'ondragstart: '.length, end).replace(/,\s*$/, '');
}

const BAR = { booking_id: 'B1', unit_id: 'U1', channel: 'direct', guest_name: 'Joseph Ramos' };
const TO = { unit_id: 'U2', unit_name: 'Tower 3 - 1815' };

// moveBar with a stand-in for its closure: the grid's last data, a confirm that answers `answer`, and spies for the request, toast and reload.
function moveBarFor({ answer = true, patchError = null } = {}) {
  const calls = { patch: [], toast: [], reload: [] };
  const lastData = { listings: [{ unit_id: 'U1', unit_name: 'Loft A' }, TO] };
  const moveBar = new Function('lastData', 'confirmDialog', 'patch', 'toast', 'reload', `${functionBody('async function moveBar(', 'function cellMenu(')}\nreturn moveBar;`)(
    lastData,
    async () => answer,
    async (url, body) => { calls.patch.push([url, body]); if (patchError) throw patchError; },
    (msg, kind) => calls.toast.push([msg, kind]),
    (key) => { calls.reload.push(key); },
  );
  return { moveBar, calls };
}

// The drag-start handler of a bar, run with a stand-in event. `log` keeps the order of the focus call, the drag type and the refusal.
function dragStartFor(bar, { locked = false } = {}) {
  const log = [];
  const toasts = [];
  const { handler, dragging } = new Function('CHANNEL_LABEL', 'toast', 'b', 'locked', `let dragging = null; return { handler: ${dragStartSource()}, dragging: () => dragging };`)(
    { airbnb: 'Airbnb', direct: 'Direct' },
    (msg) => toasts.push(msg),
    bar,
    locked,
  );
  const e = {
    currentTarget: { focus: (opts) => log.push(['focus', opts]) },
    preventDefault: () => log.push(['preventDefault']),
    dataTransfer: {
      set effectAllowed(v) { log.push(['effectAllowed', v]); },
      setData: (type, v) => log.push(['setData', type, v]),
    },
  };
  return { run: () => handler(e), log, toasts, dragging };
}

test('a moved reservation reloads the grid with the moved bar\'s key, so focus lands on that bar', async () => {
  const { moveBar, calls } = moveBarFor();
  await moveBar(BAR, TO);
  assert.deepEqual(calls.patch, [['/reservations/B1', { unit_id: 'U2' }]]);
  assert.deepEqual(calls.toast.map(([msg]) => msg), ['Reservation moved.']);
  assert.deepEqual(calls.reload, ['cal-booking-B1']);
});

test('a refused move shows the server reason and reloads with the same key, so focus stays on the bar in its old row', async () => {
  const { moveBar, calls } = moveBarFor({ patchError: new Error('Loft A is booked Oct 27 to 29.') });
  await moveBar(BAR, TO);
  assert.deepEqual(calls.toast, [['Loft A is booked Oct 27 to 29.', 'error']]);
  assert.deepEqual(calls.reload, ['cal-booking-B1']);
});

test('a move the person cancels sends nothing and does not reload', async () => {
  const { moveBar, calls } = moveBarFor({ answer: null });
  await moveBar(BAR, TO);
  assert.equal(calls.patch.length, 0);
  assert.equal(calls.reload.length, 0);
});

test('a drag starts by focusing the bar before the drag type is set, and the bar is the dragged booking', () => {
  const { run, log, dragging } = dragStartFor(BAR);
  run();
  assert.deepEqual(log.filter(([k]) => k === 'focus'), [['focus', { preventScroll: true }]]);
  assert.ok(log.findIndex(([k]) => k === 'focus') < log.findIndex(([k]) => k === 'effectAllowed'), 'focus comes before the drag type');
  assert.deepEqual(log.find(([k]) => k === 'effectAllowed'), ['effectAllowed', 'move']);
  assert.deepEqual(log.find(([k]) => k === 'setData'), ['setData', 'text/plain', 'B1']);
  assert.equal(dragging(), BAR);
});

test('a channel stay cannot be dragged: the drag is refused, the bar is not focused, and the toast names the channel', () => {
  const { run, log, toasts, dragging } = dragStartFor({ ...BAR, channel: 'airbnb' }, { locked: true });
  run();
  assert.deepEqual(log.map(([k]) => k), ['preventDefault']);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /This stay comes from Airbnb, so it can't be moved here/);
  assert.equal(dragging(), null);
});

test('the drag-start handler carries its reason as a comment directly above the key', () => {
  assert.match(source, /\/\/ The bar is the control used: it takes focus as the drag starts[^\n]*\n\s*ondragstart: \(e\) => \{/);
});
