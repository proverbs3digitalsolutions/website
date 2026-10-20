'use strict';

// QA round 28, lane 8 GROUPS (public/js/views/groups.js). Frontend only: no database, no server.
// BKG-3: a money box with a bad amount is marked on its own field in the same pass (Accommodation total and Cleaning fee). Behaviour runs on a temp copy of the view with the stand-in DOM of test/qa-r11-c16.test.js.

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-groups-r28-'));
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
const BAD = 'must be a valid amount (e.g. 8500 or 8500.50).';

test('Accommodation total 2125.005 is marked on the total box', () => {
  const r = rowWith(1, { price: '2125.005' });
  assert.deepEqual(r.problems(), { [boxKey(r, 'accommodation_total-')]: `Accommodation total ${BAD}` });
});

test('a negative total, a typed 0 and good amounts', () => {
  const k = (r) => boxKey(r, 'accommodation_total-');
  let r = rowWith(1, { price: '-5' });
  assert.equal(r.problems()[k(r)], 'Accommodation total cannot be negative.');
  r = rowWith(1, { price: '0' });
  assert.match(r.problems()[k(r)], /greater than zero/);
  for (const v of ['2125', '2125.5', '']) assert.deepEqual(rowWith(1, { price: v }).problems(), {});
});

test('Cleaning fee 1.234 is marked on its own keyed box; fieldKey maps cleaning_fee to it', () => {
  const r = rowWith(1, { clean: '1.234' });
  const key = boxKey(r, 'cleaning_fee-');
  assert.ok(key, 'cleaning box has a key');
  assert.deepEqual(r.problems(), { [key]: `Cleaning fee ${BAD}` });
  assert.equal(r.fieldKey('cleaning_fee'), key);
  const input = walk(r.el, (n) => n.attrs.id?.startsWith('gr-clean-') && !n.attrs.id.endsWith('-err'))[0];
  assert.match(input.attrs['aria-describedby'], /^gr-clean-.*-err$/);
  assert.equal(rowWith(1, { clean: '500' }).problems()['cleaning_fee'], undefined);
});

test('groupProblems collects both money problems in one pass', () => {
  const r = rowWith(1, { price: '2125.005', clean: '1.234' });
  const p = groups.groupProblems({}, [r]);
  assert.ok(p[boxKey(r, 'accommodation_total-')] && p[boxKey(r, 'cleaning_fee-')]);
});
