'use strict';

// QA round 3, lane C06 (groups view, public/js/views/groups.js). Frontend only: no database, no server.
// calendar#1: a room-type count is a whole number from 1 to 20. Anything else is refused with a message and nothing is sent;
//             it is never clamped into range (0 used to book one room, 21 used to book 20).
// calendar#4: a blank date and a backwards pair get different messages.
// calendar#2 (client): a typed accommodation total of 0 is refused before anything is sent. A server field message for a
//             room (rooms.N.accommodation_total) still reaches the dialog, because the error object is passed on unchanged.
// Behaviour runs on a temp copy of groups.js with roomRow() exported from the copy only: the real module imports the app shell,
// which does not load in Node. The stand-in DOM follows test/qa-r2-filters.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '..', 'public', 'js');
const groupsSrc = fs.readFileSync(path.join(SRC, 'views', 'groups.js'), 'utf8');
const between = (from, to) => groupsSrc.slice(groupsSrc.indexOf(from), groupsSrc.indexOf(to, groupsSrc.indexOf(from)));

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

const LISTINGS = [{ unit_id: 'u-1', unit_name: '1201', property_id: 'p-1', property_name: 'Azure', room_type: 'Studio' }];
const ROOM_TYPES = [{ property_id: 'p-1', room_type: 'Studio', count: 2 }];
const DEFAULTS = { check_in: '2028-07-05', check_out: '2028-07-06', num_guests: 2 };
const ZERO_PRICE = "Accommodation total must be greater than zero. Leave it blank to use the listing's price.";

let dir; let groups;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-groups-r3-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner' } };\nexport const navigate = () => {};\n");
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), 'export function guestsProblem(value) { const n = String(value ?? "").trim(); return /^\\d+$/.test(n) && Number(n) >= 1 ? null : "At least 1 guest."; }\nexport function addDays(d, n) { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }\nexport function boxValue({ typed, mode, suggestion, current }) { if (typed) return current; return mode === "type" || suggestion == null ? "" : String(suggestion); }\n');
  fs.writeFileSync(path.join(dir, 'views', 'groups.js'), `${groupsSrc}\nexport { roomRow };\n`);
  groups = await import(pathToFileURL(path.join(dir, 'views', 'groups.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// One room row with every control set; `values` overrides any of them. Returns roomRow()'s handle.
function roomWith(values = {}) {
  const r = groups.roomRow({ listings: LISTINGS, roomTypes: ROOM_TYPES, defaults: DEFAULTS });
  const ids = { mode: 'gr-mode-', unit: 'gr-unit-', type: 'gr-type-', count: 'gr-count-', ci: 'gr-ci-', co: 'gr-co-', price: 'gr-price-', clean: 'gr-clean-' };
  const set = { mode: 'type', unit: 'u-1', type: 'p-1|Studio', count: '2', ci: '2028-07-05', co: '2028-07-06', price: '', clean: '', ...values };
  for (const [k, prefix] of Object.entries(ids)) {
    const [el] = walk(r.el, (n) => n.attrs.id?.startsWith(prefix));
    el.value = set[k];
  }
  return r;
}

// ---------------------------------------------------------------- calendar#1: the room-type count
test('a room-type count that is not a whole number from 1 to 20 is refused, and no rooms are returned', () => {
  for (const count of ['0', '-1', '21', '', '1.5', 'abc']) {
    assert.throws(() => roomWith({ count }).rooms(), { message: 'Count must be a whole number from 1 to 20.' }, `count "${count}"`);
  }
});

test('a room-type count of 1 or 20 books that many rows, each for the same dates and room type', () => {
  for (const n of [1, 20]) {
    const rows = roomWith({ count: String(n) }).rooms();
    assert.equal(rows.length, n);
    assert.deepEqual(rows[0], { check_in: '2028-07-05', check_out: '2028-07-06', num_guests: 2, property_id: 'p-1', room_type: 'Studio' });
  }
});

test('the count is ignored for a specific listing, so a stale count typed before switching does not block it', () => {
  const rows = roomWith({ mode: 'unit', count: '0' }).rooms();
  assert.deepEqual(rows.map((x) => x.unit_id), ['u-1']);
});

test('the count is never clamped into range in the source', () => {
  assert.doesNotMatch(groupsSrc, /Math\.(min|max)\([^)]*count\.value/);
});

// ---------------------------------------------------------------- calendar#4: blank and backwards dates
test('a blank check-in or check-out asks for the dates, not for a check-out after check-in', () => {
  for (const values of [{ ci: '' }, { co: '' }, { ci: '', co: '' }]) {
    assert.throws(() => roomWith(values).rooms(), { message: 'Enter the check-in and check-out dates.' }, JSON.stringify(values));
  }
});

test('a check-out on or before check-in says check-out must be after check-in', () => {
  for (const co of ['2028-07-04', '2028-07-05']) {
    assert.throws(() => roomWith({ co }).rooms(), { message: 'Check-out must be after check-in.' }, `check-out ${co}`);
  }
});

// ---------------------------------------------------------------- calendar#2 (client): a zero accommodation total
test('a typed accommodation total of 0 is refused before anything is sent', () => {
  for (const price of ['0', '0.00', ' 0 ']) {
    assert.throws(() => roomWith({ price }).rooms(), { message: ZERO_PRICE }, `price "${price}"`);
  }
});

test('a blank accommodation total sends no total; a positive one is sent as typed', () => {
  const blank = roomWith({ price: '  ' }).rooms();
  assert.equal('accommodation_total' in blank[0], false);
  assert.equal(roomWith({ price: '1200' }).rooms()[0].accommodation_total, '1200');
});

// ---------------------------------------------------------------- server field messages still reach the dialog
test('adding a room rethrows the server error unchanged, so its rooms.N field message reaches the form', () => {
  const addRoom = between('async function addRoomModal', '// ---------------------------------------------------------------- list');
  // makeForm() shows err.fields that are not on the form, which needs the same ApiError (fields and summary) to come through.
  assert.match(addRoom, /await post\(`\/booking-groups\/\$\{g\.group_id\}\/rooms`, \{ rooms: list \}\);\n\s*\} catch \(err\) \{/);
  assert.doesNotMatch(addRoom, /new ApiError\(err/);
  assert.match(addRoom, /refreshOnClose = true;\n\s*throw err;/);
});
