'use strict';
require('./helpers');

// QA round 39, lane QUOTES (public/js/views/quotes.js). Frontend only: no database rows, no server.
// Cancel quote waits for its own request (D-121): the button is marked aria-disabled by the press guard in ui.js while the
// handler it returns is pending, so the handler must return the cancel request's wait, not start it and walk away.
// The view runs for real against stand-ins for api.js, ui.js and filters.js; the test controls when the cancel request settles.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '..', 'public', 'js');
const quotesSrc = fs.readFileSync(path.join(SRC, 'views', 'quotes.js'), 'utf8');

const QUOTE_ID = 'qa-r39-quote';
const QUOTE = {
  quote_id: QUOTE_ID,
  status: 'open',
  guest_name: 'QA r39 quote guest',
  guest_email: 'qa-r39-quote@example.test',
  guest_phone: null,
  unit_name: 'QA r39 quote unit',
  check_in: '2027-01-10',
  check_out: '2027-01-12',
  num_guests: 2,
  accommodation_total: 1500,
  cleaning_fee: 0,
  discount_amount: 0,
  addons: [],
  total_amount: 1500,
  pay_type: 'full',
  expires_at: '2027-01-01T00:00:00+08:00',
  note: null,
  url: 'https://example.test/q/qa-r39-quote',
};

// Stand-ins for the three modules quotes.js imports. Each one hands the call to globalThis.__r39Quotes, set per test.
const API_STAND_IN = `
export async function get(url) { return globalThis.__r39Quotes.get(url); }
export async function post(url, body) { return globalThis.__r39Quotes.post(url, body); }
export function qs() { return ''; }
export class ApiError extends Error {}
`;

const UI_STAND_IN = `
// Stand-in for public/js/ui.js (QA r39 quotes test): h() builds a plain tree the test can search.
const kids = (xs) => xs.flat(Infinity).filter((k) => k !== false && k !== null && k !== undefined && k !== true);
export function h(tag, props, ...children) { return { tag, props: props || {}, children: kids(children) }; }
export const icon = () => null;
export const peso = (n) => 'PHP ' + n;
export const fmtDate = (d) => String(d);
export const fmtDateTime = (d) => String(d);
export const badge = (kind, text) => ({ tag: 'badge', props: { kind }, children: [text] });
export const field = () => null;
export const makeForm = () => null;
export const openModal = () => null;
export const confirmDialog = (opts) => globalThis.__r39Quotes.confirm(opts);
export const emptyState = () => null;
export const errorState = () => null;
export const pageError = () => null;
export const pageHead = (o) => ({ tag: 'pageHead', props: {}, children: [o.title] });
export const toast = (...args) => globalThis.__r39Quotes.toast(...args);
export const skeleton = () => null;
export const todayManila = () => '2027-01-01';
export const parseAmount = (s) => Number(String(s).replace(/,/g, ''));
`;

const FILTERS_STAND_IN = `
export const initFilters = () => ({});
export const filterBar = () => null;
export const rememberFilters = () => {};
export const changed = () => false;
export const apiFilters = () => ({});
`;

let quotes;
let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-quo-r39-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'api.js'), API_STAND_IN);
  fs.writeFileSync(path.join(dir, 'ui.js'), UI_STAND_IN);
  fs.writeFileSync(path.join(dir, 'filters.js'), FILTERS_STAND_IN);
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'views', 'quotes.js'), quotesSrc);
  // act() reads document only after a successful cancel (to move focus to the heading); no heading is mounted here.
  globalThis.document = { activeElement: null, body: null, querySelector: () => null };
  quotes = await import(pathToFileURL(path.join(dir, 'views', 'quotes.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// Fresh answers per test: the get returns the open quote; post waits until the test settles it; confirm answers `answer`.
let state;
function reset() {
  state = { posts: [], toasts: [], confirms: [], answer: true, settle: null };
  globalThis.__r39Quotes = {
    get: async () => ({ quote: QUOTE }),
    post: (url) => {
      state.posts.push(url);
      return new Promise((resolve, reject) => { state.settle = { resolve, reject }; });
    },
    confirm: async (opts) => { state.confirms.push(opts); return state.answer; },
    toast: (...args) => { state.toasts.push(args); },
  };
}

// Mount the real quote detail view and return the tree it built.
async function mountDetail() {
  const el = { nodes: [], replaceChildren(...nodes) { this.nodes = nodes.flat(Infinity); } };
  await quotes.quoteDetailView(el, { params: { id: QUOTE_ID }, rerender: async () => {} });
  return { tag: 'root', props: {}, children: el.nodes };
}

function findButton(node, text) {
  if (!node || typeof node !== 'object') return null;
  if (node.tag === 'button' && node.children.includes(text)) return node;
  for (const c of node.children || []) {
    const found = findButton(c, text);
    if (found) return found;
  }
  return null;
}

const delay = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
// 'handler' if the handler's promise settles first, 'marker' if a 15 ms timer does (the handler is still waiting).
const settledFirst = (p) => Promise.race([p.then(() => 'handler'), delay(15, 'marker')]);

test('Cancel quote keeps its handler pending until the cancel request settles (D-121)', async () => {
  reset();
  const tree = await mountDetail();
  const cancel = findButton(tree, 'Cancel quote');
  assert.ok(cancel, 'the open quote has a Cancel quote button');

  const press = cancel.props.onclick();
  assert.equal(await settledFirst(press), 'marker', 'the handler is still waiting while the cancel request is pending');
  assert.deepEqual(state.posts, [`/quotes/${QUOTE_ID}/cancel`], 'one cancel request is sent');

  state.settle.resolve({});
  await press;
  assert.deepEqual(state.toasts, [['Quote cancelled.']], 'the success toast shows once the request is done');
});

test('Cancel quote that the guest keeps sends nothing, and its handler settles at once', async () => {
  reset();
  state.answer = false;
  const tree = await mountDetail();
  const press = findButton(tree, 'Cancel quote').props.onclick();
  assert.equal(await settledFirst(press), 'handler');
  assert.deepEqual(state.posts, []);
  assert.deepEqual(state.confirms.map((c) => c.confirmText), ['Cancel quote']);
});

test('Cancel quote whose request is refused still settles the handler and shows the refusal', async () => {
  reset();
  const tree = await mountDetail();
  const press = findButton(tree, 'Cancel quote').props.onclick();
  assert.equal(await settledFirst(press), 'marker', 'the handler waits while the request is pending');

  state.settle.reject(new Error('QA r39 refused.'));
  assert.equal(await settledFirst(press), 'handler', 'the handler settles once the refusal arrives');
  assert.deepEqual(state.toasts, [['QA r39 refused.', 'error']]);
});
