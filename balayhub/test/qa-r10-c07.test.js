'use strict';

// QA round 10, lane C07 (quotes and groups views, public/js/views/quotes.js and groups.js). Frontend only: no database, no server.
// #3: the date check ("Check-out must be after check-in.") runs in makeForm's first pass, with the required check, so a blank
//     Accommodation box no longer hides it. Quotes and the New group form pass it through makeForm's check hook.
// #4: the group detail header counts every room of a cancelled group and says ", cancelled".
// Behaviour runs on temp copies of quotes.js and groups.js (the real modules import the app shell, which does not load in Node),
// with the stand-in DOM from test/qa-r3-groups-view.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '..', 'public', 'js');
const quotesSrc = fs.readFileSync(path.join(SRC, 'views', 'quotes.js'), 'utf8');
const groupsSrc = fs.readFileSync(path.join(SRC, 'views', 'groups.js'), 'utf8');
const between = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
const CHECK_OUT_MSG = 'Check-out must be after check-in.';

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

const LISTINGS = [{ unit_id: 'u-1', unit_name: '1201', property_id: 'p-1', property_name: 'Azure' }];
const ROOM_TYPES = [{ property_id: 'p-1', room_type: 'Studio', count: 2 }];
const DEFAULTS = { check_in: '2028-07-05', check_out: '2028-07-06', num_guests: 2 };

let dir; let quotes; let groups;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c07-r10-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner' } };\nexport const navigate = () => {};\n");
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), 'export function guestsProblem(value) { const n = String(value ?? "").trim(); return /^\\d+$/.test(n) && Number(n) >= 1 ? null : "At least 1 guest."; }\nexport function addDays(d, n) { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }\nexport function boxValue({ typed, mode, suggestion, current }) { if (typed) return current; return mode === "type" || suggestion == null ? "" : String(suggestion); }\n');
  fs.writeFileSync(path.join(dir, 'views', 'quotes.js'), quotesSrc);
  fs.writeFileSync(path.join(dir, 'views', 'groups.js'), `${groupsSrc}\nexport { roomRow };\n`);
  quotes = await import(pathToFileURL(path.join(dir, 'views', 'quotes.js')));
  groups = await import(pathToFileURL(path.join(dir, 'views', 'groups.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// One room row with its check-in and check-out set; returns roomRow()'s handle.
function roomWith(values = {}) {
  const r = groups.roomRow({ listings: LISTINGS, roomTypes: ROOM_TYPES, defaults: DEFAULTS });
  const set = { ci: '2028-07-05', co: '2028-07-06', ...values };
  for (const [k, prefix] of [['ci', 'gr-ci-'], ['co', 'gr-co-']]) {
    const [el] = walk(r.el, (n) => n.attrs.id?.startsWith(prefix));
    el.value = set[k];
  }
  return r;
}

// ---------------------------------------------------------------- #3: the date check runs in the first pass
test('#3 a stay that runs no night gets the check-out message; a blank date or a real stay gets none', () => {
  assert.equal(quotes.datesProblem('2028-07-05', '2028-07-05'), CHECK_OUT_MSG);
  assert.equal(quotes.datesProblem('2028-07-06', '2028-07-05'), CHECK_OUT_MSG);
  assert.equal(quotes.datesProblem('2028-07-05', '2028-07-06'), null);
  assert.equal(quotes.datesProblem('', '2028-07-06'), null, "a blank check-in is the required check's job");
  assert.equal(quotes.datesProblem('2028-07-05', ''), null, "a blank check-out is the required check's job");
});

test("#3 quotes passes its date check through makeForm's check hook, naming check_out, and no longer checks after the required pass", () => {
  const form = between(quotesSrc, 'const form = makeForm({', "modal = openModal({ title: 'New quote'");
  assert.match(form, /check: \(d\) => \{ const msg = datesProblem\(d\.check_in, d\.check_out\); return msg \? \{ check_out: msg \} : null; \}/);
  assert.doesNotMatch(form, /nightsBetween\(d\.check_in, d\.check_out\)/, 'onSubmit runs after the required pass, so the date check must not live there');
});

test("#3 the New group form checks every room's dates in the same first pass as the required check", () => {
  const ng = between(groupsSrc, 'export async function newGroupModal', "modal = openModal({ title: 'New group booking'");
  assert.match(ng, /check: \(\) => \{ const bad = Object\.assign\(\{\}, \.\.\.rows\.map\(\(r\) => r\.dateProblem\(\)\)\); return Object\.keys\(bad\)\.length \? bad : null; \}/);
});

test("#3 a room row marks a backwards stay on its own check-out box, and reports nothing for a real or blank stay", () => {
  const bad = roomWith({ co: '2028-07-05' }).dateProblem();
  const [key] = Object.keys(bad);
  assert.match(key, /^check_out-/);
  assert.deepEqual(bad, { [key]: CHECK_OUT_MSG });
  assert.equal(roomWith({ co: '2028-07-07' }).dateProblem(), null);
  assert.equal(roomWith({ co: '' }).dateProblem(), null, "a blank date is rooms()'s job");
});

test('#3 the check-out box is a field the form can mark: its wrapper carries the row key and holds the input and its own error line', () => {
  const r = roomWith({ co: '2028-07-05' });
  const [key] = Object.keys(r.dateProblem());
  const [wrap] = walk(r.el, (n) => n.dataset.field === key);
  assert.ok(wrap, 'the wrapper carries the key showErrors looks for');
  assert.equal(walk(wrap, (n) => n.tagName === 'input' && n.attrs.id?.startsWith('gr-co-')).length, 1, 'the check-out input is inside it');
  assert.equal(walk(wrap, (n) => n.attrs.role === 'alert' && n.attrs.id?.endsWith('-err')).length, 1, 'and so is the error line');
});

// ---------------------------------------------------------------- #4: the cancelled group header
test('#4 the header counts every room of a cancelled group and says so; an active group counts the rooms still booked', () => {
  assert.equal(groups.roomsLine([{ status: 'cancelled' }, { status: 'cancelled' }], true), '2 rooms, cancelled');
  assert.equal(groups.roomsLine([{ status: 'cancelled' }], true), '1 room, cancelled');
  assert.equal(groups.roomsLine([{ status: 'confirmed' }, { status: 'cancelled' }], false), '1 room');
  assert.equal(groups.roomsLine([{ status: 'confirmed' }, { status: 'confirmed' }], false), '2 rooms');
});

test('#4 the detail header uses roomsLine with the cancelled flag, not a count of active rooms', () => {
  const detail = groupsSrc.slice(groupsSrc.indexOf('export async function groupDetailView'));
  assert.match(detail, /`\$\{guest \? `Lead guest \$\{guest\.full_name\} · ` : ''\}\$\{roomsLine\(rooms, cancelled\)\}`/);
  // The Cancel group dialog still says "All N rooms will be cancelled" from the active count, so only the header line is checked.
  assert.doesNotMatch(detail, /Lead guest[^\n]*\$\{active\.length\}/, 'the header line no longer counts active rooms only');
});
