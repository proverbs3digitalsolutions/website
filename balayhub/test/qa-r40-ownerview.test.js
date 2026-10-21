'use strict';
require('./helpers');

// QA round 40, OWNERVIEW (D-122, contract C4.3; row MNY-1). A removed unit owner takes no new payout: the statement's Payouts card
// says so in place of the Record payout button (the payouts list and its Void buttons stay), and the Remove question says to record
// any payout still owed first. owners.js runs as a copy in a temp folder with api.js, ui.js, app.js, filters.js and reservations.js
// stubbed, on a stand-in DOM (the views and the stubs are the real code; only the page is faked).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const REMOVED_NOTE = "This owner was removed, so new payouts can't be recorded here.";
const REMOVE_TEXT = 'Their units will no longer have an owner. Record any payout you still owe them first. Past reservations and expenses are not changed.';
const PAYOUT = { payout_id: 'p1', amount: '10.00', method: 'cash', paid_on: '2026-09-30', reference_number: null, note: null, voided: false, void_reason: null };
const OWNER = {
  owner_id: 'o1', full_name: 'QA r40 ownerview owner', email: null, phone: null, unit_ids: [], portal_enabled: false, portal_invited_at: null,
  portal_last_seen_at: null, fee_model: 'net_pct', management_fee_pct: '20', flat_monthly_fee: '0', cleaning_to_manager: true, reserve_target: '0', reserve_monthly: '0',
};

// The statement payload the page reads (GET /unit-owners/:id/statement), with the archived flag under test.
const statement = (archived) => ({
  statement: {
    workspace: 'QA r40 ownerview Stays', month_label: 'September 2026',
    owner: { full_name: OWNER.full_name, email: null, cleaning_to_manager: true },
    units: [{ unit_name: 'QA r40 ownerview Unit A' }], stays: [], expenses: [], refunded: '0.00', fee_label: 'Management fee', missing_amounts: 0,
    totals: { stays: 0, nights: 0, occupancy_pct: 0, gross: '0.00', channel_fees: '0.00', cleaning_fees: '0.00', net_rental: '0.00', management_fee: '0.00', expenses: '0.00', payout: '10.00' },
  },
  record: null, published: null, portal_enabled: false, archived,
});

// A minimal element: enough of the DOM for the view's own calls (attributes, listeners, children, text).
class El {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.disabled = false; this.listeners = {}; this.text = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(t, f) { this.listeners[t] = f; }
  append(...c) { this.children.push(...kids(c)); }
  replaceChildren(...c) { this.children = kids(c); }
  get textContent() { return this.text + this.children.map((c) => (c instanceof El ? c.textContent : String(c))).join(''); }
  fire(t) { return this.listeners[t]?.({ type: t, target: this, currentTarget: this }); }
  all(f, out = []) { if (f(this)) out.push(this); for (const c of this.children) if (c instanceof El) c.all(f, out); return out; }
}
const kids = (list) => list.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== '');

const state = {};
let mod; let dir;

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r40ownerview-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'api.js'), `
    export const get = (u) => globalThis.__get(u);
    export const post = (u, b, o) => globalThis.__post(u, b, o);
    export const patch = (u, b, o) => globalThis.__patch(u, b, o);
    export const qs = (o = {}) => { const s = Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&'); return s ? '?' + s : ''; };`);
  fs.writeFileSync(path.join(dir, 'ui.js'), `
    export const h = (tag, props, ...kids) => globalThis.__h(tag, props, kids);
    export const peso = (v) => '₱' + Number(v).toFixed(2);
    export const fmtDate = (d) => String(d);
    export const fmtDateTime = (d) => String(d);
    export const field = () => null;
    export const formModal = () => null;
    export const confirmDialog = (o) => globalThis.__confirm(o);
    export const emptyState = () => null;
    export const pageHead = () => globalThis.__h('div', null, []);
    export const badge = (kind, text) => globalThis.__h('span', null, [text]);
    export const toast = (m, k) => globalThis.__toast(m, k);
    export const todayManila = () => '2026-10-21';`);
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const navigate = () => {};\n');
  fs.writeFileSync(path.join(dir, 'filters.js'), `
    export const initFilters = (name, query, defaults) => ({ ...defaults });
    export const filterBar = () => null;
    export const changed = () => ({});
    export const apiFilters = () => ({});`);
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), 'export const CHANNEL_LABEL = {};\n');
  fs.copyFileSync(path.join(__dirname, '../public/js/views/owners.js'), path.join(dir, 'views', 'owners.js'));

  globalThis.history = { replaceState() {} };
  globalThis.__h = (tag, props, list) => {
    const el = new El(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'disabled') el.disabled = v === true;
      else if (k === 'style' || k === 'dataset') continue;
      else el.setAttribute(k, v === true ? '' : v);
    }
    el.append(...list);
    return el;
  };
  globalThis.__toast = (m, k) => state.toasts.push([m, k || 'info']);
  globalThis.__confirm = async (o) => { state.dialogs.push(o); return state.answer; };
  globalThis.__post = async (u, b) => { state.posts.push([u, b]); return {}; };
  globalThis.__patch = async (u, b) => { state.posts.push([u, b]); return {}; };
  globalThis.__get = async (u) => {
    if (u.includes('/statement?')) return state.statement;
    if (u.includes('/payouts?')) return { payouts: [PAYOUT] };
    if (u.includes('/reserve')) return null;
    if (u.startsWith('/unit-owners')) return state.owners;
    throw new Error(`unexpected GET ${u}`);
  };
  mod = await import(pathToFileURL(path.join(dir, 'views', 'owners.js')).href);
});

test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test.beforeEach(() => {
  Object.assign(state, { toasts: [], dialogs: [], posts: [], answer: false, statement: statement(true), owners: { owners: [OWNER], units: [], total: 1 } });
});

async function mountStatement(archived) {
  state.statement = statement(archived);
  const el = new El('main');
  await mod.ownerStatementView(el, { params: { id: 'o1' }, query: { month: '2026-09' }, rerender: () => {} });
  return el;
}
const payoutsCardOf = (root) => root.all((e) => e.tag === 'section' && e.textContent.startsWith('Payouts'))[0];
const buttonsNamed = (root, text) => root.all((e) => e.tag === 'button' && e.textContent === text);

test('a removed owner\'s statement has no Record payout button', async () => {
  const el = await mountStatement(true);
  assert.equal(buttonsNamed(el, 'Record payout').length, 0);
});

test('a removed owner\'s Payouts card says new payouts can\'t be recorded, in place of the button', async () => {
  const el = await mountStatement(true);
  const card = payoutsCardOf(el);
  assert.ok(card, 'the Payouts card is drawn');
  assert.equal(card.all((e) => e.tag === 'p' && e.textContent === REMOVED_NOTE).length, 1);
  assert.equal(card.all((e) => e.tag === 'p' && e.attrs.class === 'muted small' && e.textContent === REMOVED_NOTE).length, 1);
});

test('a removed owner\'s recorded payouts and their Void button stay listed', async () => {
  const el = await mountStatement(true);
  assert.equal(el.all((e) => e.tag === 'li').length, 1);
  assert.equal(el.all((e) => e.tag === 'button' && (e.attrs['aria-label'] || '').startsWith('Void payout')).length, 1);
});

test('an active owner\'s statement keeps an enabled Record payout button and shows no removed note', async () => {
  const el = await mountStatement(false);
  const [record] = buttonsNamed(el, 'Record payout');
  assert.ok(record, 'Record payout is drawn for an active owner');
  assert.equal(record.disabled, false);
  assert.equal(el.all((e) => e.tag === 'p' && e.textContent === REMOVED_NOTE).length, 0);
});

test('the Remove question says to record any payout still owed first, and cancelling posts nothing', async () => {
  const el = new El('main');
  await mod.ownersView(el, { rerender: () => {}, query: {} });
  const remove = el.all((e) => e.tag === 'button' && e.attrs['aria-label'] === `Remove ${OWNER.full_name}`)[0];
  assert.ok(remove, 'the owner row has a Remove button');
  await remove.fire('click');
  assert.equal(state.dialogs.length, 1);
  assert.equal(state.dialogs[0].title, `Remove ${OWNER.full_name}?`);
  assert.equal(state.dialogs[0].text, REMOVE_TEXT);
  assert.deepEqual(state.posts, []);
});
