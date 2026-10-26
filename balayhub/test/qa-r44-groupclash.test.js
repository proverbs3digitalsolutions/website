'use strict';

require('./helpers');

// QA round 44, lane 5 GROUPCLASH (public/js/views/groups.js). Frontend only: no server, no database.
// GROUPCLASH (D-105, D-126): two rows of a new group that book the same listing on nights that overlap. The later row's listing box says
// so in the same one pass as the other problems, and no request is sent; the server's refusal stays as the backstop.
// Behaviour runs on a temp copy of the view with the stand-in DOM of test/qa-r28-groups.test.js. R44_GROUPS_DIR points the test at another
// public/js folder (the red run uses a copy of the 0b2c29f view).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = process.env.R44_GROUPS_DIR || path.join(__dirname, '..', 'public', 'js');
const groupsSrc = fs.readFileSync(path.join(SRC, 'views', 'groups.js'), 'utf8');

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

let dir; let groups;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-groupclash-r44-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner' } };\nexport const navigate = () => {};\n");
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), RESERVATIONS_STUB);
  fs.writeFileSync(path.join(dir, 'views', 'groups.js'), `${groupsSrc}\nexport { roomRow };\n`);
  groups = await import(pathToFileURL(path.join(dir, 'views', 'groups.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const LISTINGS = [
  { unit_id: 'u-1', unit_name: '1201', property_id: 'p-1', property_name: 'Azure', room_type: 'Studio' },
  { unit_id: 'u-2', unit_name: '1202', property_id: 'p-1', property_name: 'Azure', room_type: 'Studio' },
];
const TYPES = [{ property_id: 'p-1', room_type: 'Studio', count: 3 }];
const DEFAULTS = { check_in: '2028-07-05', check_out: '2028-07-06', num_guests: 2 };

// A real room row from the view's own builder, with its boxes set the way a host would leave them.
function rowWith(number, values = {}) {
  const r = groups.roomRow({ listings: LISTINGS, roomTypes: TYPES, defaults: DEFAULTS, number });
  const ids = { mode: 'gr-mode-', unit: 'gr-unit-', type: 'gr-type-', count: 'gr-count-', ci: 'gr-ci-', co: 'gr-co-', guests: 'gr-guests-', price: 'gr-price-', clean: 'gr-clean-' };
  const set = { mode: 'unit', unit: 'u-1', type: 'p-1|Studio', count: '1', ci: '2028-07-05', co: '2028-07-06', guests: '2', price: '', clean: '', ...values };
  for (const [k, prefix] of Object.entries(ids)) {
    const [el] = walk(r.el, (n) => n.attrs.id?.startsWith(prefix) && !n.attrs.id.endsWith('-err'));
    el.value = set[k];
  }
  return r;
}
const boxKey = (r, prefix) => walk(r.el, (n) => String(n.dataset?.field || '').startsWith(prefix))[0]?.dataset.field;

const OVERLAP = (n) => `Room ${n} already has this listing on nights that overlap. Choose another listing or change the dates.`;
// A stand-in row as groupProblems reads it: its own messages (keyed by its boxes), one room, and the listing and nights it books.
const stub = (i, stay, problems = {}) => ({ problems: () => problems, roomCount: () => 1, fieldKey: (n) => `${n}-r${i}`, stay: () => stay });
const nights = (unit_id, check_in, check_out) => ({ unit_id, check_in, check_out });

test('two rows on one listing with overlapping nights: the later row\'s listing box says so, in the same pass', () => {
  const rows = [stub(1, nights('u-1', '2027-03-01', '2027-03-04')), stub(2, nights('u-1', '2027-03-03', '2027-03-05'))];
  assert.deepEqual(groups.groupProblems({}, rows), { 'unit_id-r2': OVERLAP(1) });
});

test('the first earlier row that overlaps is the one named; rows on other listings are not', () => {
  const rows = [
    stub(1, nights('u-1', '2027-03-01', '2027-03-04')),
    stub(2, nights('u-2', '2027-03-01', '2027-03-04')),
    stub(3, nights('u-1', '2027-03-03', '2027-03-05')),
  ];
  assert.deepEqual(groups.groupProblems({}, rows), { 'unit_id-r3': OVERLAP(1) });
});

test('back-to-back nights, another listing, and a room-type row put nothing', () => {
  assert.deepEqual(groups.groupProblems({}, [stub(1, nights('u-1', '2027-03-01', '2027-03-04')), stub(2, nights('u-1', '2027-03-04', '2027-03-06'))]), {});
  assert.deepEqual(groups.groupProblems({}, [stub(1, nights('u-1', '2027-03-01', '2027-03-04')), stub(2, nights('u-2', '2027-03-03', '2027-03-05'))]), {});
  assert.deepEqual(groups.groupProblems({}, [stub(1, nights('u-1', '2027-03-01', '2027-03-04')), stub(2, null)]), {});
  assert.deepEqual(groups.groupProblems({}, [stub(1, null), stub(2, nights('u-1', '2027-03-03', '2027-03-05'))]), {});
});

test('a message the row already has stays, and the overlap message comes with its other messages', () => {
  const guests = { 'num_guests-r2': 'Enter a whole number of guests, 1 or more.' };
  const withGuests = [stub(1, nights('u-1', '2027-03-01', '2027-03-04')), stub(2, nights('u-1', '2027-03-03', '2027-03-05'), guests)];
  assert.deepEqual(groups.groupProblems({}, withGuests), { 'num_guests-r2': 'Enter a whole number of guests, 1 or more.', 'unit_id-r2': OVERLAP(1) });
  const withListing = [stub(1, nights('u-1', '2027-03-01', '2027-03-04')), stub(2, nights('u-1', '2027-03-03', '2027-03-05'), { 'unit_id-r2': 'Choose a listing for room 2.' })];
  assert.deepEqual(groups.groupProblems({}, withListing), { 'unit_id-r2': 'Choose a listing for room 2.' });
});

test('rows that come without a stay() method do not throw', () => {
  const plain = (i) => ({ problems: () => ({}), roomCount: () => 1, fieldKey: (n) => `${n}-r${i}` });
  assert.deepEqual(groups.groupProblems({}, [plain(1), plain(2)]), {});
});

test('real rows: an overlapping pair on one listing marks the later row\'s listing box, and the first row is not marked', () => {
  const a = rowWith(1, { ci: '2028-07-05', co: '2028-07-08' });
  const b = rowWith(2, { ci: '2028-07-07', co: '2028-07-09' });
  assert.deepEqual(groups.groupProblems({}, [a, b]), { [boxKey(b, 'unit_id-')]: OVERLAP(1) });
});

test('real rows: back-to-back nights, another listing, and a room-type row pass', () => {
  const a = rowWith(1, { ci: '2028-07-05', co: '2028-07-08' });
  assert.deepEqual(groups.groupProblems({}, [a, rowWith(2, { ci: '2028-07-08', co: '2028-07-10' })]), {});
  assert.deepEqual(groups.groupProblems({}, [a, rowWith(2, { unit: 'u-2', ci: '2028-07-07', co: '2028-07-09' })]), {});
  assert.deepEqual(groups.groupProblems({}, [a, rowWith(2, { mode: 'type', ci: '2028-07-07', co: '2028-07-09' })]), {});
});

test('roomRow stay() names the listing and nights a unit row books; a room-type row or a row with no listing or no nights names none', () => {
  assert.deepEqual(rowWith(1).stay(), { unit_id: 'u-1', check_in: '2028-07-05', check_out: '2028-07-06' });
  assert.equal(rowWith(1, { mode: 'type' }).stay(), null);
  assert.equal(rowWith(1, { unit: '' }).stay(), null);
  assert.equal(rowWith(1, { co: '2028-07-05' }).stay(), null);
});
