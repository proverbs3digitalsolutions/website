'use strict';
require('./helpers');

// QA round 38, lane CLEANERPAY (CPY-R; D-117, D-120). On the cleaner's My pay page, the Next month button that brings the page to
// this month is dimmed with aria-disabled, never disabled, so it keeps focus after the press (a natively disabled button drops
// focus to BODY). A press on the dimmed Next does nothing: the month stays and no request goes out.
// Frontend only: the real view is mounted from a temp copy with stub modules and a stand-in page. No database, no server.
// R38_CLEANERPAY_SRC (optional) points the test at another copy of cleanerpay.js (used to prove it red on the round 37 file).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = process.env.R38_CLEANERPAY_SRC || path.join(__dirname, '..', 'public', 'js', 'views', 'cleanerpay.js');

// Stub modules for the view's imports. Only what the My pay page reads is real; `h` and `get` reach the stand-in page below.
const STUBS = {
  'api.js': `
export const get = (...a) => globalThis.__r38.get(...a);
export const post = (...a) => globalThis.__r38.get(...a);
export const patch = (...a) => globalThis.__r38.get(...a);
export const api = (...a) => globalThis.__r38.get(...a);
export const qs = (o) => '?' + new URLSearchParams(o).toString();
export class ApiError extends Error {}
`,
  'ui.js': `
const r = () => globalThis.__r38;
export const h = (...a) => r().h(...a);
export const peso = (v) => 'PHP ' + Number(v || 0).toFixed(2);
export const manilaDay = (x) => String(x || '').slice(0, 10);
export const fmtDate = (x) => String(x);
export const fmtMonth = (x) => String(x);
export const field = () => r().h('div');
export const formModal = () => r().h('div');
export const makeForm = () => r().h('form');
export const openModal = () => {};
export const confirmDialog = async () => false;
export const emptyState = () => r().h('div');
export const pageHead = () => r().h('div');
export const toast = () => {};
export const todayManila = () => r().today;
export const options = () => [];
export const label = () => r().h('label');
export const errorState = () => r().h('div');
export const skeleton = () => r().h('div');
`,
  'app.js': `export const state = { user: { role: 'owner', guest_language: 'en' } };\n`,
  'filters.js': `
export const initFilters = () => ({});
export const filterBar = () => null;
export const rememberFilters = () => {};
export const changed = () => false;
`,
  'i18n.js': `
export const t = (s) => s;
export const initGuestLang = () => {};
export const extendTranslations = () => {};
export const fmtDateL = (x) => String(x);
`,
};

// The stand-in page. A focused element that is set to disabled drops focus to BODY, as a browser does. A click reaches a
// control unless it is natively disabled: an aria-disabled control still gets the click, and its handler decides what happens.
function makePage() {
  const page = { active: null, body: null, root: null, h: null };
  const make = (tag) => ({
    tag, attrs: {}, children: [], onclick: null, textContent: '', isDisabled: false,
    get disabled() { return this.isDisabled; },
    set disabled(v) { this.isDisabled = Boolean(v); if (this.isDisabled && page.active === this) page.active = page.body; },
    getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    focus() { if (!this.isDisabled) page.active = this; },
    replaceChildren(...kids) { this.children = kids.flat(Infinity).filter((k) => k !== false && k != null); },
  });
  page.body = make('body');
  page.active = page.body;
  page.h = (tag, props, ...kids) => {
    const n = make(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'onclick') n.onclick = v;
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    n.replaceChildren(...kids);
    return n;
  };
  page.root = page.h('main');
  return page;
}

const find = (n, pred) => {
  if (!n || typeof n !== 'object') return null;
  if (pred(n)) return n;
  for (const c of n.children) { const hit = find(c, pred); if (hit) return hit; }
  return null;
};
const named = (page, label) => find(page.root, (n) => n.attrs['aria-label'] === label);
const monthLabel = (page) => find(page.root, (n) => n.attrs.class === 'mypay__month').textContent;

// A click: a natively disabled control gets none (the browser sends no click); an aria-disabled control gets it.
const click = (b) => { if (b.disabled) return; b.focus(); b.onclick({ currentTarget: b }); };

let view;
let dir;
let page;   // the stand-in page the view is drawn into
let gets;   // every GET the view made, in order

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r38-cleanerpay-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const [name, body] of Object.entries(STUBS)) fs.writeFileSync(path.join(dir, name), body);
  fs.copyFileSync(SRC, path.join(dir, 'views', 'cleanerpay.js'));
  globalThis.history ||= { replaceState() {} };
  globalThis.__r38 = {
    today: '2026-10-21', // Manila: this month is 2026-10
    h: (...a) => page.h(...a),
    get: async (url) => { gets.push(url); return { tasks: [], totals: { total: 0, unpaid: 0, paid: 0 } }; },
  };
  view = await import(pathToFileURL(path.join(dir, 'views', 'cleanerpay.js')));
});

test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// Draws the My pay page (on one month, as ?month=YYYY-MM, or on this month) and lets its first load finish.
async function mount(month) {
  page = makePage();
  gets = [];
  await view.myPayView(page.root, { query: month ? { month } : {} });
  await new Promise((r) => setImmediate(r));
  return page;
}

test('the page opens on this month with Next dimmed by aria-disabled, not natively disabled', async () => {
  const p = await mount(null);
  const next = named(p, 'Next month');
  assert.ok(next, 'Next month button is drawn');
  assert.match(monthLabel(p), /October 2026/);
  assert.equal(next.getAttribute('aria-disabled'), 'true');
  assert.equal(next.disabled, false);
  assert.equal(gets.length, 1, 'one load on open');
});

test('pressing Next into this month keeps focus on Next, dimmed with aria-disabled and not disabled', async () => {
  const p = await mount('2026-09');
  const next = named(p, 'Next month');
  assert.equal(next.getAttribute('aria-disabled'), null, 'a month back, Next is live');
  click(next);
  assert.match(monthLabel(p), /October 2026/);
  assert.equal(next.getAttribute('aria-disabled'), 'true', 'Next is dimmed');
  assert.equal(next.disabled, false, 'Next is not natively disabled');
  assert.equal(p.active, next, 'focus stays on Next after the press');
});

test('a press on the dimmed Next does nothing: the month stays and no request goes out', async () => {
  const p = await mount('2026-09');
  const next = named(p, 'Next month');
  click(next);
  const loadsAfterReach = gets.length;
  click(next);
  assert.equal(gets.length, loadsAfterReach, 'no load for a month past this one');
  assert.match(monthLabel(p), /October 2026/);
  assert.equal(next.getAttribute('aria-disabled'), 'true');
  assert.equal(p.active, next);
});

test('Previous takes the page back a month, and Next is live again', async () => {
  const p = await mount(null);
  click(named(p, 'Previous month'));
  assert.match(monthLabel(p), /September 2026/);
  const next = named(p, 'Next month');
  assert.equal(next.getAttribute('aria-disabled'), null, 'Next is live again');
  click(next);
  assert.match(monthLabel(p), /October 2026/);
  assert.equal(next.getAttribute('aria-disabled'), 'true');
  assert.equal(p.active, next);
});

test('the view never sets disabled on the pager Next button', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  assert.doesNotMatch(src, /\bnext\.disabled\s*=/);
  assert.match(src, /next\.setAttribute\('aria-disabled', 'true'\)/);
});
