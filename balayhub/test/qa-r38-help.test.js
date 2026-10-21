'use strict';
require('./helpers');

// QA round 38, HELP (rows 21 to 23, Contract C1, D-120). Send reply, Send rating and the staff buttons (Assign to me, Mark resolved,
// Send, the status chips) are marked aria-disabled while their own request runs, so the pressed control keeps focus; a second press
// sends nothing. The real help.js runs from a temp copy whose imports are stand-ins, on a small stand-in DOM whose focus drops to the
// body when a focused control is switched off with disabled (as a browser does). Frontend only: no database.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/views/help.js'), 'utf8');

// ---- stand-in DOM ----------------------------------------------------------------------------------------------------------
const dom = { active: null, body: null };

function node(tag) {
  let off = false;
  const n = {
    tagName: String(tag).toUpperCase(), isText: false, parentNode: null, children: [], attrs: {}, handlers: {},
    classes: new Set(), textContent: '', value: '', checked: false, files: [],
    classList: {
      add: (...c) => c.forEach((x) => n.classes.add(x)),
      remove: (...c) => c.forEach((x) => n.classes.delete(x)),
      toggle: (x, on) => { const want = on === undefined ? !n.classes.has(x) : Boolean(on); if (want) n.classes.add(x); else n.classes.delete(x); return want; },
      contains: (x) => n.classes.has(x),
    },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener() {},
    focus() { if (!this.disabled) dom.active = this; },
    append(k) {
      if (k === null || k === undefined || k === false) return;
      const c = typeof k === 'string' || typeof k === 'number' ? { isText: true, text: String(k) } : k;
      c.parentNode = this;
      this.children.push(c);
    },
    replaceChildren(...kids) {
      this.children.forEach((c) => { c.parentNode = null; });
      this.children = [];
      kids.flat(Infinity).forEach((k) => this.append(k));
    },
    querySelectorAll(sel) {
      const out = [];
      const walk = (p) => p.children.forEach((c) => {
        if (c.isText) return;
        if (sel.startsWith('.') ? c.classes.has(sel.slice(1)) : c.tagName === sel.toUpperCase()) out.push(c);
        walk(c);
      });
      walk(this);
      return out;
    },
  };
  // A control switched off with disabled drops focus to the body (the stand-in rule for this lane).
  Object.defineProperty(n, 'disabled', {
    enumerable: true,
    get: () => off,
    set: (v) => { off = Boolean(v); if (off && dom.active === n) dom.active = dom.body; },
  });
  return n;
}

// The stand-in for ui.js's h(): attributes, classes and click handlers; nested arrays are flattened, empty children dropped.
function h(tag, props, ...kids) {
  const n = node(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (typeof v === 'function' && k.startsWith('on')) n.handlers[k] = v;
    else if (k === 'class') v.split(' ').filter(Boolean).forEach((c) => n.classes.add(c));
    else if (k !== 'style' && k !== 'dataset' && v !== null && v !== undefined && v !== false) n.attrs[k] = v === true ? '' : String(v);
  }
  n.replaceChildren(...kids);
  return n;
}

const textOf = (n) => (n.isText ? n.text : n.textContent + n.children.map(textOf).join(''));
// Every element under root that matches pred, in page order.
function all(root, pred) {
  const out = [];
  const walk = (p) => p.children.forEach((c) => {
    if (c.isText) return;
    if (pred(c)) out.push(c);
    walk(c);
  });
  walk(root);
  return out;
}
function find(root, pred, what) {
  const [n] = all(root, pred);
  assert.ok(n, `${what} is on the page`);
  return n;
}
const byId = (root, id) => find(root, (n) => n.attrs.id === id, `#${id}`);
const byLabel = (root, label) => find(root, (n) => n.attrs['aria-label'] === label, `"${label}"`);
const button = (root, text) => find(root, (n) => n.tagName === 'BUTTON' && textOf(n).trim() === text, `button "${text}"`);
const sendReply = (root) => find(root, (n) => n.attrs['data-focus-key'] === 'ticket-reply', 'Send reply');

// ---- stand-ins for the modules help.js imports ------------------------------------------------------------------------------
const state = { user: { role: 'owner', business_type: 'stays', is_platform_admin: true } };
const fixtures = {};
const posts = [];
const uploads = [];
const toasts = [];
let rerenders = 0;
const ui = {
  h,
  icon: () => h('span', null),
  fmtDateTime: () => 'QA r38 date',
  badge: (kind, text) => h('span', null, text || kind),
  field: () => h('div', null),
  makeForm: () => h('form', null),
  emptyState: () => h('div', null),
  searchBox: () => h('div', null),
  pageHead: (o) => h('div', null, h('h1', null, o.title), o.actions),
  toast: (msg, kind) => { toasts.push({ msg, kind }); },
  confirmDialog: async () => true,
  filesList: () => h('div', null),
  label: (x) => String(x),
};
const api = {
  get: async (p) => {
    if (!(p in fixtures)) throw new Error(`QA r38 test: no fixture for ${p}`);
    return fixtures[p];
  },
  // Each request waits until the test settles it, so the state during the wait can be read.
  post: (p, body) => new Promise((resolve, reject) => { posts.push({ path: p, body, resolve, reject }); }),
  uploadFile: (kind, id, file) => new Promise((resolve, reject) => { uploads.push({ kind, id, file, resolve, reject }); }),
  qs: () => '',
  fileContentError: async () => null,
};
globalThis.__qaR38Help = { ui, api, state, navigate: () => {} };

const forward = (names, key) => names.map((n) => `export const ${n} = (...a) => globalThis.__qaR38Help.${key}.${n}(...a);`).join('\n');
const STUBS = {
  'api.js': forward(['get', 'post', 'qs', 'uploadFile', 'fileContentError'], 'api'),
  'ui.js': forward(['h', 'icon', 'fmtDateTime', 'badge', 'field', 'makeForm', 'emptyState', 'searchBox', 'pageHead', 'toast', 'confirmDialog', 'filesList', 'label'], 'ui'),
  'app.js': 'export const state = globalThis.__qaR38Help.state;\nexport const navigate = (...a) => globalThis.__qaR38Help.navigate(...a);\n',
  'themeswitch.js': "export const currentTheme = () => 'light';\n",
  'assistant.js': 'export const assistantEnabled = async () => false;\nexport const openAssistant = () => {};\n',
  'filters.js': 'export const initFilters = () => ({});\nexport const filterBar = () => null;\nexport const rememberFilters = () => {};\nexport const changed = () => false;\n',
};

let help = null;
let dir = null;
async function loadHelp() {
  if (help) return help;
  // The copy and its stubs live in a temp folder; the real file is never changed by this test.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r38-help-'));
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const [name, code] of Object.entries(STUBS)) fs.writeFileSync(path.join(dir, name), code);
  fs.writeFileSync(path.join(dir, 'views', 'help.js'), SRC);
  fs.writeFileSync(path.join(dir, 'views', 'inbox.js'), 'export const scrollToNewest = () => {};');
  help = await import(pathToFileURL(path.join(dir, 'views', 'help.js')).href);
  return help;
}
after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

// ---- helpers for the tests -----------------------------------------------------------------------------------------------
const TICKET = {
  ticket_id: 'T1', number: 'BH-T-1001', subject: 'QA r38 ticket', category_label: "Something isn't working", priority: 'normal',
  status: 'in_progress', created_at: '2026-10-20T01:00:00Z', updated_at: '2026-10-20T01:00:00Z', created_by_name: 'QA r38',
  rating: null, rating_comment: null, can_reopen: false, first_response_at: null, context: {}, assigned_to: null,
};
const rerender = () => { rerenders += 1; };

function reset() {
  posts.length = 0;
  uploads.length = 0;
  toasts.length = 0;
  rerenders = 0;
  dom.body = node('body');
  dom.active = dom.body;
}
async function openTicket(over) {
  reset();
  fixtures['/support/tickets/T1'] = { ticket: { ...TICKET, ...over }, messages: [], events: [], files: [] };
  const root = node('div');
  await (await loadHelp()).helpTicketView(root, { params: { id: 'T1' }, rerender });
  return root;
}
async function openAdminTicket(over) {
  reset();
  fixtures['/admin/support/tickets/T1'] = {
    ticket: { ...TICKET, status: 'new', ...over }, messages: [], events: [], files: [], workspace: { name: 'QA r38 workspace', plan: 'growth' },
  };
  const root = node('div');
  await (await loadHelp()).adminSupportTicketView(root, { params: { id: 'T1' }, rerender });
  return root;
}
// A real press focuses the control, then runs its click handler with the event the browser gives it.
function press(el) {
  el.focus();
  return el.handlers.onclick({ currentTarget: el, target: el, preventDefault() {} });
}
const refused = (msg = 'QA r38 refused.') => Object.assign(new Error(msg), { status: 409 });

// ---- Send reply (rows 21: lines 270, 277, 285) -----------------------------------------------------------------------
test('Send reply keeps focus and is aria-disabled while its request runs; a second press sends nothing', async () => {
  const root = await openTicket({});
  const reply = byLabel(root, 'Your reply');
  const send = sendReply(root);
  reply.value = 'QA r38 reply';

  const done = press(send);
  assert.equal(posts.length, 1, 'the reply is sent once');
  assert.equal(posts[0].path, '/support/tickets/T1/reply');
  assert.equal(send.getAttribute('aria-disabled'), 'true', 'busy while the request runs');
  assert.notEqual(send.disabled, true, 'never natively disabled');
  assert.equal(dom.active, send, 'focus stays on Send reply');

  press(send);
  assert.equal(posts.length, 1, 'a second press sends no second request');

  posts[0].resolve({});
  await done;
  assert.equal(rerenders, 1, 'the view redraws after the reply');
  assert.equal(toasts.at(-1).msg, 'Sent to support.');
});

test('Send reply: a refused reply leaves the button usable again, still focused, with the error toast', async () => {
  const root = await openTicket({});
  byLabel(root, 'Your reply').value = 'QA r38 reply';
  const send = sendReply(root);

  const done = press(send);
  posts[0].reject(refused());
  await done;
  assert.equal(send.getAttribute('aria-disabled'), null, 'busy mark removed after the refusal');
  assert.equal(send.disabled, false);
  assert.equal(dom.active, send, 'focus stays on the button after the refusal');
  assert.equal(toasts.at(-1).msg, 'QA r38 refused.');
  assert.equal(rerenders, 0);
});

test('Send reply: a refused attachment ends on the file box with the busy mark gone and the reply text kept', async () => {
  const root = await openTicket({});
  const reply = byLabel(root, 'Your reply');
  const attach = byId(root, 'reply-attach');
  const attachError = byId(root, 'reply-attach-err');
  const send = sendReply(root);
  reply.value = 'QA r38 reply';
  attach.files = [{ name: 'QA r38.png', size: 0, type: 'image/png' }];

  const done = press(send);
  assert.equal(uploads.length, 1, 'the file upload starts');
  assert.equal(send.getAttribute('aria-disabled'), 'true');
  assert.equal(dom.active, send);

  uploads[0].reject(Object.assign(new Error('This file is empty. Choose the file again.'), { code: 'EMPTY_FILE', status: 400 }));
  await done;
  assert.equal(send.getAttribute('aria-disabled'), null, 'busy mark removed');
  assert.equal(send.disabled, false);
  assert.equal(attachError.textContent, 'This file is empty. Choose the file again.');
  assert.equal(dom.active, attach, 'focus moves to the file box');
  assert.equal(posts.length, 0, 'no reply is sent');
  assert.equal(reply.value, 'QA r38 reply', 'the reply text stays');
});

// ---- Send rating (row 22: lines 299, 300) ----------------------------------------------------------------------------
test('Send rating keeps focus and is aria-disabled while its request runs; a second press sends nothing', async () => {
  const root = await openTicket({ status: 'resolved', can_reopen: true });
  press(byLabel(root, '4 out of 5'));
  const rate = button(root, 'Send rating');

  const done = press(rate);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, '/support/tickets/T1/rate');
  assert.deepEqual(posts[0].body, { rating: 4, comment: null });
  assert.equal(rate.getAttribute('aria-disabled'), 'true', 'busy while the request runs');
  assert.notEqual(rate.disabled, true, 'never natively disabled');
  assert.equal(dom.active, rate, 'focus stays on Send rating');

  press(rate);
  assert.equal(posts.length, 1, 'a second press sends no second rating');

  posts[0].resolve({});
  await done;
  assert.equal(rerenders, 1);
  assert.equal(toasts.at(-1).msg, 'Thanks for the feedback!');
});

test('Send rating: a refused rating leaves the button usable again, still focused, with the error toast', async () => {
  const root = await openTicket({ status: 'resolved', can_reopen: true });
  press(byLabel(root, '3 out of 5'));
  const rate = button(root, 'Send rating');

  const done = press(rate);
  posts[0].reject(refused());
  await done;
  assert.equal(rate.getAttribute('aria-disabled'), null, 'busy mark removed after the refusal');
  assert.equal(rate.disabled, false);
  assert.equal(dom.active, rate, 'focus stays on the button after the refusal');
  assert.equal(toasts.at(-1).msg, 'QA r38 refused.');
  assert.equal(rerenders, 0);
});

// ---- staff actions on the support queue (row 23: lines 396, 397) -----------------------------------------------------------
test('Assign to me keeps focus and is aria-disabled while its request runs; a refusal ends usable and focused', async () => {
  const root = await openAdminTicket({});
  const assign = button(root, 'Assign to me');

  const done = press(assign);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, '/admin/support/tickets/T1/assign');
  assert.equal(assign.getAttribute('aria-disabled'), 'true', 'busy while the request runs');
  assert.notEqual(assign.disabled, true, 'never natively disabled');
  assert.equal(dom.active, assign, 'focus stays on Assign to me');

  press(assign);
  assert.equal(posts.length, 1, 'a second press sends no second request');

  posts[0].reject(refused());
  await done;
  assert.equal(assign.getAttribute('aria-disabled'), null, 'busy mark removed after the refusal');
  assert.equal(assign.disabled, false);
  assert.equal(dom.active, assign, 'focus stays on the button after the refusal');
  assert.equal(toasts.at(-1).msg, 'QA r38 refused.');
  assert.equal(rerenders, 0);
});

test('Send (staff reply) keeps focus and is aria-disabled while its request runs; a second press sends nothing', async () => {
  const root = await openAdminTicket({});
  byLabel(root, 'Reply').value = 'QA r38 staff reply';
  const send = button(root, 'Send');

  const done = press(send);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, '/admin/support/tickets/T1/reply');
  assert.deepEqual(posts[0].body, { body: 'QA r38 staff reply', internal: false });
  assert.equal(send.getAttribute('aria-disabled'), 'true', 'busy while the request runs');
  assert.notEqual(send.disabled, true, 'never natively disabled');
  assert.equal(dom.active, send, 'focus stays on Send');

  press(send);
  assert.equal(posts.length, 1, 'a second press sends no second reply');

  posts[0].resolve({});
  await done;
  assert.equal(rerenders, 1);
  assert.equal(toasts.at(-1).msg, 'Reply sent to the customer.');
});

// ---- source guard -----------------------------------------------------------------------------------------------------
test('help.js switches no control off with disabled', () => {
  assert.doesNotMatch(SRC, /\.disabled\s*=/);
});
