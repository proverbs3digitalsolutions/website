'use strict';

require('./helpers');

// QA round 40, CALNAMES (ONB-1, D-122). The calendar's two week buttons move the grid seven days, but a screen reader heard
// them as "Earlier" and "Later". They are named "Previous week" and "Next week", as on Housekeeping (housekeeping.js 492-494).
// The glyphs (‹ and ›) and the seven-day move do not change. The test mounts the real calendar view from a temp copy, with the
// network, the filter bar and the reservations module stubbed, then reads each button's name and presses it.
// CALNAMES_SRC is for the proof run only (a copy of the 30ba605 calendar.js with the old names).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '..', 'public', 'js');
const calendarSrc = fs.readFileSync(process.env.CALNAMES_SRC || path.join(SRC, 'views', 'calendar.js'), 'utf8');

// Just enough DOM for h() in ui.js and for the calendar grid: elements, attributes, listeners, children, text.
class FakeNode { }
class FakeText extends FakeNode { constructor(data) { super(); this.data = data; } }
const toNode = (n) => (n instanceof FakeNode ? n : new FakeText(String(n)));
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    Object.assign(this, { tagName: tag.toUpperCase(), attrs: {}, children: [], listeners: {}, dataset: {}, className: '' });
    this.style = { setProperty(k, v) { this[k] = v; } };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  append(...nodes) { this.children.push(...nodes.map(toNode)); }
  replaceChildren(...nodes) { this.children = nodes.map(toNode); }
  // The grid's own lookups (today's column, drag markers) are not reached by this test.
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
globalThis.Node = FakeNode;
globalThis.Element = FakeElement;
globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  createElementNS: (ns, tag) => new FakeElement(tag),
  createTextNode: (data) => new FakeText(data),
};
globalThis.window = globalThis;
globalThis.matchMedia = () => ({ matches: false });
globalThis.history = { replaceState() {} };

const textOf = (n) => (n instanceof FakeText ? n.data : n.children.map(textOf).join(''));
const walk = (node, out = []) => {
  if (node instanceof FakeElement) { out.push(node); node.children.forEach((c) => walk(c, out)); }
  return out;
};

// What the view asks the server for. The grid starts on 2028-07-05 and echoes back the start it is asked for.
const FIRST = '2028-07-05';
const LISTING = { unit_id: 'u-1', unit_name: 'Unit 1', unit_type: 'Studio', property_id: 'p-1', property_name: 'Azure', cleaning_status: 'clean', nightly_rate: 2000 };
const requests = [];
globalThis.__calnamesGet = async (url) => {
  requests.push(url);
  const [route, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  if (route === '/listings') return { listings: [LISTING] };
  if (route === '/tags') return { tags: [] };
  if (route === '/sync-health') return { problems: [] };
  if (route === '/calendar') {
    return { start: params.get('start') || FIRST, days: Number(params.get('days')) || 14, today: '2028-07-01', listings: [LISTING], rates: [], bookings: [] };
  }
  throw new Error(`unexpected request ${url}`);
};
const lastStart = () => new URLSearchParams(requests.filter((u) => u.startsWith('/calendar')).pop().split('?')[1]).get('start');

// A temp copy of calendar.js with the modules it imports stubbed. ui.js and rates.js are the real files.
const RESERVATIONS_STUB = [
  'export function addDays(d, n) { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }',
  'export function newReservationModal() {}',
  'export const CHANNEL_LABEL = {};',
].join('\n');
const API_STUB = [
  'export class ApiError extends Error {}',
  'export const newIdempotencyKey = () => "key";',
  'export const inFlight = () => false;',
  'export const get = (url) => globalThis.__calnamesGet(url);',
  'export const post = async () => ({});',
  'export const patch = async () => ({});',
  'export const api = async () => ({});',
  'export function qs(params) { const p = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, v); const s = p.toString(); return s ? `?${s}` : ""; }',
].join('\n');
const FILTERS_STUB = [
  'export function initFilters(key, query, defaults) { return { ...defaults }; }',
  'export function filterBar() { return document.createElement("div"); }',
  'export function changed() { return {}; }',
].join('\n');

let cal; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-calnames-r40-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['ui.js', 'rates.js']) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'api.js'), API_STUB);
  fs.writeFileSync(path.join(dir, 'filters.js'), FILTERS_STUB);
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner' } };\nexport const navigate = () => {};\n");
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), RESERVATIONS_STUB);
  fs.writeFileSync(path.join(dir, 'views', 'calendar.js'), calendarSrc);
  cal = await import(pathToFileURL(path.join(dir, 'views', 'calendar.js')));
});
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

async function mount() {
  requests.length = 0;
  const el = new FakeElement('div');
  await cal.calendarView(el, { query: {} });
  return el;
}
const navButton = (el, glyph) => walk(el).find((n) => n.tagName === 'BUTTON' && textOf(n) === glyph);
// A press runs the handler the way the browser does, then lets the grid load (it is all promises, so one macrotask waits for it).
const press = async (button) => {
  button.listeners.click[0]();
  await new Promise((resolve) => setImmediate(resolve));
};

test('the week buttons are named "Previous week" and "Next week", as on Housekeeping (ONB-1)', async () => {
  const el = await mount();
  const previous = navButton(el, '‹');
  const next = navButton(el, '›');
  assert.ok(previous && next, 'the toolbar has its two week buttons, drawn as ‹ and ›');
  assert.equal(previous.attrs['aria-label'], 'Previous week');
  assert.equal(next.attrs['aria-label'], 'Next week');
});

test('pressing a week button moves the grid seven days back and then seven days forward', async () => {
  const el = await mount();
  await press(navButton(el, '‹'));
  assert.equal(lastStart(), '2028-06-28', 'Previous week: seven days back from the first start');
  await press(navButton(el, '›'));
  assert.equal(lastStart(), FIRST, 'Next week: seven days forward again');
});
