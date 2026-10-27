'use strict';
require('./helpers');

// QA round 49, PRESSGUARD (C1, D-126/D-131): the conversation composer and the assistant's Send each swallow their own second press.
// Both are their own <form>, not makeForm, so guardPress (ui.js) was never installed: the answer came back in 10 to 20 ms, the box
// was redrawn or emptied, and a quick second press said "Write a note first." / "Type a question first." after the first had worked.
// Frontend only, no database. The real renderThread() (inbox.js) and buildPanel() (assistant.js, through openAssistant) run from temp
// copies with stand-in modules, as qa-r39-inbox.test.js does; the stand-in guardPress records the calls it gets.
// R49_INBOX_SRC / R49_ASSIST_SRC (optional) point the test at another copy of the file; 3c55fec's copy proves it red.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const INBOX_SRC = process.env.R49_INBOX_SRC || path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js');
const ASSIST_SRC = process.env.R49_ASSIST_SRC || path.join(__dirname, '..', 'public', 'js', 'assistant.js');
const LIB = '__r49_pressguard_lib';

class FakeNode {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.value = '';
    this.hidden = false;
    this._classes = new Set();
    this._text = '';
  }
  get isConnected() { return true; }
  focus() {}
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() { const s = this._classes; return { contains: (c) => s.has(c), toggle: (c, f) => { const on = f ?? !s.has(c); if (on) s.add(c); else s.delete(c); return on; } }; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(ev) {
    const e = { preventDefault() {}, stopPropagation() {}, ...ev, target: this, currentTarget: this };
    return (this.listeners[ev.type] || []).map((fn) => fn(e));
  }
  append(...nodes) {
    for (const c of nodes.flat(Infinity)) {
      if (c === null || c === undefined || c === false || c === true) continue;
      if (c instanceof FakeNode) this.children.push(c); else this._text += String(c);
    }
  }
  contains() { return false; }
  closest() { return null; }
  querySelector(sel) { return all(this).find((n) => n.tagName === sel.toUpperCase()) || null; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  requestSubmit() {}
  setSelectionRange() {}
}

const all = (n) => n.children.flatMap((c) => [c, ...all(c)]);

function h(tag, props, ...children) {
  const el = new FakeNode(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') continue;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' && ['input', 'textarea', 'select'].includes(tag)) el.value = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  el.append(...children);
  return el;
}

const guardCalls = [];
const lib = {
  h,
  icon: () => new FakeNode('span'),
  toast: () => {},
  fmtDateTime: (v) => String(v),
  fmtDate: () => '',
  peso: () => '',
  badge: () => null,
  confirmDialog: async () => true,
  openModal: () => ({ close() {} }),
  guardPress: (e, el) => { guardCalls.push({ e, el }); },
  get: async (url) => {
    if (url.startsWith('/inbox/assignees')) return { assignees: [] };
    if (url === '/message-templates') return { templates: [] };
    return { conversation: CONVO, messages: [] };
  },
  post: async () => ({}),
  patch: async () => ({}),
  qs: () => '',
};

const UI_NAMES = ['h', 'icon', 'toast', 'fmtDateTime', 'fmtDate', 'peso', 'badge', 'confirmDialog', 'openModal', 'guardPress'];
const uiStub = [`const L = globalThis.${LIB};`, ...UI_NAMES.map((n) => `export const ${n} = (...a) => L.${n}(...a);`),
  'export const field = () => null; export const formModal = () => null; export const emptyState = () => null;',
  "export const todayManila = () => '2026-10-27';"].join('\n');
const apiStub = [`const L = globalThis.${LIB};`, ...['get', 'post', 'patch', 'qs'].map((n) => `export const ${n} = (...a) => L.${n}(...a);`)].join('\n');

const CONVO = {
  conversation_id: 'c-r49-pg', booking_id: 'b-r49-pg', guest_name: 'QA r49 pressguard Guest', guest_email: 'qa-r49-pg@example.test',
  guest_phone: null, unit_name: 'QA r49 pressguard Unit', property_name: 'QA r49 pressguard Property', check_in: '2027-09-06', check_out: '2027-09-08',
  channel: 'direct', status: 'open', booking_status: 'confirmed', confirmation_code: 'BH-R49PG', num_guests: 2, total_amount: '0', balance: '0',
  snoozed_until: null, assigned_to: null, assigned_name: null, checked_in_at: null, checked_out_at: null,
};

let dir; let inboxDir; let renderThread; let assistant;
test.before(async () => {
  globalThis[LIB] = lib;
  globalThis.document = { documentElement: {}, body: { append(el) { globalThis.__r49_panel = el; } }, querySelector: () => null };
  globalThis.getComputedStyle = () => ({ scrollPaddingBottom: '0px' });
  globalThis.window = { innerHeight: 800 };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r49-pg-'));
  inboxDir = path.join(dir, 'inbox');
  const assistDir = path.join(dir, 'assist');
  fs.mkdirSync(path.join(inboxDir, 'views'), { recursive: true });
  fs.mkdirSync(assistDir);
  for (const d of [inboxDir, assistDir]) fs.writeFileSync(path.join(d, 'package.json'), '{"type":"module"}');
  const files = {
    [inboxDir]: {
      'ui.js': uiStub, 'api.js': apiStub,
      'app.js': 'export const state = { user: null };\nexport const navigate = () => {};\n',
      'filters.js': 'export const initFilters = () => {}; export const filterBar = () => null; export const rememberFilters = () => {}; export const changed = () => false; export const apiFilters = () => ({});',
      'views/reservations.js': 'export const CHANNEL_LABEL = {};\n',
    },
    [assistDir]: {
      'ui.js': uiStub, 'api.js': apiStub,
      'app.js': "export const state = { user: { role: 'owner', full_name: 'QA r49' } };\nexport const navigate = () => {};\n",
    },
  };
  for (const [d, fs2] of Object.entries(files)) for (const [f, text] of Object.entries(fs2)) fs.writeFileSync(path.join(d, f), `${text}\n`);
  fs.writeFileSync(path.join(inboxDir, 'views', 'inbox.js'), `${fs.readFileSync(INBOX_SRC, 'utf8')}\nexport { renderThread };\n`);
  fs.writeFileSync(path.join(assistDir, 'assistant.js'), fs.readFileSync(ASSIST_SRC, 'utf8'));
  ({ renderThread } = await import(pathToFileURL(path.join(inboxDir, 'views', 'inbox.js')).href));
  assistant = await import(pathToFileURL(path.join(assistDir, 'assistant.js')).href);
});
test.after(() => {
  delete globalThis[LIB];
  delete globalThis.document;
  delete globalThis.getComputedStyle;
  delete globalThis.window;
  delete globalThis.__r49_panel;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const sendButton = (root) => {
  const b = all(root).find((n) => n.tagName === 'BUTTON' && n.getAttribute('type') === 'submit' && n.textContent === 'Send');
  assert.ok(b, 'the Send button is on the page');
  return b;
};

test('the conversation composer: a press on Send goes through guardPress with the Send button', async () => {
  const pane = new FakeNode('div');
  await renderThread(pane, CONVO.conversation_id, { status: { sending: true, replies: { configured: true, last_error: null }, ai_drafts: false }, back: '#/inbox', rerender() {} });
  const btn = sendButton(pane);
  guardCalls.length = 0;
  const press = { type: 'click', detail: 1, clientX: 10, clientY: 10 };
  btn.dispatchEvent(press);
  assert.equal(guardCalls.length, 1, 'one press installs one guard');
  assert.equal(guardCalls[0].el, btn, 'the guard is given the Send button');
  assert.equal(guardCalls[0].e.detail, 1, 'the guard is given the press itself');
});

test('the assistant: a press on Send goes through guardPress with the Send button', () => {
  assistant.openAssistant();
  const panel = globalThis.__r49_panel;
  assert.ok(panel, 'the panel is built');
  const btn = sendButton(panel);
  guardCalls.length = 0;
  btn.dispatchEvent({ type: 'click', detail: 1, clientX: 10, clientY: 10 });
  assert.equal(guardCalls.length, 1, 'one press installs one guard');
  assert.equal(guardCalls[0].el, btn, 'the guard is given the Send button');
});

test('source: guardPress is imported from ui.js and installed on sendBtn in both files', () => {
  const inbox = fs.readFileSync(INBOX_SRC, 'utf8');
  const assist = fs.readFileSync(ASSIST_SRC, 'utf8');
  assert.match(inbox, /import \{[^}]*\bguardPress\b[^}]*\} from '\.\.\/ui\.js'/);
  assert.match(assist, /import \{[^}]*\bguardPress\b[^}]*\} from '\.\/ui\.js'/);
  for (const src of [inbox, assist]) assert.match(src, /sendBtn\.addEventListener\('click', \(e\) => guardPress\(e, sendBtn\)\)/);
});
