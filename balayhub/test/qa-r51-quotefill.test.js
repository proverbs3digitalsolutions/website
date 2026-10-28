'use strict';
require('./helpers');

// QA round 51, lane QUOTEFILL (public/js/views/quotes.js), contract C2 (D-133). Frontend only: no database rows, no server.
// New quote: a box the page fills (the price check, Use rate-card price) drops its own red mark, message and the banner note,
// as when the host types. A box the page empties keeps its message. A fill is not typing: `typed` is untouched.
// newQuoteModal runs for real (through quotesView?new=1) against stand-ins for api.js, ui.js and filters.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const quotesSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'quotes.js'), 'utf8');

const API_STAND_IN = `
export async function get(url) { return globalThis.__r51.get(url); }
export async function post() { throw new Error('no write expected'); }
export function qs() { return ''; }
export class ApiError extends Error {}
`;
// Boxes sit in a [data-field] wrapper with classList, an .error line and aria-invalid; the form holds the banner note.
const UI_STAND_IN = `
const kids = (xs) => xs.flat(Infinity).filter((k) => k !== false && k !== null && k !== undefined && k !== true);
export function h(tag, props, ...children) {
  const node = { tag, props: props || {}, children: kids(children), textContent: '', after() {}, closest: () => null, setAttribute() {}, removeAttribute() {}, replaceChildren() {} };
  if (props && props.hidden === true && props.onclick) {
    globalThis.__r51.useRate = node;
    Object.defineProperty(node, 'hidden', { get() { return props.hidden; }, set(v) { props.hidden = v; } });
  }
  return node;
}
export const icon = () => null;
export const peso = (n) => 'PHP ' + Number(n);
export const fmtDate = (d) => String(d);
export const fmtDateTime = (d) => String(d);
export const badge = () => null;
export const field = (o) => ({ field: o });
export const openModal = () => ({ close() {} });
export const confirmDialog = async () => true;
export const emptyState = () => null;
export const errorState = () => null;
export const pageError = () => null;
export const pageHead = () => null;
export const toast = () => {};
export const skeleton = () => null;
export const todayManila = () => '2027-01-01';
export const parseAmount = (s) => Number(String(s).replace(/,/g, ''));
export function makeForm({ fields }) {
  const elements = {}; const found = {}; const wraps = [];
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (n.field) {
      const cls = new Set(); const err = { textContent: '' }; const attrs = new Map();
      const wrap = {
        classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) },
        querySelector: (s) => (s === '.error' ? err : null),
        querySelectorAll: (s) => (s === '[aria-invalid]' && attrs.has('aria-invalid') ? [box] : []),
        err, mark(msg) { cls.add('field--invalid'); err.textContent = msg; attrs.set('aria-invalid', 'true'); },
      };
      const box = {
        value: n.field.value ?? '', max: '', listeners: {}, wrap,
        addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
        closest: (s) => (s === '[data-field]' ? wrap : null),
        removeAttribute: (a) => attrs.delete(a), setAttribute: (a, v) => attrs.set(a, v),
        hasAria: () => attrs.has('aria-invalid'),
      };
      elements[n.field.name] = box; wraps.push(wrap); return;
    }
    if (n.props?.class === 'hp-total') found.total = n;
    if (n.props?.class === 'muted small' && !found.preview) found.preview = n;
    walk(n.children);
  };
  walk(fields);
  const note = { gone: false, remove() { this.gone = true; } };
  const form = {
    elements, addEventListener() {}, found, note,
    querySelector(s) {
      if (s === '.field--invalid') return wraps.find((w) => w.classList.contains('field--invalid')) || null;
      if (s === '.form-error [data-field-note]') return note.gone ? null : note;
      return null;
    },
  };
  globalThis.__r51.form = form;
  return form;
}
`;
const FILTERS_STAND_IN = `
export const initFilters = () => ({});
export const filterBar = () => null;
export const rememberFilters = () => {};
export const changed = () => ({});
export const apiFilters = () => ({});
`;

let quotes; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-quo-r51-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'api.js'), API_STAND_IN);
  fs.writeFileSync(path.join(dir, 'ui.js'), UI_STAND_IN);
  fs.writeFileSync(path.join(dir, 'filters.js'), FILTERS_STAND_IN);
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'views', 'quotes.js'), quotesSrc);
  globalThis.history = { replaceState() {} };
  globalThis.location = { hash: '' };
  quotes = await import(pathToFileURL(path.join(dir, 'views', 'quotes.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };

// Open New quote with the form as after a Create press on the empty form: Accommodation and Guest name marked, banner note shown.
async function open(answers) {
  let n = 0;
  globalThis.__r51 = {
    form: null,
    get: async (url) => {
      if (url === '/listings') return { listings: [{ unit_id: 'u1', unit_name: 'QA r51 unit', property_name: 'P', max_guests: 4 }] };
      if (url.startsWith('/quotes')) return { quotes: [] };
      if (url === '/addons') return { addons: [] };
      if (url.includes('/price-preview')) { const a = answers[n++]; if (a instanceof Error) throw a; return a; }
      throw new Error('unexpected ' + url);
    },
  };
  await quotes.quotesView({ replaceChildren() {} }, { query: { new: '1' }, rerender: async () => {} });
  await settle();
  const f = globalThis.__r51.form;
  assert.ok(f, 'New quote modal opened');
  const e = f.elements;
  e.accommodation_total.wrap.mark('Accommodation is required.');
  e.guest_name.wrap.mark('Guest name is required.');
  const change = async (name, value) => { e[name].value = value; for (const fn of e[name].listeners.change || []) fn(); await settle(); };
  const type = (name, value) => { e[name].value = value; for (const fn of e[name].listeners.input || []) fn(); };
  const marked = (name) => e[name].wrap.classList.contains('field--invalid');
  return { f, e, change, type, marked };
}
async function fillDates(t) {
  await t.change('unit_id', 'u1');
  await t.change('check_in', '2027-02-01');
  await t.change('check_out', '2027-02-06');
}

const P1 = { accommodation_total: '8400.00', cleaning_fee: '600.00', missing_rates: false, available: true };
const P2 = { accommodation_total: '10000.00', cleaning_fee: '700.00', missing_rates: false, available: true };

test('the price check fills Accommodation: its mark, message and aria-invalid go; the banner goes with the last marked box', async () => {
  const t = await open([P1]);
  t.e.guest_name.wrap.classList.remove('field--invalid'); // only Accommodation is still marked
  await fillDates(t);
  assert.equal(t.e.accommodation_total.value, '8400.00');
  assert.equal(t.marked('accommodation_total'), false);
  assert.equal(t.e.accommodation_total.hasAria(), false);
  assert.equal(t.e.accommodation_total.wrap.err.textContent, '');
  assert.equal(t.f.note.gone, true, 'banner note gone');
});

test('Guest name still marked: Accommodation is cleared, the banner stays', async () => {
  const t = await open([P1]);
  await fillDates(t);
  assert.equal(t.marked('accommodation_total'), false);
  assert.equal(t.marked('guest_name'), true);
  assert.equal(t.e.guest_name.wrap.err.textContent, 'Guest name is required.');
  assert.equal(t.f.note.gone, false, 'banner stays while another box is marked');
});

test('a refused price check empties the boxes and keeps the message on the emptied box', async () => {
  const t = await open([new Error('No rate.')]);
  t.e.accommodation_total.value = '';
  await fillDates(t);
  assert.equal(t.e.accommodation_total.value, '');
  assert.equal(t.marked('accommodation_total'), true);
  assert.equal(t.e.accommodation_total.wrap.err.textContent, 'Accommodation is required.');
});

test('a fill is not typing: a later price check still rewrites Accommodation', async () => {
  const t = await open([P1, P2]);
  await fillDates(t);
  assert.equal(t.e.accommodation_total.value, '8400.00');
  await t.change('check_out', '2027-02-07');
  assert.equal(t.e.accommodation_total.value, '10000.00', 'still follows the price check');
});

test('Use rate-card price on a marked box clears it', async () => {
  const t = await open([P1, P2]);
  await fillDates(t);
  t.type('accommodation_total', '5000'); // typed: a later check offers the button instead of rewriting
  t.e.accommodation_total.wrap.mark('Accommodation is required.');
  await t.change('check_out', '2027-02-07');
  const btn = globalThis.__r51.useRate;
  assert.equal(btn.props.hidden, false, 'rate-card offer shown');
  btn.props.onclick();
  assert.equal(t.e.accommodation_total.value, '10000.00');
  assert.equal(t.marked('accommodation_total'), false);
  assert.equal(t.e.accommodation_total.wrap.err.textContent, '');
});
