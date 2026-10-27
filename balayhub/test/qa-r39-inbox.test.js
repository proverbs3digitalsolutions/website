'use strict';
require('./helpers');

// QA round 39, INBOX (D-121: a press that waits is busy, and a press hands its wait to the button; audit rows 28 to 30).
// Snooze (the chosen time), the scheduled message's Cancel and the conversation's assignee select each wait for their own request:
// the control is marked aria-disabled (dimmed, not disabled, so it keeps focus), a second press or change sends nothing, and the
// mark goes when the request ends, after success or after a refusal. Frontend only, no database.
//
// The real renderThread() from public/js/views/inbox.js runs in a temp folder with stand-in ui.js, api.js, app.js, filters.js and
// reservations.js modules, as qa-r38-inbox does. The copy adds one export line; the product file is read as it is.
// R39_INBOX_SRC (optional) points the test at another copy of inbox.js; the copy at 1b4bd92 is used to prove this test red.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = process.env.R39_INBOX_SRC || path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js');
const LIB = '__r39_inbox_lib';

class FakeNode {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.dataset = {};
    this.value = '';
    this.hidden = false;
    this.placeholder = '';
    this._disabled = false;
    this._classes = new Set();
    this._text = '';
  }
  // Every stand-in node is on the page, so scrollToNewest does not wait for it.
  get isConnected() { return true; }
  get disabled() { return this._disabled; }
  set disabled(v) { this._disabled = Boolean(v); }
  focus() {}
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const set = this._classes;
    return {
      contains: (c) => set.has(c),
      toggle: (c, force) => { const on = force ?? !set.has(c); if (on) set.add(c); else set.delete(c); return on; },
    };
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  // As in a browser: currentTarget is this element while its listeners run, and null once the dispatch ends.
  // Returns what each listener returned, so a test can await the promise a press handler gives back.
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

// Same mapping as public/js/ui.js h().
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

const toasts = [];
const posts = [];
const patches = [];
const modals = [];
let closes = 0;
let rerenders = 0;
let convo = null;
let msgs = [];

// A write waits until the test settles it, so the test can look at the page while the request is still pending.
function hold(list) {
  return (url, body) => {
    const rec = { url, body };
    list.push(rec);
    return new Promise((resolve, reject) => { rec.resolve = resolve; rec.reject = reject; });
  };
}

const ASSIGNEES = [{ user_id: 'u-r39-ana', full_name: 'Ana Cruz' }, { user_id: 'u-r39-ben', full_name: 'Ben Lim' }];

const lib = {
  h,
  icon: () => new FakeNode('span'),
  toast: (msg, kind = 'info') => { toasts.push({ msg, kind }); },
  fmtDateTime: (v) => String(v),
  fmtDate: () => '',
  peso: () => '',
  badge: () => null,
  confirmDialog: async () => true,
  openModal: (opts) => { modals.push(opts); return { close: () => { closes += 1; } }; },
  get: async (url) => {
    if (url.startsWith('/inbox/assignees')) return { assignees: ASSIGNEES };
    if (url === '/message-templates') return { templates: [] };
    return { conversation: convo, messages: msgs };
  },
  post: hold(posts),
  patch: hold(patches),
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
    "export const todayManila = () => '2026-10-21';",
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
    'export const initFilters = () => {};',
    'export const filterBar = () => null;',
    'export const rememberFilters = () => {};',
    'export const changed = () => false;',
    'export const apiFilters = () => ({});',
  ].join('\n'),
  'views/reservations.js': 'export const CHANNEL_LABEL = {};\n',
};

let dir;
let renderThread;
test.before(async () => {
  globalThis[LIB] = lib;
  // scrollToNewest reads the page's scroll padding once the thread is on the page; the stand-in page has none.
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ scrollPaddingBottom: '0px' });
  globalThis.window = { innerHeight: 800 };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r39-inbox-'));
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const [file, text] of Object.entries(STUBS)) fs.writeFileSync(path.join(dir, file), `${text}\n`);
  // renderThread() is not exported. The copy adds one export line; the product file is read as it is.
  fs.writeFileSync(path.join(dir, 'views', 'inbox.js'), `${fs.readFileSync(SRC, 'utf8')}\nexport { renderThread };\n`);
  ({ renderThread } = await import(pathToFileURL(path.join(dir, 'views', 'inbox.js')).href));
});
test.after(() => {
  delete globalThis[LIB];
  delete globalThis.document;
  delete globalThis.getComputedStyle;
  delete globalThis.window;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const CONVO = {
  conversation_id: 'c-r39-inbox', booking_id: 'b-r39-inbox', guest_name: 'QA r39 inbox Guest', guest_email: 'qa-r39-inbox@example.test',
  guest_phone: null, unit_name: 'QA r39 inbox Unit A', property_name: 'QA r39 inbox Property', check_in: '2027-09-06', check_out: '2027-09-08',
  channel: 'direct', status: 'open', booking_status: 'confirmed', confirmation_code: 'BH-R39INBOX', num_guests: 2, total_amount: '0', balance: '0',
  snoozed_until: null, assigned_to: 'u-r39-ana', assigned_name: 'Ana Cruz', checked_in_at: null, checked_out_at: null,
};
const STATUS = { sending: true, replies: { configured: true, last_error: null }, ai_drafts: false };
const SCHEDULED = {
  message_id: 'msg-r39-inbox-1', direction: 'out', status: 'scheduled', kind: 'automated', subject: '', body: 'QA r39 inbox scheduled',
  to_email: 'qa-r39-inbox@example.test', sent_by_name: 'Ana Cruz', from_name: null, scheduled_at: '2027-09-01T01:00:00Z',
  created_at: '2026-10-21T01:00:00Z', sent_at: null,
};

function reset(messages) {
  posts.length = 0;
  patches.length = 0;
  toasts.length = 0;
  modals.length = 0;
  closes = 0;
  rerenders = 0;
  msgs = messages;
}

async function mountThread(messages = []) {
  reset(messages);
  convo = CONVO;
  const pane = h('div', { class: 'inbox__thread' });
  await renderThread(pane, CONVO.conversation_id, { status: STATUS, back: '#/inbox', rerender: () => { rerenders += 1; } });
  return pane;
}

const all = (n) => n.children.flatMap((c) => [c, ...all(c)]);
const one = (root, pred, what) => {
  const hit = all(root).find(pred);
  assert.ok(hit, `${what} is on the page`);
  return hit;
};
const snoozeButton = (pane) => one(pane, (n) => n.tagName === 'BUTTON' && n.textContent === 'Snooze', 'the Snooze button');
const assignSelect = (pane) => one(pane, (n) => n.tagName === 'SELECT' && n.getAttribute('aria-label') === 'Conversation assigned to', 'the assignee select');
const threeHoursChoice = (snoozeList) => one(snoozeList, (n) => n.tagName === 'BUTTON' && n.textContent.startsWith('3 hours'), 'the 3 hours choice');
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

test('Snooze: the chosen time keeps Snooze marked while it saves, a second press opens no second time list, and the mark goes after the save', async () => {
  const pane = await mountThread();
  const snooze = snoozeButton(pane);
  snooze.dispatchEvent({ type: 'click' });
  assert.equal(modals.length, 1, 'pressing Snooze opens the time list once');
  assert.equal(snooze.getAttribute('aria-disabled'), null, 'opening the time list does not dim Snooze');
  const [saved] = threeHoursChoice(modals[0].body).dispatchEvent({ type: 'click' });
  assert.equal(closes, 1, 'the time list closes');
  assert.equal(patches.length, 1, 'one save is sent');
  assert.equal(patches[0].url, `/inbox/${CONVO.conversation_id}`);
  assert.equal(snooze.getAttribute('aria-disabled'), 'true', 'Snooze is marked busy while the snooze saves');
  assert.notEqual(snooze.disabled, true, 'Snooze is not natively disabled');
  snooze.dispatchEvent({ type: 'click' });
  assert.equal(modals.length, 1, 'a second press on Snooze opens no second time list');
  patches[0].resolve({});
  await saved;
  assert.equal(snooze.getAttribute('aria-disabled'), null, 'the busy mark goes when the save ends');
  assert.equal(rerenders, 1, 'the thread redraws once');
  assert.ok(toasts.some((t) => t.msg.startsWith('Snoozed until ') && t.kind === 'info'), 'the snooze is confirmed');
});

test('Snooze: a refused save releases Snooze, says why, and redraws nothing', async () => {
  const pane = await mountThread();
  const snooze = snoozeButton(pane);
  snooze.dispatchEvent({ type: 'click' });
  const [saved] = threeHoursChoice(modals[0].body).dispatchEvent({ type: 'click' });
  assert.equal(snooze.getAttribute('aria-disabled'), 'true', 'Snooze is marked busy while the snooze saves');
  patches[0].reject(new Error('QA r39 refused.'));
  await saved;
  assert.equal(snooze.getAttribute('aria-disabled'), null, 'the busy mark goes after a refusal');
  assert.ok(toasts.some((t) => t.msg === 'QA r39 refused.' && t.kind === 'error'), 'the refusal is said');
  assert.equal(rerenders, 0, 'nothing is redrawn after a refusal');
});

test('the assignee select keeps the value being saved, puts back a second change, sends one save, and releases its mark after success', async () => {
  const pane = await mountThread();
  const sel = assignSelect(pane);
  sel.value = 'u-r39-ben';
  const [saved] = sel.dispatchEvent({ type: 'change' });
  assert.equal(patches.length, 1, 'one save is sent');
  assert.equal(patches[0].url, `/inbox/${CONVO.conversation_id}`);
  assert.deepEqual(patches[0].body, { assigned_to: 'u-r39-ben' });
  assert.equal(sel.getAttribute('aria-disabled'), 'true', 'the select is marked busy while the assignment saves');
  assert.notEqual(sel.disabled, true, 'the select is not natively disabled');
  sel.value = 'u-r39-ana';
  sel.dispatchEvent({ type: 'change' });
  assert.equal(sel.value, 'u-r39-ben', 'a second change is put back to the value being saved');
  assert.equal(patches.length, 1, 'a second change sends no second save');
  patches[0].resolve({});
  await saved;
  assert.equal(sel.getAttribute('aria-disabled'), null, 'the busy mark goes when the save ends');
  assert.equal(sel.dataset.saving, undefined, 'the value being saved is cleared');
  assert.equal(rerenders, 1, 'the thread redraws once');
});

test('a refused assignment releases the select mark and says why', async () => {
  const pane = await mountThread();
  const sel = assignSelect(pane);
  sel.value = 'u-r39-ben';
  const [saved] = sel.dispatchEvent({ type: 'change' });
  assert.equal(sel.getAttribute('aria-disabled'), 'true', 'the select is marked busy while the assignment saves');
  patches[0].reject(Object.assign(new Error('QA r39 refused.'), { fields: { assigned_to: 'QA r39 refused.' } }));
  await saved;
  assert.equal(sel.getAttribute('aria-disabled'), null, 'the busy mark goes after a refusal');
  assert.ok(toasts.some((t) => t.msg === 'QA r39 refused.' && t.kind === 'error'), 'the refusal is said');
});

test('Cancel on a scheduled message waits for its save: the handler stays pending while the save is pending and settles after success', async () => {
  const pane = await mountThread([SCHEDULED]);
  const cancel = one(pane, (n) => n.tagName === 'BUTTON' && n.textContent === 'Cancel', 'the Cancel button of the scheduled message');
  const [handler] = cancel.dispatchEvent({ type: 'click' });
  const state = await Promise.race([handler.then(() => 'settled'), wait(20).then(() => 'pending')]);
  assert.equal(state, 'pending', 'the handler waits while the cancel is saved');
  assert.equal(posts.length, 1, 'one cancel is sent');
  assert.equal(posts[0].url, `/inbox/messages/${SCHEDULED.message_id}/cancel`);
  posts[0].resolve({});
  await handler;
  assert.ok(toasts.some((t) => t.msg === 'Scheduled message cancelled.'), 'the cancel is confirmed');
});

test('Cancel on a scheduled message waits for a refused save too, then says why', async () => {
  const pane = await mountThread([SCHEDULED]);
  const cancel = one(pane, (n) => n.tagName === 'BUTTON' && n.textContent === 'Cancel', 'the Cancel button of the scheduled message');
  const [handler] = cancel.dispatchEvent({ type: 'click' });
  const state = await Promise.race([handler.then(() => 'settled'), wait(20).then(() => 'pending')]);
  assert.equal(state, 'pending', 'the handler waits while the cancel is saved');
  posts[0].reject(new Error('QA r39 refused.'));
  await handler;
  assert.ok(toasts.some((t) => t.msg === 'QA r39 refused.' && t.kind === 'error'), 'the refusal is said');
});
