'use strict';
require('./helpers');

// QA round 49, lane QUOTECLEAN (public/js/views/quotes.js), contract C8 (D-131). Frontend only: no database rows, no server.
// New quote: each price box keeps its own typed mark. A typed Accommodation does not keep an old Cleaning fee suggestion;
// a typed Cleaning fee does not stop Accommodation following the price check.
// newQuoteModal runs for real (through quotesView?new=1) against stand-ins for api.js, ui.js and filters.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const quotesSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'quotes.js'), 'utf8');

const API_STAND_IN = `
export async function get(url) { return globalThis.__r49.get(url); }
export async function post(url, body) { return globalThis.__r49.post(url, body); }
export function qs() { return ''; }
export class ApiError extends Error {}
`;
// h() builds a plain tree; field()/makeForm() give the modal a form whose boxes are plain objects with listeners.
const UI_STAND_IN = `
const kids = (xs) => xs.flat(Infinity).filter((k) => k !== false && k !== null && k !== undefined && k !== true);
export function h(tag, props, ...children) {
  const node = { tag, props: props || {}, children: kids(children), textContent: '', after() {}, closest: () => null, setAttribute() {}, replaceChildren() {} };
  if (props && props.hidden === true && props.onclick) globalThis.__r49.useRate = node;
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
  const elements = {}; const found = {};
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (n.field) {
      const box = { value: n.field.value ?? '', max: '', listeners: {}, addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); } };
      elements[n.field.name] = box; return;
    }
    if (n.props?.class === 'hp-total') found.total = n;
    if (n.props?.class === 'muted small' && !found.preview) found.preview = n;
    walk(n.children);
  };
  walk(fields);
  const form = { elements, addEventListener() {}, found };
  globalThis.__r49.form = form;
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-quo-r49-'));
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

// Open New quote, price 5 nights, return { f, say } with the boxes. `answers` serves price-preview calls in order.
async function open(answers) {
  let n = 0;
  globalThis.__r49 = {
    form: null,
    get: async (url) => {
      if (url === '/listings') return { listings: [{ unit_id: 'u1', unit_name: 'QA r48 unit', property_name: 'P', max_guests: 4 }] };
      if (url.startsWith('/quotes')) return { quotes: [] };
      if (url === '/addons') return { addons: [] };
      if (url.includes('/price-preview')) { const a = answers[n++]; if (a instanceof Error) throw a; return a; }
      throw new Error('unexpected ' + url);
    },
    post: async () => { throw new Error('no write expected'); },
  };
  await quotes.quotesView({ replaceChildren() {} }, { query: { new: '1' }, rerender: async () => {} });
  await settle();
  const f = globalThis.__r49.form;
  assert.ok(f, 'New quote modal opened');
  const change = async (name, value) => { f.elements[name].value = value; for (const fn of f.elements[name].listeners.change || []) fn(); await settle(); };
  const type = (name, value) => { f.elements[name].value = value; for (const fn of f.elements[name].listeners.input || []) fn(); };
  await change('unit_id', 'u1');
  await change('check_in', '2027-02-01');
  await change('check_out', '2027-02-06');
  return { f, change, type };
}

const P1 = { accommodation_total: '8400.00', cleaning_fee: '600.00', missing_rates: false, available: true };
const P2 = { accommodation_total: '10000.00', cleaning_fee: '700.00', missing_rates: false, available: true };
const REFUSAL = new Error('Stays are limited to one year.');

test('typed Accommodation, then a refused check: Cleaning fee empties, Accommodation stays', async () => {
  const { f, change, type } = await open([P1, REFUSAL]);
  assert.equal(f.elements.accommodation_total.value, '8400.00');
  assert.equal(f.elements.cleaning_fee.value, '600.00');
  type('accommodation_total', '9000');
  await change('check_out', '2028-02-20');
  assert.equal(f.elements.accommodation_total.value, '9000');
  assert.equal(f.elements.cleaning_fee.value, '');
  assert.equal(f.found.total.textContent, 'Total for the guest: PHP 9000');
});

test('typed Cleaning fee only, then a new price: Accommodation follows, Cleaning fee stays', async () => {
  const { f, change, type } = await open([P1, P2]);
  type('cleaning_fee', '500');
  await change('check_out', '2027-02-07');
  assert.equal(f.elements.accommodation_total.value, '10000.00');
  assert.equal(f.elements.cleaning_fee.value, '500');
});

test('typed Cleaning fee only, then a refused check: Accommodation empties, Cleaning fee stays', async () => {
  const { f, change, type } = await open([P1, REFUSAL]);
  type('cleaning_fee', '500');
  await change('check_out', '2028-02-20');
  assert.equal(f.elements.accommodation_total.value, '');
  assert.equal(f.elements.cleaning_fee.value, '500');
});

test('Use rate-card price fills both boxes and clears the marks', async () => {
  const { f, change, type } = await open([P1, P2, P2]);
  type('accommodation_total', '9000');
  type('cleaning_fee', '500');
  await change('check_out', '2027-02-07');
  assert.equal(f.elements.accommodation_total.value, '9000');
  assert.equal(f.elements.cleaning_fee.value, '500');
  assert.ok(globalThis.__r49.useRate, 'button captured');
  globalThis.__r49.useRate.props.onclick();
  assert.equal(f.elements.accommodation_total.value, '10000.00');
  assert.equal(f.elements.cleaning_fee.value, '700.00');
  await change('check_out', '2027-02-08');
  assert.equal(f.elements.accommodation_total.value, '10000.00');
  assert.equal(f.elements.cleaning_fee.value, '700.00');
});

test('source: each box has its own typed mark', () => {
  assert.doesNotMatch(quotesSrc, /\bedited\b/);
  assert.match(quotesSrc, /const typed = new Set\(\); let rate = null;/);
  assert.match(quotesSrc, /if \(n !== 'discount_amount'\) typed\.add\(n\);/);
});
