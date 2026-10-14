'use strict';

// QA round 5, inbox and filters lane (C10). Frontend-only: no database, no server.
// public/js is copied to a temp folder with app.js replaced by a stub, and a small stand-in for the DOM is set up
// the same way test/qa-r1-filters-daterange.test.js and test/qa-r4-c06.test.js do.
// #11: "Last message" is one date range, so a backwards pair is flagged with its message instead of dropped silently.
// #44: the repeated Edit, Delete, Turn on and Turn off buttons on the templates and automations screen name their row.
// #46: the two boxes of a date range are named "<label>, from" and "<label>, to".

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const MSG = 'The end date is before the start date. This date filter is off until you fix it.';
const SAVED_KEY = 'bh-filters:1:inbox';
const INBOX_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js'), 'utf8');

// Just enough DOM for h(), ui.js, filters.js and the inbox settings view: elements, text, attributes, listeners.
class Node { }
class Text extends Node { constructor(data) { super(); this.data = data; } }
const toNode = (n) => (n instanceof Node ? n : new Text(String(n)));
class Element extends Node {
  constructor(tag) {
    super();
    Object.assign(this, { tagName: tag, attrs: {}, children: [], listeners: {}, style: {}, dataset: {}, className: '' });
  }
  get hidden() { return 'hidden' in this.attrs; }
  set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type) { for (const fn of this.listeners[type] || []) fn({ target: this, type }); }
  append(...nodes) { this.children.push(...nodes.map(toNode)); }
  replaceChildren(...nodes) { this.children = nodes.map(toNode); }
}
globalThis.Node = Node;
globalThis.Element = Element;
globalThis.document = {
  createElement: (tag) => new Element(tag),
  createElementNS: (ns, tag) => new Element(tag),
  createTextNode: (data) => new Text(data),
  getElementById: () => null,
};

const textOf = (node) => (node instanceof Text ? node.data : node.children.map(textOf).join(''));
const walk = (node, pred, out = []) => {
  if (node instanceof Element) {
    if (pred(node)) out.push(node);
    node.children.forEach((c) => walk(c, pred, out));
  }
  return out;
};

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const TEMPLATES = [
  { template_id: 't1', name: 'Booking confirmation', subject: 'Your booking', body: 'Hi', system_key: 'booking_confirmation' },
  { template_id: 't2', name: 'Check-in notes', subject: 'Arriving soon', body: 'See you' },
];
const AUTOMATIONS = [
  { automation_id: 'a1', name: 'Check-in reminder', template_id: 't2', template_name: 'Check-in notes', trigger_event: 'before_check_in', offset_days: 1, send_time: '10:00', enabled: true, sent_count: 0 },
  { automation_id: 'a2', name: 'Thank you', template_id: 't2', template_name: 'Check-in notes', trigger_event: 'after_check_out', offset_days: 1, send_time: '10:00', enabled: false, sent_count: 0 },
];

let dir; let filters; let inbox;
test.before(async () => {
  globalThis.fetch = async (url) => {
    const body = { '/api/message-templates': { templates: TEMPLATES, variables: ['guest_name'] }, '/api/automations': { automations: AUTOMATIONS, can_edit: true, sending: true } }[url];
    return { ok: body !== undefined, status: body ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => body || {} };
  };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r5-c10-'));
  fs.cpSync(path.join(__dirname, '..', 'public', 'js'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'app.js'), [
    "export const state = { user: { user_id: 1, role: 'owner' }, requireEmailVerification: true };",
    'export const navigate = () => {};',
    'export const refreshUser = async () => {};',
    'export const logout = async () => {};',
    'export const afterLogin = async () => {};',
    "export const homeRoute = () => '#/home';",
  ].join('\n'));
  filters = await import(pathToFileURL(path.join(dir, 'filters.js')));
  inbox = await import(pathToFileURL(path.join(dir, 'views', 'inbox.js')));
});
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => { store.clear(); });

// The inbox's own Last message filter, as inboxView declares it.
const MSG_FIELD = { name: 'msg', keys: ['msg_from', 'msg_to'], label: 'Last message between', type: 'daterange' };
const MSG_DEFAULTS = { msg_from: '', msg_to: '' };
const RANGE = { name: 'from', keys: ['from', 'to'], label: 'Check-in between', type: 'daterange' };
const DEFAULTS = { from: '', to: '' };

// Builds a filter bar with one date range under "More filters" and returns handles to its parts.
function build(values, field, defaults) {
  const calls = { n: 0 };
  const bar = filters.filterBar({ key: 'inbox', values, defaults, more: [field], onChange: () => { calls.n += 1; } });
  const input = (label, side) => walk(bar, (el) => el.tagName === 'input' && el.getAttribute('aria-label') === `${label}, ${side}`)[0];
  return {
    bar,
    calls,
    values,
    from: input(field.label, 'from'),
    to: input(field.label, 'to'),
    alert: () => walk(bar, (el) => el.getAttribute('role') === 'alert')[0],
    panel: () => walk(bar, (el) => el.className.split(' ').includes('flt__panel'))[0],
    chips: () => walk(bar, (el) => el.className === 'flt__chips')[0],
    chipButtons: () => walk(bar, (el) => el.tagName === 'button' && el.className === 'flt__chip'),
  };
}

// ---------------------------------------------------------------- #11 Last message range
test('#11: the Last message filter is one date range over msg_from and msg_to, as reservations does it', () => {
  assert.match(INBOX_SRC, /\{ name: 'msg', keys: \['msg_from', 'msg_to'\], label: 'Last message between', type: 'daterange' \}/);
  assert.doesNotMatch(INBOX_SRC, /name: 'msg_(from|to)'/, 'the two single date filters are gone');
});

test('#11: a backwards Last message range from a shared link is flagged with its message, not dropped silently', () => {
  const values = filters.initFilters('inbox', { msg_from: '2026-10-20', msg_to: '2026-10-10' }, MSG_DEFAULTS);
  const b = build(values, MSG_FIELD, MSG_DEFAULTS);
  assert.equal(values.msg_from, '', 'the backwards range is not applied');
  assert.equal(values.msg_to, '');
  assert.equal(b.alert().hidden, false, 'the message is shown');
  assert.equal(textOf(b.alert()), MSG);
  assert.equal(b.from.value, '2026-10-20', 'the typed start date stays on screen so it can be fixed');
  assert.equal(b.to.value, '2026-10-10');
  assert.equal(b.panel().hidden, false, 'the panel opens so the message can be seen');
  assert.equal(b.chipButtons().length, 0, 'no chip for a range that is not applied');
  assert.equal(b.calls.n, 0);
});

test('#11: a backwards Last message range typed into the bar is flagged inline and not applied', () => {
  const values = { msg_from: '', msg_to: '' };
  const b = build(values, MSG_FIELD, MSG_DEFAULTS);
  b.from.value = '2026-10-20';
  b.from.dispatch('change');
  b.to.value = '2026-10-10';
  b.to.dispatch('change');
  assert.equal(values.msg_from, '');
  assert.equal(values.msg_to, '');
  assert.equal(JSON.parse(store.get(SAVED_KEY)).msg_to, '', 'the end date is not remembered either');
  assert.equal(textOf(b.alert()), MSG);
  assert.equal(b.to.getAttribute('aria-invalid'), 'true');
});

test('#11: a valid Last message range is applied under both URL keys and shows as one chip', () => {
  const values = filters.initFilters('inbox', { msg_from: '2026-10-01', msg_to: '2026-10-10' }, MSG_DEFAULTS);
  const b = build(values, MSG_FIELD, MSG_DEFAULTS);
  assert.equal(values.msg_from, '2026-10-01');
  assert.equal(values.msg_to, '2026-10-10');
  assert.equal(b.chipButtons().length, 1, 'one chip for the range, not one per date');
  assert.match(textOf(b.chipButtons()[0]), /^Last message between: /);
  assert.equal(b.alert().hidden, true);
});

// ---------------------------------------------------------------- #46 date range box names
test('#46: the two boxes of a date range are named "<label>, from" and "<label>, to"', () => {
  const values = { from: '', to: '' };
  const b = build(values, RANGE, DEFAULTS);
  assert.ok(b.from, 'a box named "Check-in between, from" exists');
  assert.ok(b.to, 'a box named "Check-in between, to" exists');
  assert.equal(b.from.getAttribute('aria-label'), 'Check-in between, from');
  assert.equal(b.to.getAttribute('aria-label'), 'Check-in between, to');
});

test('#46: the Last message range boxes are named "Last message between, from" and "..., to"', () => {
  const b = build({ msg_from: '', msg_to: '' }, MSG_FIELD, MSG_DEFAULTS);
  assert.equal(b.from.getAttribute('aria-label'), 'Last message between, from');
  assert.equal(b.to.getAttribute('aria-label'), 'Last message between, to');
});

// ---------------------------------------------------------------- #44 row buttons name their row
test('#44: repeated Edit, Delete, Turn on and Turn off buttons name the template or automatic message on their row', async () => {
  const el = document.createElement('div');
  await inbox.inboxSettingsView(el, { rerender() {} });
  const rowButtons = walk(el, (n) => n.tagName === 'button' && ['Edit', 'Delete', 'Turn on', 'Turn off'].includes(textOf(n)))
    .map((b) => [textOf(b), b.getAttribute('aria-label')]);
  assert.deepEqual(rowButtons, [
    ['Turn off', 'Turn off automatic message: Check-in reminder, 1 day before check-in at 10:00'],
    ['Edit', 'Edit automatic message: Check-in reminder, 1 day before check-in at 10:00'],
    ['Delete', 'Delete automatic message: Check-in reminder, 1 day before check-in at 10:00'],
    ['Turn on', 'Turn on automatic message: Thank you, 1 day after check-out at 10:00'],
    ['Edit', 'Edit automatic message: Thank you, 1 day after check-out at 10:00'],
    ['Delete', 'Delete automatic message: Thank you, 1 day after check-out at 10:00'],
    ['Edit', 'Edit template: Booking confirmation'],
    ['Edit', 'Edit template: Check-in notes'],
    ['Delete', 'Delete template: Check-in notes'],
  ]);
});
