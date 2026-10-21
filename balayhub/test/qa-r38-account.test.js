'use strict';
require('./helpers');

// QA round 38, lane ACCOUNT (rows 24 to 26, contract C1, D-120): a control busy with its own request keeps focus.
// Notification Save, Sign out (one device) and Sign out all other devices are marked aria-disabled while their request runs,
// never disabled (a disabled control drops focus to the page). A second press sends nothing, and the mark goes when the
// request settles (or the page redraws). The view runs from a temp copy with stub imports, mounted on a stand-in DOM where
// setting disabled = true on the focused control moves focus to the body, as a browser does.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const accountSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'account.js'), 'utf8');

const world = { body: null, active: null, calls: [], toasts: [], questions: [], rerenders: 0, api: null, confirm: null };

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this.listeners = {};
    this.checked = false;
    this.name = '';
    this.value = '';
    this._disabled = false;
  }
  get disabled() { return this._disabled; }
  set disabled(v) {
    this._disabled = Boolean(v);
    if (this._disabled && world.active === this) world.active = world.body;
  }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  focus() { if (!this._disabled) world.active = this; }
  append(...nodes) {
    for (const n of nodes.flat(Infinity)) if (n !== null && n !== undefined && n !== false && n !== true) this.children.push(n);
  }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  querySelector(sel) { return findAll(this, (n) => n !== this && n.tagName === sel.toUpperCase())[0] || null; }
  text() { return this.children.map((c) => (c instanceof El ? c.text() : String(c))).join(''); }
}

function h(tag, props, ...children) {
  const el = new El(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false || k === 'style') continue;
    if (k.startsWith('on') && typeof v === 'function') el.listeners[k.slice(2).toLowerCase()] = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = Boolean(v);
    else {
      el.setAttribute(k, v === true ? '' : v);
      if (k === 'name' || k === 'value') el[k] = String(v);
    }
  }
  el.append(...children);
  return el;
}
world.h = h;
world.body = new El('body');
world.active = world.body;

function findAll(root, pred) {
  const out = [];
  const walk = (n) => { if (!(n instanceof El)) return; if (pred(n)) out.push(n); n.children.forEach(walk); };
  walk(root);
  return out;
}

// Stub modules for the imports of account.js (the real ones need a browser).
const STUBS = {
  'api.js': `const w = () => globalThis.__r38;
export const get = (...a) => w().api.get(...a);
export const post = (...a) => w().api.post(...a);
export const patch = (...a) => w().api.patch(...a);
`,
  'ui.js': `const w = () => globalThis.__r38;
export const h = (...a) => w().h(...a);
export const icon = (name) => w().h('svg', { 'data-icon': name });
export const badge = (kind, text) => w().h('span', { 'data-badge': kind }, text);
export const label = (v) => String(v);
export const fmtDate = (v) => 'date ' + v;
export const fmtDateTime = (v) => 'datetime ' + v;
export const field = (o) => o;
export const formModal = (o) => o;
export const toast = (text, kind) => { w().toasts.push({ text, kind: kind || 'success' }); };
export const confirmDialog = (o) => { w().questions.push(o.title); return w().confirm(o); };
`,
  'app.js': `export const state = { user: null };
export const logout = () => {};
export const refreshUser = async () => {};
`,
  'themeswitch.js': `export const themeSwitch = () => globalThis.__r38.h('span', null, 'Theme');
`,
  'views/settings.js': `export const changePassword = () => {};
export const ROLE_TEXT = { short_term: { owner: 'Owner', manager: 'Manager', staff: 'Staff' }, long_term: { owner: 'Owner', manager: 'Manager', staff: 'Staff' } };
export const actionText = (a) => String(a);
`,
};

let accountMod;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-acct-r38-'));
test.before(async () => {
  fs.mkdirSync(path.join(dir, 'views'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const [file, src] of Object.entries(STUBS)) fs.writeFileSync(path.join(dir, file), src);
  fs.writeFileSync(path.join(dir, 'views', 'account.js'), accountSrc);
  globalThis.__r38 = world;
  accountMod = await import(pathToFileURL(path.join(dir, 'views', 'account.js')).href);
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const PROFILE = {
  user: { full_name: 'QA r38 account', email: 'qa-r38-account@example.test', phone: null, created_at: '2026-01-05T00:00:00Z', email_verified: true, notifications_on: false, google_linked: false },
  workspace: { name: 'QA r38 account workspace', role: 'staff', business_type: 'short_term', plan: { plan: 'trial', trial_days_left: 5, name: 'Trial' }, members: 2 },
  owner: null,
  properties: [],
  activity: [],
  support: null,
  sessions: [
    { id: 1, device: 'This laptop', current: true, created_at: '2026-10-20T08:00:00Z', last_seen_at: '2026-10-21T01:00:00Z' },
    { id: 2, device: 'Old phone', current: false, created_at: '2026-10-01T08:00:00Z', last_seen_at: '2026-10-19T01:00:00Z' },
    { id: 3, device: 'Tablet', current: false, created_at: '2026-09-01T08:00:00Z', last_seen_at: '2026-10-10T01:00:00Z' },
  ],
};
const NOTIFY = { types: { booking: true, message: false }, labels: { booking: 'New bookings', message: 'Guest messages' }, properties: [], property_ids: null };

const DEFAULT_API = {
  get: async (p) => {
    if (p === '/account/profile') return structuredClone(PROFILE);
    if (p === '/account/notify-prefs') return structuredClone(NOTIFY);
    throw new Error(`unexpected GET ${p}`);
  },
  post: (p) => { world.calls.push(['post', p]); return Promise.reject(new Error(`unexpected POST ${p}`)); },
  patch: (p) => { world.calls.push(['patch', p]); return Promise.reject(new Error(`unexpected PATCH ${p}`)); },
};

// Fresh page state for each test: no calls, no toasts, focus on the body, the question says yes.
function useApi(over = {}) {
  world.calls.length = 0;
  world.toasts.length = 0;
  world.questions.length = 0;
  world.rerenders = 0;
  world.active = world.body;
  world.api = { ...DEFAULT_API, ...over };
  world.confirm = async () => true;
}

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

// A press: the handler runs its synchronous part now, then the browser clears currentTarget (it is read before any await).
function press(node, type = 'click') {
  const ev = { type, target: node, currentTarget: node, preventDefault() {} };
  const done = node.listeners[type](ev);
  ev.currentTarget = null;
  return done;
}

async function mount() {
  const root = new El('main');
  const rerender = () => { world.rerenders++; return accountMod.accountView(root, { rerender }); };
  await accountMod.accountView(root, { rerender });
  await settle();
  return root;
}

const saveButton = (root) => findAll(root, (n) => n.tagName === 'BUTTON' && (n.getAttribute('aria-label') || '') === 'Save notifications')[0];
const notifyForm = (root) => findAll(root, (n) => n.tagName === 'FORM')[0];
const signOutButton = (root, device) => findAll(root, (n) => n.tagName === 'BUTTON' && (n.getAttribute('aria-label') || '').startsWith(`Sign out ${device},`))[0];
const signOutOthersButton = (root) => findAll(root, (n) => n.tagName === 'BUTTON' && n.text() === 'Sign out all other devices')[0];
const errorLine = (root) => findAll(root, (n) => n.getAttribute('role') === 'alert' && n.getAttribute('class') === 'error')[0];

test('notification Save keeps focus while it waits, and a second submit sends nothing', async () => {
  const d = deferred();
  useApi({ patch: (p, body) => { world.calls.push(['patch', p]); return d.promise; } });
  const root = await mount();
  const form = notifyForm(root);
  const save = saveButton(root);
  assert.ok(form && save, 'the Notifications form and its Save button are on the page');
  save.focus();
  assert.equal(world.active, save, 'Save has focus before the press');

  const first = press(form, 'submit');
  await settle();
  assert.equal(save.getAttribute('aria-disabled'), 'true', 'Save is busy while the request runs');
  assert.equal(save.disabled, false, 'Save is not natively disabled');
  assert.equal(world.active, save, 'focus stays on Save while it waits');

  const second = press(form, 'submit');
  await settle();
  assert.equal(world.calls.length, 1, 'a second submit sends no second request');
  d.resolve({});
  await Promise.all([first, second]);

  assert.equal(save.getAttribute('aria-disabled'), null, 'the busy mark goes when the request settles');
  assert.equal(save.disabled, false);
  assert.ok(world.toasts.some((t) => t.text === 'Notification settings saved.'), 'the saved message shows');
});

test('notification Save: a refusal removes the busy mark, shows the message and keeps focus', async () => {
  const d = deferred();
  useApi({ patch: (p) => { world.calls.push(['patch', p]); return d.promise; } });
  const root = await mount();
  const form = notifyForm(root);
  const save = saveButton(root);
  const err = errorLine(root);
  assert.ok(form && save && err, 'the form, its Save button and the error line are on the page');
  save.focus();

  const p = press(form, 'submit');
  await settle();
  assert.equal(save.getAttribute('aria-disabled'), 'true', 'Save is busy while the request runs');
  d.reject(Object.assign(new Error('QA r38 refused.'), { fields: { types: 'QA r38 refused.' } }));
  await p;

  assert.equal(save.getAttribute('aria-disabled'), null, 'the busy mark goes after a refusal');
  assert.equal(err.textContent, 'QA r38 refused.', 'the refusal shows on the form');
  assert.equal(world.active, save, 'focus is still on Save');
});

test('sign out one device: the button keeps focus while it waits, a second press sends nothing, and the page redraws after success', async () => {
  const d = deferred();
  useApi({ post: (p) => { world.calls.push(['post', p]); return d.promise; } });
  const root = await mount();
  const btn = signOutButton(root, 'Old phone');
  assert.ok(btn, 'the Sign out button for Old phone is on the page');
  btn.focus();

  const first = press(btn);
  await settle();
  assert.equal(btn.getAttribute('aria-disabled'), 'true', 'the button is busy while the request runs');
  assert.equal(btn.disabled, false, 'the button is not natively disabled');
  assert.equal(world.active, btn, 'focus stays on the button');

  const second = press(btn);
  await settle();
  assert.deepEqual(world.calls, [['post', '/account/sessions/2/logout']], 'a second press sends no second request');
  d.resolve({});
  await Promise.all([first, second]);
  await settle();

  assert.ok(world.toasts.some((t) => t.text === 'Signed out Old phone.'), 'the signed-out message shows');
  assert.equal(world.rerenders, 1, 'the page redraws after success');
  assert.equal(findAll(root, (n) => n === btn).length, 0, 'the pressed button is replaced by the redraw');
});

test('sign out one device: a refusal removes the busy mark and keeps focus on the button', async () => {
  const d = deferred();
  useApi({ post: (p) => { world.calls.push(['post', p]); return d.promise; } });
  const root = await mount();
  const btn = signOutButton(root, 'Tablet');
  btn.focus();

  const p = press(btn);
  await settle();
  assert.equal(btn.getAttribute('aria-disabled'), 'true', 'the button is busy while the request runs');
  assert.equal(world.active, btn, 'focus stays on the button');
  d.reject(new Error('QA r38 refused.'));
  await p;

  assert.equal(btn.getAttribute('aria-disabled'), null, 'the busy mark goes after a refusal');
  assert.equal(world.active, btn, 'focus is still on the button');
  assert.ok(world.toasts.some((t) => t.text === 'QA r38 refused.' && t.kind === 'error'), 'the refusal shows as an error');
  assert.equal(world.rerenders, 0, 'no redraw after a refusal');
});

test('sign out all other devices: asks first, then keeps focus while it waits and a second press asks and sends nothing', async () => {
  const d = deferred();
  useApi({ post: (p) => { world.calls.push(['post', p]); return d.promise; } });
  const root = await mount();
  const btn = signOutOthersButton(root);
  assert.ok(btn, 'the Sign out all other devices button is on the page');
  btn.focus();

  const first = press(btn);
  await settle();
  assert.deepEqual(world.questions, ['Sign out other devices?'], 'the question comes first');
  assert.equal(btn.getAttribute('aria-disabled'), 'true', 'the button is busy while the request runs');
  assert.equal(btn.disabled, false, 'the button is not natively disabled');
  assert.equal(world.active, btn, 'focus stays on the button');

  const second = press(btn);
  await settle();
  assert.equal(world.questions.length, 1, 'a second press asks nothing');
  assert.deepEqual(world.calls, [['post', '/account/sessions/logout-others']], 'a second press sends no second request');
  d.resolve({ signed_out: 2 });
  await Promise.all([first, second]);
  await settle();

  assert.ok(world.toasts.some((t) => t.text === 'Signed out 2 other devices.'), 'the signed-out message shows');
  assert.equal(world.rerenders, 1, 'the page redraws after success');
  assert.equal(findAll(root, (n) => n === btn).length, 0, 'the pressed button is replaced by the redraw');
});

test('sign out all other devices: a refusal removes the busy mark and keeps focus', async () => {
  const d = deferred();
  useApi({ post: (p) => { world.calls.push(['post', p]); return d.promise; } });
  const root = await mount();
  const btn = signOutOthersButton(root);
  btn.focus();

  const p = press(btn);
  await settle();
  assert.equal(btn.getAttribute('aria-disabled'), 'true', 'the button is busy while the request runs');
  d.reject(new Error('QA r38 refused.'));
  await p;

  assert.equal(btn.getAttribute('aria-disabled'), null, 'the busy mark goes after a refusal');
  assert.equal(world.active, btn, 'focus is still on the button');
  assert.ok(world.toasts.some((t) => t.text === 'QA r38 refused.' && t.kind === 'error'), 'the refusal shows as an error');
  assert.equal(world.rerenders, 0, 'no redraw after a refusal');
});

test('sign out all other devices: cancelling the question sends nothing and leaves no busy mark', async () => {
  useApi();
  world.confirm = async () => false;
  const root = await mount();
  const btn = signOutOthersButton(root);
  btn.focus();

  await press(btn);
  await settle();
  assert.deepEqual(world.questions, ['Sign out other devices?']);
  assert.deepEqual(world.calls, [], 'nothing is sent');
  assert.equal(btn.getAttribute('aria-disabled'), null, 'no busy mark');
  assert.equal(world.active, btn, 'focus stays on the button');
});
