'use strict';
require('./helpers');

// QA round 50, KEEPTEXT (Contract C1, D-132): a press sends what the box held at the press; text typed after it is kept.
// Inbox composer (note and guest message, with the subject) and Help's reply boxes (the host's ticket page and the staff page).
// While a send waits, a second press is still refused (D-121); when the answer returns, a box that changed since the press is not
// wiped, and the next press sends it. A box that did not change is cleared as before. Frontend only, no database.
// The real inbox.js and help.js run from temp copies with stand-in modules, as qa-r39-inbox and qa-r38-help do.
// R50_INBOX_SRC / R50_HELP_SRC (optional) point the test at the 200d2c7 copies, to prove it red.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const INBOX_SRC = process.env.R50_INBOX_SRC || path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js');
const HELP_SRC = process.env.R50_HELP_SRC || path.join(__dirname, '..', 'public', 'js', 'views', 'help.js');

// ---- inbox: stand-in DOM and modules -----------------------------------------------------------------------------------------
class FakeNode {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.parent = null; this.listeners = {}; this.dataset = {};
    this.value = ''; this.hidden = false; this.placeholder = ''; this._classes = new Set(); this._text = ''; this.disabled = false;
  }
  get isConnected() { return true; }
  focus() {}
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const set = this._classes;
    return { contains: (c) => set.has(c), toggle: (c, f) => { const on = f ?? !set.has(c); if (on) set.add(c); else set.delete(c); return on; } };
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(ev) {
    const e = { type: ev.type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} };
    const out = (this.listeners[ev.type] || []).map((fn) => fn(e));
    e.currentTarget = null;
    return out;
  }
  append(...nodes) {
    for (const c of nodes.flat(Infinity)) {
      if (c === null || c === undefined || c === false || c === true) continue;
      if (c instanceof FakeNode) { c.parent = this; this.children.push(c); } else this._text += String(c);
    }
  }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  closest(sel) { for (let x = this; x; x = x.parent) if (x._classes.has(sel.replace(/^\./, ''))) return x; return null; }
  replaceChildren(...nodes) { for (const c of this.children) c.parent = null; this.children = []; this.append(...nodes); }
  setSelectionRange() {}
}
function h(tag, props, ...children) {
  const el = new FakeNode(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' && ['input', 'textarea', 'select'].includes(tag)) el.value = v;
    else if (k === 'disabled' || k === 'hidden' || k === 'checked' || k === 'selected') el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  el.append(...children);
  return el;
}

const LIB = '__r50_keeptext_lib';
const toasts = [];
const posts = [];
let rerenders = 0;
const store = new Map();
const lib = {
  h,
  icon: () => new FakeNode('span'),
  toast: (msg, kind = 'info') => { toasts.push({ msg, kind }); },
  fmtDateTime: (v) => String(v), fmtDate: () => '', peso: () => '', badge: () => null,
  confirmDialog: async () => true,
  openModal: () => ({ close() {} }),
  get: async (url) => {
    if (url.startsWith('/inbox/assignees')) return { assignees: [] };
    if (url === '/message-templates') return { templates: [] };
    return { conversation: CONVO, messages: [] };
  },
  // A write waits until the test settles it.
  post: (url, body) => new Promise((resolve, reject) => { posts.push({ url, body, resolve, reject }); }),
  patch: () => new Promise(() => {}),
  qs: () => '',
};
const STUBS = {
  'ui.js': [
    `const L = globalThis.${LIB};`,
    'export const h = (...a) => L.h(...a);',
    'export const icon = (...a) => L.icon(...a);',
    'export const toast = (...a) => L.toast(...a);',
    'export const guardPress = () => {};',
    'export const fmtDateTime = (...a) => L.fmtDateTime(...a);',
    'export const fmtDate = (...a) => L.fmtDate(...a);',
    'export const peso = (...a) => L.peso(...a);',
    'export const badge = (...a) => L.badge(...a);',
    'export const confirmDialog = (...a) => L.confirmDialog(...a);',
    'export const openModal = (...a) => L.openModal(...a);',
    'export const field = () => null; export const formModal = () => null; export const emptyState = () => null;',
    "export const todayManila = () => '2026-10-27';",
  ].join('\n'),
  'api.js': [
    `const L = globalThis.${LIB};`,
    'export const get = (...a) => L.get(...a);',
    'export const post = (...a) => L.post(...a);',
    'export const patch = (...a) => L.patch(...a);',
    'export const qs = (...a) => L.qs(...a);',
  ].join('\n'),
  'app.js': 'export const state = { user: null };\nexport const navigate = () => {};\n',
  'filters.js': [
    'export const initFilters = () => {};', 'export const filterBar = () => null;', 'export const rememberFilters = () => {};',
    'export const changed = () => false;', 'export const apiFilters = () => ({});',
  ].join('\n'),
  'views/reservations.js': 'export const CHANNEL_LABEL = {};\n',
};

const CONVO = {
  conversation_id: 'c-r50-kt', booking_id: 'b-r50-kt', guest_name: 'QA r50 keeptext Guest', guest_email: 'qa-r50-kt@example.test',
  guest_phone: null, unit_name: 'QA r50 keeptext Unit', property_name: 'QA r50 keeptext Property', check_in: '2027-09-06', check_out: '2027-09-08',
  channel: 'direct', status: 'open', booking_status: 'confirmed', confirmation_code: 'BH-R50KT', num_guests: 2, total_amount: '0', balance: '0',
  snoozed_until: null, assigned_to: null, assigned_name: null, checked_in_at: null, checked_out_at: null,
};
const STATUS = { sending: true, replies: { configured: true, last_error: null }, ai_drafts: false };
const DRAFT = `bh-draft:msg:${CONVO.conversation_id}`;
const MODE = `bh-draft:mode:${CONVO.conversation_id}`;
const SUBJ = `bh-draft:subj:${CONVO.conversation_id}`;
const SUBJ_TPL = `bh-draft:subjtpl:${CONVO.conversation_id}`;

const dirs = [];
let renderThread;
test.before(async () => {
  globalThis[LIB] = lib;
  globalThis.sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ scrollPaddingBottom: '0px' });
  globalThis.window = { innerHeight: 800 };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r50-kt-inbox-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const [file, text] of Object.entries(STUBS)) fs.writeFileSync(path.join(dir, file), `${text}\n`);
  fs.writeFileSync(path.join(dir, 'views', 'inbox.js'), `${fs.readFileSync(INBOX_SRC, 'utf8')}\nexport { renderThread };\n`);
  ({ renderThread } = await import(pathToFileURL(path.join(dir, 'views', 'inbox.js')).href));
});
after(() => {
  delete globalThis[LIB];
  delete globalThis.sessionStorage;
  delete globalThis.document;
  delete globalThis.getComputedStyle;
  delete globalThis.window;
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const all = (n) => n.children.flatMap((c) => [c, ...all(c)]);
const one = (root, pred, what) => {
  const hit = all(root).find(pred);
  assert.ok(hit, `${what} is on the page`);
  return hit;
};

// Opens the composer in the given mode ('note' or 'message') with an empty draft store.
async function mountComposer(mode) {
  posts.length = 0; toasts.length = 0; rerenders = 0; store.clear();
  const pane = h('div', { class: 'inbox__thread' });
  await renderThread(pane, CONVO.conversation_id, { status: STATUS, back: '#/inbox', rerender: () => { rerenders += 1; } });
  const tab = one(pane, (n) => n.tagName === 'BUTTON' && n.textContent === (mode === 'note' ? 'Internal note' : 'Message guest'), 'the mode tab');
  tab.dispatchEvent({ type: 'click' });
  const form = one(pane, (n) => n.tagName === 'FORM' && n.className.includes('composer'), 'the composer');
  const body = one(form, (n) => n.tagName === 'TEXTAREA', 'the box');
  const subject = one(form, (n) => n.tagName === 'INPUT' && n.attrs.name === 'subject', 'the subject');
  const type = (el, v) => { el.value = v; el.dispatchEvent({ type: 'input' }); };
  const press = () => form.dispatchEvent({ type: 'submit' })[0];
  return { body, subject, type, press };
}
const answer = (status, mentions = []) => ({ message: { status, scheduled_at: null }, mentions });

test('note: text typed while the save waits is kept (draft holds it, the page redraws); the second press sends nothing', async () => {
  const { body, type, press } = await mountComposer('note');
  type(body, 'QA r50 kt A1');
  const first = press();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.body, 'QA r50 kt A1');
  assert.equal(posts[0].body.note, true);
  type(body, 'QA r50 kt A2');
  await press();
  assert.equal(posts.length, 1, 'a press during the wait sends no second post (D-121)');
  posts[0].resolve(answer('note'));
  await first;
  assert.equal(store.get(DRAFT), 'QA r50 kt A2', 'the draft holds what was typed after the press');
  assert.equal(store.get(MODE), 'note');
  assert.equal(rerenders, 1);
  assert.equal(toasts.at(-1).msg, 'Note saved.');
});

test('note: nothing typed after the press, the draft is removed (as before)', async () => {
  const { body, type, press } = await mountComposer('note');
  type(body, 'QA r50 kt B1');
  assert.ok(store.has(DRAFT));
  const first = press();
  posts[0].resolve(answer('note'));
  await first;
  assert.equal(store.has(DRAFT), false);
  assert.equal(store.has(MODE), false);
  assert.equal(rerenders, 1);
});

test('note: the toast is about what was saved, not about the box now', async () => {
  const { body, type, press } = await mountComposer('note');
  type(body, 'QA r50 kt hello @nobody');
  const first = press();
  type(body, 'QA r50 kt hello');
  posts[0].resolve(answer('note'));
  await first;
  assert.match(toasts.at(-1).msg, /^Note saved\. Nobody was notified/);
});

test('guest message: the box and the subject typed during the wait are both kept; the toast reads Sent.', async () => {
  const { body, subject, type, press } = await mountComposer('message');
  type(body, 'QA r50 kt M1');
  type(subject, 'QA r50 kt S1');
  const first = press();
  assert.equal(posts[0].body.subject, 'QA r50 kt S1');
  assert.equal(posts[0].body.note, false);
  type(body, 'QA r50 kt M2');
  type(subject, 'QA r50 kt S2');
  await press();
  assert.equal(posts.length, 1);
  posts[0].resolve(answer('sent'));
  await first;
  assert.equal(store.get(DRAFT), 'QA r50 kt M2');
  assert.equal(store.get(SUBJ), 'QA r50 kt S2');
  assert.equal(toasts.at(-1).msg, 'Sent.');
  assert.equal(rerenders, 1);
});

test('guest message: only the box changed, the unchanged subject is dropped and nothing typed leaves both removed', async () => {
  const a = await mountComposer('message');
  a.type(a.body, 'QA r50 kt M1');
  a.type(a.subject, 'QA r50 kt S1');
  const first = a.press();
  a.type(a.body, 'QA r50 kt M2');
  posts[0].resolve(answer('sent'));
  await first;
  assert.equal(store.get(DRAFT), 'QA r50 kt M2');
  assert.equal(store.has(SUBJ), false, 'the subject did not change, so it is dropped');
  assert.equal(store.has(SUBJ_TPL), false);

  const b = await mountComposer('message');
  b.type(b.body, 'QA r50 kt M3');
  b.type(b.subject, 'QA r50 kt S3');
  const second = b.press();
  posts[0].resolve(answer('sent'));
  await second;
  assert.equal(store.has(DRAFT), false);
  assert.equal(store.has(SUBJ), false);
  assert.equal(store.has(MODE), false);
});

// ---- help ------------------------------------------------------------------------------------------------------------------
const hnode = (tag) => {
  const n = {
    tagName: String(tag).toUpperCase(), isText: false, parentNode: null, children: [], attrs: {}, handlers: {}, classes: new Set(),
    textContent: '', value: '', checked: false, files: [], disabled: false,
    classList: {
      add: (...c) => c.forEach((x) => n.classes.add(x)), remove: (...c) => c.forEach((x) => n.classes.delete(x)),
      toggle: (x, on) => { const w = on === undefined ? !n.classes.has(x) : Boolean(on); if (w) n.classes.add(x); else n.classes.delete(x); return w; },
      contains: (x) => n.classes.has(x),
    },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener() {},
    focus() {},
    append(k) {
      if (k === null || k === undefined || k === false) return;
      const c = typeof k === 'string' || typeof k === 'number' ? { isText: true, text: String(k) } : k;
      c.parentNode = this; this.children.push(c);
    },
    replaceChildren(...kids) { this.children = []; kids.flat(Infinity).forEach((k) => this.append(k)); },
  };
  return n;
};
const hh = (tag, props, ...kids) => {
  const n = hnode(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (typeof v === 'function' && k.startsWith('on')) n.handlers[k] = v;
    else if (k === 'class') v.split(' ').filter(Boolean).forEach((c) => n.classes.add(c));
    else if (k !== 'style' && k !== 'dataset' && v !== null && v !== undefined && v !== false) n.attrs[k] = v === true ? '' : String(v);
  }
  n.replaceChildren(...kids);
  return n;
};
const textOf = (n) => (n.isText ? n.text : n.textContent + n.children.map(textOf).join(''));
const hall = (root) => root.children.filter((c) => !c.isText).flatMap((c) => [c, ...hall(c)]);
const hfind = (root, pred, what) => { const n = hall(root).find(pred); assert.ok(n, `${what} is on the page`); return n; };
const byLabel = (root, label) => hfind(root, (n) => n.attrs['aria-label'] === label, `"${label}"`);
const button = (root, text) => hfind(root, (n) => n.tagName === 'BUTTON' && textOf(n).trim() === text, `button "${text}"`);

const hposts = [];
const htoasts = [];
const fixtures = {};
const HLIB = '__r50_keeptext_help';
const hstate = { user: { role: 'owner', business_type: 'stays', is_platform_admin: true } };
globalThis[HLIB] = {
  ui: {
    h: hh, icon: () => hh('span', null), fmtDateTime: () => 'QA r50 date', badge: (k, t) => hh('span', null, t || k), field: () => hh('div', null),
    makeForm: () => hh('form', null), emptyState: () => hh('div', null), searchBox: () => hh('div', null),
    pageHead: (o) => hh('div', null, hh('h1', null, o.title), o.actions), toast: (msg, kind) => { htoasts.push({ msg, kind }); },
    confirmDialog: async () => true, filesList: () => hh('div', null), label: (x) => String(x),
  },
  api: {
    get: async (p) => fixtures[p],
    post: (p, body) => new Promise((resolve, reject) => { hposts.push({ path: p, body, resolve, reject }); }),
    uploadFile: () => new Promise(() => {}), qs: () => '', fileContentError: async () => null,
  },
  state: hstate,
  navigate: () => {},
};
const fwd = (names, key) => names.map((n) => `export const ${n} = (...a) => globalThis.${HLIB}.${key}.${n}(...a);`).join('\n');
const HSTUBS = {
  'api.js': fwd(['get', 'post', 'qs', 'uploadFile', 'fileContentError'], 'api'),
  'ui.js': fwd(['h', 'icon', 'fmtDateTime', 'badge', 'field', 'makeForm', 'emptyState', 'searchBox', 'pageHead', 'toast', 'confirmDialog', 'filesList', 'label'], 'ui'),
  'app.js': `export const state = globalThis.${HLIB}.state;\nexport const navigate = (...a) => globalThis.${HLIB}.navigate(...a);\n`,
  'themeswitch.js': "export const currentTheme = () => 'light';\n",
  'assistant.js': 'export const assistantEnabled = async () => false;\nexport const openAssistant = () => {};\n',
  'filters.js': 'export const initFilters = () => ({});\nexport const filterBar = () => null;\nexport const rememberFilters = () => {};\nexport const changed = () => false;\n',
};
let help = null;
async function loadHelp() {
  if (help) return help;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r50-kt-help-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const [name, code] of Object.entries(HSTUBS)) fs.writeFileSync(path.join(dir, name), code);
  fs.writeFileSync(path.join(dir, 'views', 'help.js'), fs.readFileSync(HELP_SRC, 'utf8'));
  fs.writeFileSync(path.join(dir, 'views', 'inbox.js'), 'export const scrollToNewest = () => {};');
  help = await import(pathToFileURL(path.join(dir, 'views', 'help.js')).href);
  return help;
}
const TICKET = {
  ticket_id: 'T50', number: 'BH-T-5001', subject: 'QA r50 ticket', category_label: "Something isn't working", priority: 'normal',
  status: 'in_progress', created_at: '2026-10-27T01:00:00Z', updated_at: '2026-10-27T01:00:00Z', created_by_name: 'QA r50',
  rating: null, rating_comment: null, can_reopen: false, first_response_at: null, context: {}, assigned_to: null,
};
async function openTicket() {
  hposts.length = 0; htoasts.length = 0;
  fixtures['/support/tickets/T50'] = { ticket: { ...TICKET }, messages: [], events: [], files: [] };
  const root = hnode('div');
  await (await loadHelp()).helpTicketView(root, { params: { id: 'T50' }, rerender: () => {} });
  return root;
}
async function openAdmin() {
  hposts.length = 0; htoasts.length = 0;
  fixtures['/admin/support/tickets/T50'] = { ticket: { ...TICKET, status: 'new' }, messages: [], events: [], files: [], workspace: { name: 'QA r50 ws', plan: 'growth' } };
  const root = hnode('div');
  await (await loadHelp()).adminSupportTicketView(root, { params: { id: 'T50' }, rerender: () => {} });
  return root;
}
const hpress = (el) => el.handlers.onclick({ currentTarget: el, target: el, preventDefault() {} });

test('Help: a reply typed while Send reply waits is in the redrawn box; a second press sends nothing', async () => {
  const root = await openTicket();
  const box = byLabel(root, 'Your reply');
  const send = hfind(root, (n) => n.attrs['data-focus-key'] === 'ticket-reply', 'Send reply');
  box.value = 'QA r50 r1';
  const done = hpress(send);
  assert.equal(hposts.length, 1);
  assert.deepEqual(hposts[0].body, { body: 'QA r50 r1' });
  box.value = 'QA r50 r2';
  hpress(send);
  assert.equal(hposts.length, 1, 'a second press sends nothing');
  hposts[0].resolve({});
  await done;
  assert.equal(htoasts.at(-1).msg, 'Sent to support.');
  const again = await openTicket();
  assert.equal(byLabel(again, 'Your reply').value, 'QA r50 r2', 'the new view holds what was typed after the press');
  const third = await openTicket();
  assert.equal(byLabel(third, 'Your reply').value, '', 'and it is put back only once');
});

test('Help: nothing typed after Send reply, the redrawn box is empty', async () => {
  const root = await openTicket();
  const send = hfind(root, (n) => n.attrs['data-focus-key'] === 'ticket-reply', 'Send reply');
  byLabel(root, 'Your reply').value = 'QA r50 r3';
  const done = hpress(send);
  hposts[0].resolve({});
  await done;
  const again = await openTicket();
  assert.equal(byLabel(again, 'Your reply').value, '');
});

test('Staff reply: text typed while Send waits is in the redrawn box; nothing typed leaves it empty', async () => {
  const root = await openAdmin();
  const box = byLabel(root, 'Reply');
  const send = button(root, 'Send');
  box.value = 'QA r50 s1';
  const done = hpress(send);
  assert.equal(hposts.length, 1);
  assert.deepEqual(hposts[0].body, { body: 'QA r50 s1', internal: false });
  box.value = 'QA r50 s2';
  hposts[0].resolve({});
  await done;
  assert.equal(htoasts.at(-1).msg, 'Reply sent to the customer.');
  const again = await openAdmin();
  assert.equal(byLabel(again, 'Reply').value, 'QA r50 s2');

  const root2 = await openAdmin();
  byLabel(root2, 'Reply').value = 'QA r50 s3';
  const done2 = hpress(button(root2, 'Send'));
  hposts[0].resolve({});
  await done2;
  assert.equal(byLabel(await openAdmin(), 'Reply').value, '');
});
