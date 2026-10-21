'use strict';

// QA round 11, lane C16 (groups and calendar views, public/js/views/groups.js and calendar.js). Frontend only: no database, no server.
// #4: a new group's room row with no listing says which room it is ("Choose a listing for room 3."). That message sits on the row's
//     own listing box, which the form marks and focuses, the way the date boxes do. The add-a-room dialog shows no number, so it says "this room".
// #39 (calendar): #/calendar?start=... outside 2000 to 2100, or not a date at all, is dropped and the grid opens on this week (D-84, D-77 pattern).
//     A date that does not exist (2026-02-30) is kept, so the server's "That date wasn't valid" line still shows.
// P4: a price cell under a booking or block opens that booking or block, never the new-booking sheet. The bar and the cell share one action.
// Behaviour runs on temp copies of the two views: the real modules import the app shell, which does not load in Node. The stand-in DOM
// follows test/qa-r3-groups-view.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '..', 'public', 'js');
const groupsSrc = fs.readFileSync(path.join(SRC, 'views', 'groups.js'), 'utf8');
const calendarSrc = fs.readFileSync(path.join(SRC, 'views', 'calendar.js'), 'utf8');
const between = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

// Just enough DOM for h() in ui.js: elements, attributes, listeners, text.
class Node { }
class Text extends Node { constructor(data) { super(); this.data = data; } }
const toNode = (n) => (n instanceof Node ? n : new Text(String(n)));
class Element extends Node {
  constructor(tag) {
    super();
    Object.assign(this, { tagName: tag, attrs: {}, children: [], listeners: {}, style: {}, dataset: {}, className: '' });
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  append(...nodes) { this.children.push(...nodes.map(toNode)); }
  replaceChildren(...nodes) { this.children = nodes.map(toNode); }
}
globalThis.Node = Node;
globalThis.Element = Element;
globalThis.document = { createElement: (tag) => new Element(tag), createTextNode: (data) => new Text(data) };

const walk = (node, pred, out = []) => {
  if (node instanceof Element) {
    if (pred(node)) out.push(node);
    node.children.forEach((c) => walk(c, pred, out));
  }
  return out;
};

// Stand-ins for the two modules the views import from reservations.js; the rest of the tree is the real api.js, ui.js and filters.js.
const RESERVATIONS_STUB = [
  "export function guestsProblem(value) { const n = String(value ?? '').trim(); return /^\\d+$/.test(n) && Number(n) >= 1 ? null : 'Enter a whole number of guests, 1 or more.'; }",
  'export function addDays(d, n) { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }',
  'export function boxValue({ typed, mode, suggestion, current }) { if (typed) return current; return mode === "type" || suggestion == null ? "" : String(suggestion); }',
  'export function newReservationModal() {}',
  'export function matchedGuestNote() { return null; }',
  'export const CHANNEL_LABEL = {};',
].join('\n');

// A temp copy of the view with the named helpers exported. A helper that is declared but not exported is exported from the copy;
// a name the view does not declare at all is left out, so the test that needs it fails on its own ("is not a function")
// instead of the whole file failing to load.
function stage(view, source, names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bh-${view}-r11-c16-`));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'filters.js', 'rates.js']) fs.copyFileSync(path.join(SRC, f), path.join(dir, f)); // calendar.js imports ../rates.js (QA round 12, C13)
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner' } };\nexport const navigate = () => {};\n");
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), RESERVATIONS_STUB);
  const toExport = names.filter((n) => !new RegExp(`export (?:function|const) ${n}\\b`).test(source) && new RegExp(`(?:function|const) ${n}\\b`).test(source));
  fs.writeFileSync(path.join(dir, 'views', `${view}.js`), toExport.length ? `${source}\nexport { ${toExport.join(', ')} };\n` : source);
  return dir;
}

const LISTINGS = [{ unit_id: 'u-1', unit_name: '1201', property_id: 'p-1', property_name: 'Azure', room_type: 'Studio' }];
const DEFAULTS = { check_in: '2028-07-05', check_out: '2028-07-06', num_guests: 2 };

let groups; let cal; const dirs = [];
test.before(async () => {
  const g = stage('groups', groupsSrc, ['roomRow']);
  const c = stage('calendar', calendarSrc, ['calendarStart', 'nightTaken']);
  dirs.push(g, c);
  groups = await import(pathToFileURL(path.join(g, 'views', 'groups.js')));
  cal = await import(pathToFileURL(path.join(c, 'views', 'calendar.js')));
});
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

// One room row with its boxes set; `number` is omitted for the add-a-room dialog, which passes no number.
function rowWith(number, values = {}) {
  const r = groups.roomRow({ listings: LISTINGS, roomTypes: [], defaults: DEFAULTS, number });
  const set = { unit: '', ci: '2028-07-05', co: '2028-07-06', guests: '2', price: '', clean: '', ...values };
  const ids = { unit: 'gr-unit-', ci: 'gr-ci-', co: 'gr-co-', guests: 'gr-guests-', price: 'gr-price-', clean: 'gr-clean-' };
  for (const [k, prefix] of Object.entries(ids)) {
    const [el] = walk(r.el, (n) => n.attrs.id?.startsWith(prefix) && !n.attrs.id.endsWith('-err'));
    el.value = set[k];
  }
  return r;
}
const refusedWith = (r) => {
  try { r.rooms(); } catch (e) { return e; }
  return null;
};

// ---------------------------------------------------------------- #4: a room row with no listing
test('a room with no listing names its room, and the message sits on its own listing box', () => {
  const r = rowWith(3, { unit: '' });
  const err = refusedWith(r);
  assert.ok(err, 'rooms() refuses the row');
  const [box] = walk(r.el, (n) => String(n.dataset?.field || '').startsWith('unit_id-'));
  assert.ok(box, 'the listing box is a field the form can mark');
  assert.deepEqual(Object.keys(err.fields), [box.dataset.field], 'the one field message is keyed to that box');
  assert.equal(err.fields[box.dataset.field], 'Choose a listing for room 3.');
  assert.equal(err.message, 'Please check the highlighted fields.', 'the form shows the summary once, not the sentence twice');
});

test('a row renumbered after a room above it is removed names its new number', () => {
  const r = rowWith(3, { unit: '' });
  r.setNumber(2);
  const err = refusedWith(r);
  assert.equal(Object.values(err.fields)[0], 'Choose a listing for room 2.');
});

test('a room added on its own (the add-a-room dialog, no number) says this room', () => {
  const err = refusedWith(rowWith(undefined, { unit: '' }));
  assert.equal(Object.values(err.fields)[0], 'Choose a listing for this room.');
});

test('a row with a listing chosen still sends that listing', () => {
  assert.equal(rowWith(3, { unit: 'u-1' }).rooms()[0].unit_id, 'u-1');
});

test('the old "Choose a listing for each room row." sentence is gone from groups.js', () => {
  assert.doesNotMatch(groupsSrc, /Choose a listing for each room row/);
});

// ---------------------------------------------------------------- #39 (calendar): the start from the link
test('a start from the link is kept only when it is a date from 2000 to 2100', () => {
  assert.equal(typeof cal.calendarStart, 'function', 'calendar.js exports calendarStart');
  assert.equal(cal.calendarStart('2026-10-20'), '2026-10-20');
  assert.equal(cal.calendarStart('2000-01-01'), '2000-01-01');
  assert.equal(cal.calendarStart('2100-12-31'), '2100-12-31');
});

test('a start outside 2000 to 2100, or not a date, is dropped (null)', () => {
  assert.equal(typeof cal.calendarStart, 'function', 'calendar.js exports calendarStart');
  for (const raw of ['1900-01-01', '2200-01-01', '1999-12-31', '2101-01-01', 'x', '', undefined, null]) {
    assert.equal(cal.calendarStart(raw), null, String(raw));
  }
});

test('a date that does not exist (2026-02-30) is kept, so the server still says it was not valid', () => {
  assert.equal(typeof cal.calendarStart, 'function', 'calendar.js exports calendarStart');
  assert.equal(cal.calendarStart('2026-02-30'), '2026-02-30');
});

test('the grid\'s start from the link goes through the window check before anything loads', () => {
  assert.match(calendarSrc, /const view = \{ start: calendarStart\(query\.start\),/);
});

// ---------------------------------------------------------------- P4: the price cell under a booking or block
test('a night under a booking or block is found by its check-in and check-out, and a check-out morning stays open', () => {
  assert.equal(typeof cal.nightTaken, 'function', 'calendar.js exports nightTaken');
  const bookings = [
    { booking_id: 'b-1', unit_id: 'u-1', kind: 'reservation', check_in: '2026-10-18', check_out: '2026-10-20' },
    { booking_id: 'k-1', unit_id: 'u-1', kind: 'block', check_in: '2026-10-25', check_out: '2026-10-26' },
  ];
  assert.equal(cal.nightTaken(bookings, 'u-1', '2026-10-18').booking_id, 'b-1', 'the check-in night');
  assert.equal(cal.nightTaken(bookings, 'u-1', '2026-10-19').booking_id, 'b-1', 'a night in the middle');
  assert.equal(cal.nightTaken(bookings, 'u-1', '2026-10-20'), null, 'the check-out day is open for a new check-in');
  assert.equal(cal.nightTaken(bookings, 'u-1', '2026-10-17'), null, 'the night before is open');
  assert.equal(cal.nightTaken(bookings, 'u-2', '2026-10-19'), null, 'another listing is not taken');
  assert.equal(cal.nightTaken(bookings, 'u-1', '2026-10-25').kind, 'block', 'a block takes its nights too');
});

test('a price cell under a booking or block opens that booking or block, never the new-booking sheet', () => {
  const menu = between(calendarSrc, 'function cellMenu(', 'function blockModal(');
  const check = menu.indexOf('nightTaken(lastData.bookings, listing.unit_id, date)');
  assert.ok(check > -1, 'cellMenu looks up the booking or block under the night');
  assert.ok(check < menu.indexOf('newReservationModal('), 'the lookup comes before the new-booking sheet can open');
  assert.match(menu, /if \(taken\) return openBar\(taken\)/);
});

test('a bar and the price cell under it share one action: the block menu, or the reservation', () => {
  const open = between(calendarSrc, 'function openBar(', '// An emptied box shows the date');
  assert.match(open, /if \(b\.kind === 'block'\) return blockMenu\(b\);/);
  assert.match(open, /return blockMenu\(b\);\s*navigate\(`#\/reservations\/\$\{b\.booking_id\}`\);/);
  assert.match(calendarSrc, /onclick: \(e\) => \{ e\.stopPropagation\(\); return openBar\(b\); \},/);
});
