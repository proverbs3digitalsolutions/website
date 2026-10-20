'use strict';

// QA round 25, lane 7 GROUPS (public/js/views/groups.js). Frontend only: no database, no server.
// BKG-1: a new group booking reports every problem in one save: the lead guest name, each room row's problems on that row's own
// boxes, and the "2 to 20 rooms" count. Behaviour runs on a temp copy of the view with the stand-in DOM of test/qa-r11-c16.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '..', 'public', 'js');
const groupsSrc = fs.readFileSync(path.join(SRC, 'views', 'groups.js'), 'utf8');

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

let dir; let groups;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-groups-r25-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner' } };\nexport const navigate = () => {};\n");
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), RESERVATIONS_STUB);
  fs.writeFileSync(path.join(dir, 'views', 'groups.js'), `${groupsSrc}\nexport { roomRow };\n`);
  groups = await import(pathToFileURL(path.join(dir, 'views', 'groups.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const LISTINGS = [{ unit_id: 'u-1', unit_name: '1201', property_id: 'p-1', property_name: 'Azure', room_type: 'Studio' }];
const TYPES = [{ property_id: 'p-1', room_type: 'Studio', count: 3 }];
const DEFAULTS = { check_in: '2028-07-05', check_out: '2028-07-06', num_guests: 2 };

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

test('a row with check-out before check-in and no listing names both, each on its own box', () => {
  const r = rowWith(1, { co: '2028-07-04', unit: '' });
  assert.deepEqual(r.problems(), {
    [boxKey(r, 'check_out-')]: 'Check-out must be after check-in.',
    [boxKey(r, 'unit_id-')]: 'Choose a listing for room 1.',
  });
});

test('a row with every problem it can name reports all of them', () => {
  const r = rowWith(2, { mode: 'type', type: '', count: '0', guests: '0', price: '0', ci: '', co: '' });
  const p = r.problems();
  assert.ok(p[boxKey(r, 'check_in-')], 'missing check-in');
  assert.ok(p[boxKey(r, 'check_out-')], 'missing check-out');
  assert.ok(p[boxKey(r, 'num_guests-')], 'guests');
  assert.ok(p[boxKey(r, 'accommodation_total-')], 'zero total');
  assert.equal(p[boxKey(r, 'room_type-')], 'Choose a room type for room 2.');
  assert.equal(p[boxKey(r, 'count-')], 'Count must be a whole number from 1 to 20.');
});

test('a valid row has no problems and builds the same rooms as before', () => {
  const r = rowWith(1, {});
  assert.deepEqual(r.problems(), {});
  assert.deepEqual(r.rooms(), [{ check_in: '2028-07-05', check_out: '2028-07-06', num_guests: 2, unit_id: 'u-1' }]);
  assert.equal(rowWith(1, { mode: 'type', count: '3' }).rooms().length, 3);
});

test('a missing lead guest name and two rows with no listing give three messages in one pass', () => {
  const rows = [rowWith(1, { unit: '' }), rowWith(2, { unit: '' })];
  const p = groups.groupProblems({ guest_name: 'Lead guest name is required.' }, rows);
  assert.equal(Object.keys(p).length, 3);
  assert.equal(p.guest_name, 'Lead guest name is required.');
  assert.deepEqual(Object.values(p).slice(1), ['Choose a listing for room 1.', 'Choose a listing for room 2.']);
});

test('fewer than 2 rooms in total adds the count line to the same pass; a good group has none', () => {
  assert.equal(groups.groupProblems({}, [rowWith(1, {})])._rooms, 'A group needs between 2 and 20 rooms.');
  assert.deepEqual(groups.groupProblems({}, [rowWith(1, {}), rowWith(2, {})]), {});
  assert.equal(groups.groupProblems({}, [rowWith(1, { mode: 'type', count: '3' })])._rooms, undefined);
});

test('rooms() still refuses with the same first message as before', () => {
  assert.throws(() => rowWith(1, { ci: '' }).rooms(), { message: 'Enter the check-in and check-out dates.' });
  assert.throws(() => rowWith(1, { price: '0' }).rooms(), { message: /greater than zero/ });
});

test('onSubmit and the form check both use the one pass', () => {
  assert.match(groupsSrc, /check: \(d\) => \{ const bad = collect\(d\)/);
  assert.match(groupsSrc, /const bad = collect\(d\);[\s\S]{0,200}new ApiError\('Please check the highlighted fields\.'/);
});
