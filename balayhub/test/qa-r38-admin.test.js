'use strict';

require('./helpers');
// QA round 38, lane ADMIN (public/js/views/admin.js). Frontend only: the view is copied to a temp folder with stub modules for its
// imports, then mounted in a small stand-in DOM. Rule: a button busy with its own request keeps focus (D-120). Delete in 14 days and
// Delete now are marked with aria-disabled while the request runs, never disabled, so the pressed button keeps focus.
// node --test --test-concurrency=1 test/qa-r38-admin.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ADMIN = path.join(__dirname, '..', 'public', 'js', 'views', 'admin.js');

// ---- stand-in DOM: only what admin.js touches. A disabled control drops focus to the page and gets no click (as a browser does).
// aria-disabled does neither.
const dom = { body: null, activeElement: null };

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = {};
    this.children = [];
    this.parentElement = null;
    this.listeners = {};
    this.hidden = false;
    this.value = '';
    this.style = null;
    this._disabled = false;
  }
  get disabled() { return this._disabled; }
  set disabled(v) {
    this._disabled = Boolean(v);
    if (this._disabled && dom.activeElement && this.contains(dom.activeElement)) dom.activeElement = dom.body;
  }
  get isConnected() {
    for (let n = this; n; n = n.parentElement) if (n === dom.body) return true;
    return false;
  }
  contains(node) {
    for (let n = node; n; n = n.parentElement) if (n === this) return true;
    return false;
  }
  get textContent() { return this.children.map((c) => (c instanceof El ? c.textContent : c)).join(''); }
  set textContent(v) {
    for (const c of [...this.children]) if (c instanceof El) c.remove();
    this.children = [];
    if (v !== '' && v !== null && v !== undefined) this.children.push(String(v));
  }
  append(...nodes) {
    for (const n of nodes.flat(Infinity)) {
      if (n === null || n === undefined || n === false || n === true || n === '') continue;
      if (n instanceof El) { n.remove(); n.parentElement = this; this.children.push(n); } else this.children.push(String(n));
    }
    return this;
  }
  replaceChildren(...nodes) {
    for (const c of [...this.children]) if (c instanceof El) c.remove();
    this.children = [];
    return this.append(...nodes);
  }
  remove() {
    const p = this.parentElement;
    if (!p) return;
    p.children = p.children.filter((c) => c !== this);
    this.parentElement = null;
    if (dom.activeElement && this.contains(dom.activeElement)) dom.activeElement = dom.body;
  }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type) {
    if (type === 'click' && this._disabled) return; // a disabled control gets no click
    for (const fn of this.listeners[type] || []) fn({ type, target: this, currentTarget: this, preventDefault() {} });
  }
  focus() {
    if (this._disabled || !this.isConnected) return;
    dom.activeElement = this;
  }
}

function h(tag, attrs, ...kids) {
  const node = new El(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'disabled') node.disabled = v;
    else if (k === 'hidden') node.hidden = v;
    else if (k === 'style') node.style = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  return node.append(...kids);
}

function find(node, pred) {
  if (pred(node)) return node;
  for (const c of node.children) {
    if (!(c instanceof El)) continue;
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return null;
}
// ---- end stand-in DOM

// One workspace, one plan. Not the admin's own workspace and not the demo one, so the delete section is shown.
const WORKSPACE = {
  organization_id: 'org-casa', name: 'Casa Lumen', owner_name: 'Ana Reyes', owner_email: 'ana@example.test', unit_count: 2, member_count: 1,
  plan: 'starter', plan_note: null, paid_until: null, trial_ends_at: null, card_check: null, is_demo: false, admin_status: null,
  business_type: 'short_term', created_at: '2026-10-01T00:00:00Z', last_active_at: null,
  status: { plan: 'starter', name: 'Starter', read_only: false, reason: null, trial_days_left: 0 },
};
const listing = () => ({
  plans: [{ key: 'starter', name: 'Starter', price: 499, listings: 3 }],
  summary: { trial: 0, paying: 1, grace: 0, trial_ended: 0, overdue: 0, deleting: 0 },
  mrr: 499,
  workspaces: [{ ...WORKSPACE }],
  total: 1,
});

let world = null;
function reset() {
  dom.body = new El('body');
  dom.activeElement = dom.body;
  world = { posts: [], pending: [], toasts: [], gets: [], rerenders: 0 };
}

// The stubs admin.js imports. They forward to the current test's world, so each test starts clean.
const stubs = {
  h,
  fmtDate: (d) => String(d),
  fmtDateTime: (d) => String(d),
  manilaDay: (d) => String(d).slice(0, 10),
  badge: (kind, text) => h('span', { class: `badge badge--${kind}` }, text),
  field: () => h('div'),
  makeForm: () => h('form'),
  openModal: ({ body }) => { const m = h('dialog'); m.append(body); dom.body.append(m); return { close: () => m.remove() }; },
  confirmDialog: async () => true,
  todayManila: () => '2026-10-21',
  emptyState: () => h('div'),
  toast: (msg) => { world.toasts.push(msg); },
  get: async (url) => { world.gets.push(url); return listing(); },
  patch: async () => ({}),
  post: (url, body) => { world.posts.push({ url, body }); return new Promise((resolve, reject) => world.pending.push({ resolve, reject })); },
  qs: () => '',
  initFilters: (key, query, defaults) => ({ ...defaults }),
  filterBar: () => h('div'),
  changed: () => ({}),
  apiFilters: () => ({}),
  state: { user: { is_platform_admin: true, organization_id: 'org-own' } },
};

const forward = (names) => `${names.map((n) => `export const ${n} = (...a) => globalThis.__r38.${n}(...a);`).join('\n')}\n`;
const UI_NAMES = ['h', 'fmtDate', 'fmtDateTime', 'manilaDay', 'badge', 'field', 'makeForm', 'openModal', 'confirmDialog', 'todayManila', 'emptyState', 'toast'];
const API_NAMES = ['get', 'patch', 'post', 'qs'];
const FILTER_NAMES = ['initFilters', 'filterBar', 'changed', 'apiFilters'];

let admin;
let tmp;
test.before(async () => {
  globalThis.__r38 = stubs;
  globalThis.document = {
    get activeElement() { return dom.activeElement; },
    get body() { return dom.body; },
    querySelector: () => null,
    getElementById: (id) => find(dom.body, (n) => n.attrs.id === id),
  };
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-admin-r38-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(tmp, 'ui.js'), forward(UI_NAMES));
  fs.writeFileSync(path.join(tmp, 'api.js'), forward(API_NAMES));
  fs.writeFileSync(path.join(tmp, 'filters.js'), forward(FILTER_NAMES));
  fs.writeFileSync(path.join(tmp, 'app.js'), 'export const state = globalThis.__r38.state;\n');
  fs.mkdirSync(path.join(tmp, 'views'));
  fs.writeFileSync(path.join(tmp, 'views', 'admin.js'), fs.readFileSync(ADMIN, 'utf8'));
  admin = await import(pathToFileURL(path.join(tmp, 'views', 'admin.js')));
});
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)); };
const btn = (text) => find(dom.body, (n) => n.tagName === 'BUTTON' && n.textContent === text);

// Renders the list, clicks the one workspace row (opens its dialog), and types the name so both delete buttons are on.
async function openDialogWithName(typed) {
  reset();
  const root = new El('div');
  await admin.adminView(root, { rerender: async () => { world.rerenders += 1; }, query: {} });
  const tbody = find(root, (n) => n.tagName === 'TBODY');
  tbody.children[0].dispatch('click');
  const nameBox = find(dom.body, (n) => n.attrs.id === 'delete-confirm-name');
  assert.ok(nameBox, 'the workspace dialog opened with its name box');
  nameBox.value = typed;
  nameBox.dispatch('input');
  return nameBox;
}

test('Delete in 14 days keeps focus while its request runs, both delete buttons are busy, and a second press sends nothing', async () => {
  await openDialogWithName('Casa Lumen');
  const sched = btn('Delete in 14 days');
  const now = btn('Delete now');
  assert.equal(sched.disabled, false, 'the typed name matches, so the button is on');
  sched.focus();
  assert.equal(dom.activeElement, sched, 'precondition: focus is on the button the person presses');
  sched.dispatch('click');
  assert.equal(world.posts.length, 1, 'one request is sent');
  assert.equal(sched.getAttribute('aria-disabled'), 'true', 'the pressed button is busy');
  assert.equal(now.getAttribute('aria-disabled'), 'true', 'the other delete button is busy too');
  assert.equal(sched.disabled, false, 'busy is not native disabled, because a disabled button drops focus to the page');
  assert.equal(dom.activeElement, sched, 'focus stays on the pressed button while the request runs');
  sched.dispatch('click');
  now.dispatch('click');
  assert.equal(world.posts.length, 1, 'a second press, on either button, sends nothing');
  assert.equal(world.posts[0].url, '/admin/workspaces/org-casa/delete');
  assert.deepEqual(world.posts[0].body, { mode: 'schedule', confirm_name: 'Casa Lumen' });
  world.pending[0].resolve({ deletion_scheduled_at: '2026-11-04T00:00:00Z' });
  await settle();
});

test('a delete that goes through redraws the dialog, so the old buttons are gone and the new ones are not busy', async () => {
  await openDialogWithName('Casa Lumen');
  const sched = btn('Delete in 14 days');
  sched.dispatch('click');
  world.pending[0].resolve({ deletion_scheduled_at: '2026-11-04T00:00:00Z' });
  await settle();
  assert.equal(sched.isConnected, false, 'the old dialog was closed and redrawn');
  assert.equal(world.rerenders, 1, 'the list was redrawn once');
  assert.equal(world.toasts.at(-1), 'Deletion scheduled for 2026-11-04T00:00:00Z.');
  const fresh = btn('Delete in 14 days');
  assert.ok(fresh && fresh !== sched, 'the reopened dialog has its own buttons');
  assert.equal(fresh.getAttribute('aria-disabled'), null, 'none of the new buttons is busy');
});

test('a refused delete clears the busy mark, puts focus on the message, and the next press sends again', async () => {
  await openDialogWithName('Casa Lumen');
  const sched = btn('Delete in 14 days');
  const now = btn('Delete now');
  sched.focus();
  sched.dispatch('click');
  world.pending[0].reject(Object.assign(new Error('QA r38 refused.'), { status: 409 }));
  await settle();
  assert.equal(sched.getAttribute('aria-disabled'), null, 'the busy mark is gone');
  assert.equal(now.getAttribute('aria-disabled'), null, 'on both buttons');
  assert.equal(sched.disabled, false, 'the typed name still matches, so the buttons stay on');
  const alert = find(dom.body, (n) => n.attrs.role === 'alert' && n.textContent === 'QA r38 refused.');
  assert.ok(alert, 'the server message is shown in the alert');
  assert.equal(alert.hidden, false, 'the alert is visible');
  assert.equal(dom.activeElement, alert, 'focus moves to the message');
  sched.dispatch('click');
  assert.equal(world.posts.length, 2, 'the next press sends a new request');
  world.pending[1].resolve({ deletion_scheduled_at: '2026-11-04T00:00:00Z' });
  await settle();
});

test('the name gate stays native: a name that does not match leaves both delete buttons disabled', async () => {
  const nameBox = await openDialogWithName('casa lumen');
  assert.equal(btn('Delete in 14 days').disabled, true, 'a wrong-case name keeps Delete in 14 days off');
  assert.equal(btn('Delete now').disabled, true, 'and Delete now off');
  assert.equal(world.posts.length, 0, 'nothing is sent');
  nameBox.value = 'Casa Lumen';
  nameBox.dispatch('input');
  assert.equal(btn('Delete now').disabled, false, 'the exact name turns Delete now on');
});
