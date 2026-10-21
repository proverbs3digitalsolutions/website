'use strict';
require('./helpers');

// QA round 39, HELP (LT-2; D-119 and D-121). A support ticket opens at its newest entry, as an inbox conversation does: the owner's
// ticket view and the admin's ticket view both hand their thread to scrollToNewest (inbox.js) once the thread is drawn. The real
// help.js runs from a temp copy, the real ui.js runs on a small stand-in DOM, and api.js, app.js and the other imports are
// stand-ins; views/inbox.js is a stand-in whose scrollToNewest records the thread it was given and the top of the tree at that time.
// Frontend only: no database is used.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
const SRC = fs.readFileSync(path.join(JS, 'views', 'help.js'), 'utf8');

// ---- stand-in DOM (what ui.js's h() and the views use on mount) --------------------------------------------------------------
class StandNode {
  constructor() { this.parentNode = null; this.children = []; }
  append(...kids) {
    for (const k of kids) { k.parentNode = this; this.children.push(k); }
  }
  replaceChildren(...kids) {
    this.children.forEach((c) => { c.parentNode = null; });
    this.children = [];
    this.append(...kids);
  }
}
class StandText extends StandNode {
  constructor(text) { super(); this.data = text; }
}
class StandElement extends StandNode {
  constructor(tag) {
    super();
    this.tagName = String(tag).toUpperCase();
    this.attrs = {}; this.listeners = {}; this.style = {}; this.dataset = {}; this.className = '';
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  focus() {}
}
globalThis.Node = StandNode;      // ui.js: `c instanceof Node`
globalThis.Element = StandElement; // ui.js patches Element.prototype.append and replaceChildren when it loads
globalThis.document = {
  createElement: (tag) => new StandElement(tag),
  createElementNS: (ns, tag) => new StandElement(tag),
  createTextNode: (text) => new StandText(text),
};

// The text under a node, in page order.
const textOf = (n) => (n instanceof StandText ? n.data : n.children.map(textOf).join(''));
// Every element under root that matches pred, in page order.
function walk(root, pred, out = []) {
  root.children.forEach((c) => { if (c instanceof StandElement && pred(c)) out.push(c); walk(c, pred, out); });
  return out;
}

// ---- stand-ins for the modules help.js imports (written into the temp copy) ------------------------------------------------
const STUBS = {
  'api.js': [
    'export class ApiError extends Error {}',
    'export const newIdempotencyKey = () => "qa-r39-key";',
    'export const inFlight = () => 0;',
    'const T = globalThis.__qaR39Help;',
    'export const get = async (p) => { if (!(p in T.fixtures)) throw new Error("QA r39 test: no fixture for " + p); return T.fixtures[p]; };',
    'export const post = async () => ({});',
    'export const qs = () => "";',
    'export const uploadFile = async () => ({});',
    'export const fileContentError = async () => null;',
  ].join('\n'),
  'app.js': 'export const state = globalThis.__qaR39Help.state;\nexport const navigate = () => {};\n',
  'themeswitch.js': "export const currentTheme = () => 'light';\n",
  'assistant.js': 'export const assistantEnabled = async () => false;\nexport const openAssistant = () => {};\n',
  'filters.js': 'export const initFilters = () => ({});\nexport const filterBar = () => null;\nexport const rememberFilters = () => {};\nexport const changed = () => false;\n',
  // views/inbox.js: help.js imports scrollToNewest from here; the stand-in records the thread and the top of its tree at the call.
  'views/inbox.js': [
    'export function scrollToNewest(thread) {',
    '  let top = thread;',
    '  while (top.parentNode) top = top.parentNode;',
    '  globalThis.__qaR39Help.scrolled.push({ thread, top });',
    '}',
  ].join('\n'),
};

const state = { user: { role: 'owner', business_type: 'stays', is_platform_admin: true } };
const fixtures = {};
const scrolled = [];
globalThis.__qaR39Help = { state, fixtures, scrolled };

let help = null;
let dir = null;
async function loadHelp() {
  if (help) return help;
  // The copy and its stand-ins live in a temp folder; the real help.js and ui.js are copied, never changed.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r39-help-'));
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(JS, 'ui.js'), path.join(dir, 'ui.js'));
  for (const [name, code] of Object.entries(STUBS)) fs.writeFileSync(path.join(dir, name), code);
  fs.writeFileSync(path.join(dir, 'views', 'help.js'), SRC);
  help = await import(pathToFileURL(path.join(dir, 'views', 'help.js')).href);
  return help;
}
after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

// ---- fixtures ---------------------------------------------------------------------------------------------------------------
const TICKET = {
  ticket_id: 'T1', number: 'BH-T-1039', subject: 'QA r39 ticket', category_label: "Something isn't working", priority: 'normal',
  status: 'in_progress', created_at: '2026-10-20T01:00:00Z', updated_at: '2026-10-20T01:00:00Z', created_by_name: 'QA r39',
  created_by_role: null, rating: null, rating_comment: null, can_reopen: false, first_response_at: null, context: {}, assigned_to: null,
};
// Stored out of order: the view must show the newest reply (6) as the last entry, whatever the order it was given in.
const REPLY_ORDER = [3, 1, 6, 2, 5, 4];
const messages = REPLY_ORDER.map((n) => ({
  message_id: `M${n}`, body: `QA r39 reply ${n}`, author_kind: n % 2 ? 'customer' : 'support', author_name: n % 2 ? 'QA r39' : 'BalayHub Support',
  internal: false, created_at: `2026-10-20T0${n}:00:00Z`,
}));
const bodyOf = (msg) => textOf(msg.children[0]);
const topOf = (n) => { let t = n; while (t.parentNode) t = t.parentNode; return t; };

function reset() { scrolled.length = 0; }

// The thread must be handed over once, after it is drawn under the view's own page, and its last entry must be the newest reply.
function assertOpensAtNewest(root) {
  assert.equal(scrolled.length, 1, 'scrollToNewest is called once when the ticket is drawn');
  const [{ thread, top }] = scrolled;
  assert.equal(thread.className, 'thread', 'it is given the conversation thread');
  assert.equal(top, root, 'the thread is already part of the drawn page when it is handed over');
  assert.equal(bodyOf(thread.children[thread.children.length - 1]), 'QA r39 reply 6', 'the newest reply is the last entry');
  assert.ok(walk(root, (n) => n.className === 'thread').includes(thread), 'the thread is the one on the page');
}

// ---- tests ------------------------------------------------------------------------------------------------------------------
test('the owner ticket view brings its newest reply into view once it is drawn', async () => {
  const { helpTicketView } = await loadHelp();
  reset();
  fixtures['/support/tickets/T1'] = { ticket: { ...TICKET }, messages, events: [], files: [] };
  const root = new StandElement('div');
  await helpTicketView(root, { params: { id: 'T1' }, rerender: () => {} });
  assertOpensAtNewest(root);
});

test('the admin support ticket view brings its newest reply into view once it is drawn', async () => {
  const { adminSupportTicketView } = await loadHelp();
  reset();
  state.user.is_platform_admin = true;
  fixtures['/admin/support/tickets/T1'] = {
    ticket: { ...TICKET, status: 'new' }, messages, events: [], files: [], workspace: { name: 'QA r39 workspace', plan: 'growth' },
  };
  const root = new StandElement('div');
  await adminSupportTicketView(root, { params: { id: 'T1' }, rerender: () => {} });
  assertOpensAtNewest(root);
});
