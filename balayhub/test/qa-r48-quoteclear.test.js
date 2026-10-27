'use strict';
require('./helpers');

// QA round 48, lane QUOTECLEAR (public/js/views/quotes.js), BKG48-2 / contract C4. Frontend only: no database rows, no server.
// New quote: when the price check fails for the dates on screen, the price the previous check filled in belongs to the old
// dates, so the Accommodation and Cleaning fee boxes empty (unless the host typed them) and the total reads "-" (D-130).
// newQuoteModal runs for real (through quotesView?new=1) against stand-ins for api.js, ui.js and filters.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const quotesSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'quotes.js'), 'utf8');

const API_STAND_IN = `
export async function get(url) { return globalThis.__r48.get(url); }
export async function post(url, body) { return globalThis.__r48.post(url, body); }
export function qs() { return ''; }
export class ApiError extends Error {}
`;
// h() builds a plain tree; field()/makeForm() give the modal a form whose boxes are plain objects with listeners.
const UI_STAND_IN = `
const kids = (xs) => xs.flat(Infinity).filter((k) => k !== false && k !== null && k !== undefined && k !== true);
export function h(tag, props, ...children) {
  return { tag, props: props || {}, children: kids(children), textContent: '', after() {}, closest: () => null, setAttribute() {}, replaceChildren() {} };
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
  globalThis.__r48.form = form;
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-quo-r48-'));
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
  globalThis.__r48 = {
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
  const f = globalThis.__r48.form;
  assert.ok(f, 'New quote modal opened');
  const change = async (name, value) => { f.elements[name].value = value; for (const fn of f.elements[name].listeners.change || []) fn(); await settle(); };
  const type = (name, value) => { f.elements[name].value = value; for (const fn of f.elements[name].listeners.input || []) fn(); };
  await change('unit_id', 'u1');
  await change('check_in', '2027-02-01');
  await change('check_out', '2027-02-06');
  return { f, change, type };
}

const PRICE = { accommodation_total: '175000.00', cleaning_fee: '500.00', missing_rates: false, available: true };
const REFUSAL = new Error('Stays are limited to one year.');

test('a refused price check empties the boxes the old price filled and the total reads "-"', async () => {
  const { f, change } = await open([PRICE, REFUSAL]);
  assert.equal(f.elements.accommodation_total.value, '175000.00');
  assert.equal(f.elements.cleaning_fee.value, '500.00');
  await change('check_out', '2028-02-20');
  assert.equal(f.elements.accommodation_total.value, '');
  assert.equal(f.elements.cleaning_fee.value, '');
  assert.equal(f.found.total.textContent, 'Total for the guest: -');
  assert.equal(f.found.preview.textContent, "Couldn't price these dates: Stays are limited to one year. Enter the amounts yourself.");
});

test('an amount the host typed stays when the price check is refused', async () => {
  const { f, change, type } = await open([PRICE, REFUSAL]);
  type('accommodation_total', '9000');
  await change('check_out', '2028-02-20');
  assert.equal(f.elements.accommodation_total.value, '9000');
  assert.match(f.found.total.textContent, /^Total for the guest: PHP /);
});

test('source: the catch block clears the rate and the untyped boxes', () => {
  const block = quotesSrc.slice(quotesSrc.indexOf('} catch (e) {', quotesSrc.indexOf('async function loadPreview')));
  assert.match(block.slice(0, 500), /rate = null;/);
  assert.match(block.slice(0, 500), /if \(!edited\) \{ el\('accommodation_total'\)\.value = ''; el\('cleaning_fee'\)\.value = ''; \}/);
});
