'use strict';
require('./helpers');

// QA round 38, lane LISTINGS (public/js/views/listings.js). Frontend only: no database, no server.
// C1 (D-120): a control busy with its own request keeps focus. It is marked aria-disabled, never disabled, because a
// disabled control drops focus to the page while its request runs. Rows 16 (listing photos), 17 (Sync now) and
// 18 (Connect calendar). listings.js imports the signed-in user from app.js, so photosModal, channelsModal and
// syncToastText are cut out of the source by brace matching and run against stub dependencies on a small stand-in page.
// The stand-in moves focus as a browser does: setting disabled on the focused control drops focus to the body, and
// focus() refuses a disabled or detached control.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'listings.js'), 'utf8');

const ID = /[\w$]/;
const REGEX_PREV = /[(,=:[!&|?{};+\-*%<>~^]/;
const REGEX_KW = /(?:^|[^\w$.])(?:return|typeof|case|do|else|in|of|void|delete|throw|new|yield|await)$/;

// Blank out comments, strings, template text and regex literals (keeping newlines, so offsets and lines match).
// Code inside `${ ... }` of a template literal is kept. Copied from qa-r37-awaitscan.test.js.
function mask(src) {
  const out = src.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  const stack = []; // 'brace' | 'tpl' (a `${` waiting for its `}`)
  let i = 0, prev = ''; // prev = last significant (non-space) code char
  const prevWordEnd = (at) => src.slice(Math.max(0, at - 12), at).trimEnd();
  function template() { // i is just after the opening backtick; returns when the closing backtick is reached or a `${` begins
    const start = i;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { blank(start, i); i++; prev = '`'; return false; }
      if (c === '$' && src[i + 1] === '{') { blank(start, i + 2); i += 2; stack.push('tpl'); prev = '{'; return true; }
      i++;
    }
    blank(start, i); return false;
  }
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === "'" || c === '"') {
      const s = i; i++;
      while (i < src.length && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
      i++; blank(s, i); prev = c; continue;
    }
    if (c === '`') { i++; template(); continue; }
    if (c === '/') {
      const before = prevWordEnd(i);
      const isRegex = prev === '' || REGEX_PREV.test(prev) || REGEX_KW.test(before);
      if (isRegex) {
        const s = i; i++; let cls = false;
        while (i < src.length && src[i] !== '\n') {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false;
          else if (src[i] === '/' && !cls) break;
          i++;
        }
        i++; while (i < src.length && ID.test(src[i])) i++; // flags
        blank(s, i); prev = '/'; continue;
      }
    }
    if (c === '{') { stack.push('brace'); prev = c; i++; continue; }
    if (c === '}') {
      const top = stack.pop();
      if (top === 'tpl') { blank(i, i + 1); i++; template(); continue; }
      prev = c; i++; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

function matchClose(m, i, open, close) { // m = masked text; i at `open`
  let d = 0;
  for (let k = i; k < m.length; k++) {
    if (m[k] === open) d++;
    else if (m[k] === close) { d--; if (d === 0) return k; }
  }
  return m.length;
}

// The source of `async function <name>(...) { ... }`, cut out by brace matching on the masked text.
function extractFn(name) {
  const m = mask(SRC);
  const start = m.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} is in listings.js`);
  const paren = m.indexOf('(', start);
  const open = m.indexOf('{', matchClose(m, paren, '(', ')'));
  return SRC.slice(start, matchClose(m, open, '{', '}') + 1);
}

const FNS = ['photosModal', 'channelsModal', 'syncToastText'].map(extractFn).join('\n');

// Loads the view functions with the given stub dependencies (each key becomes a parameter they read).
function load(stubs) {
  const names = Object.keys(stubs);
  return new Function(...names, `${FNS}\nreturn { photosModal, channelsModal };`)(...names.map((k) => stubs[k]));
}

class ApiError extends Error {
  constructor(message, { status, code, fields } = {}) { super(message); this.status = status; this.code = code; this.fields = fields; }
}

function deferred() {
  let resolve; let reject;
  const p = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { p, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// A small stand-in page: nodes with attributes, listeners and children, and a focus model (see the header).
function standIn() {
  const doc = { body: null, activeElement: null };
  const log = { posts: [], apis: [], toasts: [], questions: [], shown: [], modals: [], closed: 0, feeds: [], errors: [] };
  const within = (root, n) => { for (let x = n; x; x = x.parent) if (x === root) return true; return false; };
  // A node leaves the page: its parent forgets it, and focus goes to the body when it was inside.
  const drop = (n) => {
    if (n.parent) n.parent.children = n.parent.children.filter((c) => c !== n);
    n.parent = null;
    if (within(n, doc.activeElement)) doc.activeElement = doc.body;
  };
  // Selectors the views use: a tag, then classes, [attr], [attr=value] and [attr^=value] (value quoted or bare).
  const TOKEN = /\.([\w-]+)|\[([\w-]+)(?:(\^?)=(?:"([^"]*)"|([^\]"]*)))?\]/y;
  function matchOne(n, sel) {
    const tag = /^[a-z][\w-]*/i.exec(sel);
    if (tag && n.tagName !== tag[0].toUpperCase()) return false;
    let i = tag ? tag[0].length : 0;
    while (i < sel.length) {
      TOKEN.lastIndex = i;
      const m = TOKEN.exec(sel);
      if (!m) throw new Error(`stand-in cannot match selector ${sel}`);
      i = TOKEN.lastIndex;
      if (m[1] !== undefined) { if (!n.classList.contains(m[1])) return false; continue; }
      const have = n.getAttribute(m[2]);
      const want = m[4] ?? m[5];
      if (have === null) return false;
      if (want !== undefined && (m[3] === '^' ? !have.startsWith(want) : have !== want)) return false;
    }
    return true;
  }
  function node(tag) {
    return {
      tagName: tag.toUpperCase(), attrs: {}, children: [], parent: null, listeners: {}, files: [], value: '', hidden: false, tabIndex: 0,
      _disabled: false, _text: null,
      get disabled() { return this._disabled; },
      set disabled(v) { this._disabled = Boolean(v); if (this._disabled && within(this, doc.activeElement)) doc.activeElement = doc.body; },
      get textContent() { return this._text ?? this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); },
      set textContent(v) { this.replaceChildren(); this._text = String(v); },
      get classList() {
        const self = this;
        const names = () => (self.attrs.class || '').split(/\s+/).filter(Boolean);
        return {
          contains: (c) => names().includes(c),
          add: (c) => self.setAttribute('class', [...new Set([...names(), c])].join(' ')),
          remove: (c) => self.setAttribute('class', names().filter((x) => x !== c).join(' ')),
        };
      },
      get elements() {
        const map = {};
        const walk = (x) => x.children.forEach((c) => { if (typeof c === 'string') return; if (c.attrs.name !== undefined) map[c.attrs.name] = c; walk(c); });
        walk(this);
        return map;
      },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      removeAttribute(k) { delete this.attrs[k]; },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      focus() { if (!this._disabled && within(doc.body, this)) doc.activeElement = this; },
      select() {},
      append(...kids) {
        for (const k of kids.flat(Infinity)) {
          if (k === null || k === undefined || k === false) continue;
          this._text = null;
          if (typeof k === 'string') { this.children.push(k); continue; }
          drop(k); k.parent = this; this.children.push(k);
        }
      },
      replaceChildren(...kids) {
        const old = this.children;
        this.children = []; this._text = null;
        for (const c of old) if (typeof c !== 'string') drop(c);
        this.append(...kids);
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (x) => x.children.forEach((c) => { if (typeof c === 'string') return; if (matchOne(c, sel)) out.push(c); walk(c); });
        walk(this);
        return out;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; },
    };
  }
  doc.body = node('body');
  doc.activeElement = doc.body;
  const h = (tag, props, ...kids) => {
    const n = node(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false || k === 'style') continue;
      if (/^on[a-z]+$/.test(k)) n.addEventListener(k.slice(2), v);
      else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) n.setAttribute(`data-${dk}`, dv);
      else if (['disabled', 'value', 'hidden', 'tabIndex'].includes(k)) n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    n.append(...kids);
    return n;
  };
  // Dispatches an event the way a browser does: currentTarget is set while the handlers run and cleared when dispatch ends.
  const fire = (n, type, extra = {}) => {
    const evt = { type, target: n, currentTarget: n, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    const results = (n.listeners[type] || []).map((fn) => fn(evt));
    evt.currentTarget = null;
    return { evt, results };
  };
  const heading = node('h2');
  const stubs = {
    h,
    get: async (url) => (url.endsWith('/photos') ? { photos: [] } : { export_url: 'https://balayhub.test/ical/7.ics', feeds: log.feeds }),
    post: (url, body) => { const d = deferred(); log.posts.push({ url, body, d }); return d.p; },
    api: (method, url, query, opts) => { const d = deferred(); log.apis.push({ method, url, opts, d }); return d.p; },
    ApiError,
    fileContentError: async () => null,
    PHOTO_KINDS: 'JPG, PNG or WEBP',
    fileRefused: (err) => ['EMPTY_FILE', 'BAD_FILE_CONTENT', 'UNSUPPORTED_FILE'].includes(err?.code) || err?.status === 413 || err?.status === 415,
    // The real uploadField focuses the box when it shows a refusal (ui.js), so the stub does too.
    uploadField: (input) => ({ wrap: h('div', { class: 'field' }, input), show: (msg) => { log.shown.push(msg); input.focus(); }, clear() {} }),
    openModal: (opts) => {
      doc.body.append(opts.body);
      log.modals.push(opts.body);
      return { close: () => { log.closed += 1; drop(opts.body); }, el: { querySelector: () => heading } };
    },
    confirmDialog: (opts) => { const d = deferred(); log.questions.push({ opts, d }); return d.p; },
    toast: (msg, kind) => { log.toasts.push({ msg, kind }); },
    field: (spec) => h('div', { class: 'field', dataset: { field: spec.name } }, h(spec.type === 'select' ? 'select' : 'input', { name: spec.name, value: spec.value ?? '' })),
    clearErrors: () => {},
    showErrors: (form, problems) => { log.errors.push(problems); },
    fmtDateTime: (s) => String(s),
    CHANNEL_LABEL: { airbnb: 'Airbnb', booking: 'Booking.com', agoda: 'Agoda', vrbo: 'Vrbo', expedia: 'Expedia', tripcom: 'Trip.com', other: 'Other' },
    channelFromLink: () => '',
    feedLinkProblem: () => null,
    shrink: async (file) => file,
  };
  return { doc, log, fire, stubs };
}

const LISTING = { unit_id: 7, unit_name: 'QA r38 listings loft' };
const FEED = { feed_id: 3, channel: 'airbnb', host: '', url: 'https://www.airbnb.com/calendar/ical/1.ics', last_synced_at: null, last_status: null, problem_message: null, last_message: null };
const photo = (name) => ({ name, size: 4, type: 'image/jpeg' });

test('listing photos: the file box keeps focus while a photo uploads, and a second pick or click does nothing (row 16)', async () => {
  const world = standIn();
  const { photosModal } = load(world.stubs);
  await photosModal(LISTING);
  const box = world.log.modals[0];
  const input = box.querySelector('input[type="file"]');
  assert.equal(world.doc.activeElement, input, 'the box has focus when the dialog opens');

  input.files = [photo('one.jpg')];
  const pick = world.fire(input, 'change');
  assert.equal(input.getAttribute('aria-disabled'), 'true', 'busy while the photo uploads');
  assert.notEqual(input.disabled, true, 'not disabled: a disabled box drops focus to the page');
  assert.equal(world.doc.activeElement, input, 'focus stays on the box while the photo uploads');
  await flush(); // the photo reaches its request after its checks
  assert.equal(world.log.apis.length, 1, 'the photo is sent once');

  input.files = [photo('two.jpg')];
  world.fire(input, 'change');
  await flush();
  assert.equal(world.log.apis.length, 1, 'a second pick while busy sends nothing');
  assert.equal(world.fire(input, 'click').evt.defaultPrevented, true, 'the picker does not open while busy');

  world.log.apis[0].d.resolve({});
  await pick.results[0];
  await flush();
  const redrawn = box.querySelector('input[type="file"]');
  assert.notEqual(redrawn, input, 'the box is redrawn after the upload');
  assert.equal(input.getAttribute('aria-disabled'), null, 'the old box is not busy');
  assert.equal(redrawn.getAttribute('aria-disabled'), null, 'the new box is not busy');
  assert.equal(world.doc.activeElement, redrawn, 'focus lands on the redrawn box');
  assert.deepEqual(world.log.toasts.map((t) => t.msg), ['Photos uploaded.']);
});

test('listing photos: a refused photo ends the busy state and is said on the redrawn box (row 16)', async () => {
  const world = standIn();
  const { photosModal } = load(world.stubs);
  await photosModal(LISTING);
  const box = world.log.modals[0];
  const input = box.querySelector('input[type="file"]');
  input.files = [photo('one.jpg')];
  const pick = world.fire(input, 'change');
  await flush(); // the photo reaches its request after its checks
  world.log.apis[0].d.reject(new ApiError('Choose the file again.', { status: 415, code: 'BAD_FILE_CONTENT' }));
  await pick.results[0];
  await flush();
  assert.deepEqual(world.log.shown, ['Choose the file again.'], 'the refusal is said on the box');
  const redrawn = box.querySelector('input[type="file"]');
  assert.equal(input.getAttribute('aria-disabled'), null, 'the old box is not busy');
  assert.equal(redrawn.getAttribute('aria-disabled'), null, 'the new box is not busy');
  assert.equal(world.doc.activeElement, redrawn, 'focus lands on the redrawn box');
  assert.deepEqual(world.log.toasts, [], 'a refused file is not toasted');
});

test('Sync now keeps focus on its button while the sync runs, and a refused sync frees it (row 17)', async () => {
  const world = standIn();
  world.log.feeds = [FEED];
  const { channelsModal } = load(world.stubs);
  await channelsModal(LISTING, () => {});
  const sync = world.doc.body.querySelector('button[aria-label="Sync now, Airbnb"]');
  assert.ok(sync, 'the Airbnb row has its Sync now button');
  sync.focus();
  const press = world.fire(sync, 'click');
  assert.equal(sync.getAttribute('aria-disabled'), 'true', 'busy while the sync runs');
  assert.notEqual(sync.disabled, true, 'not disabled: a disabled button drops focus to the page');
  assert.equal(world.doc.activeElement, sync, 'focus stays on Sync now while the sync runs');
  world.fire(sync, 'click');
  assert.equal(world.log.posts.length, 1, 'a second press sends nothing');
  world.log.posts[0].d.reject(new ApiError('QA r38 refused.', { status: 502 }));
  await press.results[0];
  await flush();
  assert.equal(sync.getAttribute('aria-disabled'), null, 'a refused sync frees the button');
  assert.equal(world.doc.activeElement, sync, 'focus stays on Sync now after the refusal');
  assert.equal(world.log.toasts.at(-1).msg, 'QA r38 refused.');
});

test('Sync now: a sync that works closes the dialog and reopens it, so the pressed button is replaced (row 17)', async () => {
  const world = standIn();
  world.log.feeds = [FEED];
  const { channelsModal } = load(world.stubs);
  await channelsModal(LISTING, () => {});
  const sync = world.doc.body.querySelector('button[aria-label="Sync now, Airbnb"]');
  sync.focus();
  const press = world.fire(sync, 'click');
  world.log.posts[0].d.resolve({ sync: { ok: true, message: 'Synced: 2 stays' } });
  await press.results[0];
  await flush();
  assert.equal(world.log.closed, 1, 'the dialog closes after a sync that works');
  const fresh = world.doc.body.querySelector('button[aria-label="Sync now, Airbnb"]');
  assert.ok(fresh && fresh !== sync, 'the reopened dialog has its own Sync now button');
  assert.deepEqual(world.log.toasts.map((t) => t.msg), ['Synced: 2 stays']);
});

// Connect calendar: the form is filled in, the channel is set, and the first submit is the press.
async function connectForm() {
  const world = standIn();
  const { channelsModal } = load(world.stubs);
  await channelsModal(LISTING, () => {});
  const form = world.doc.body.querySelector('form');
  form.elements.channel.value = 'airbnb';
  form.elements.url.value = 'https://www.airbnb.com/calendar/ical/1.ics';
  return { world, form, connect: form.querySelector('button[type=submit]') };
}

test('Connect calendar keeps focus on its button while the link is saved, and a refused save frees it (row 18)', async () => {
  const { world, form, connect } = await connectForm();
  connect.focus();
  const press = world.fire(form, 'submit');
  assert.equal(connect.getAttribute('aria-disabled'), 'true', 'busy while the link is saved');
  assert.equal(connect.textContent, 'Connecting…');
  assert.notEqual(connect.disabled, true, 'not disabled: a disabled button drops focus to the page');
  assert.equal(world.doc.activeElement, connect, 'focus stays on Connect calendar while the request runs');
  world.fire(form, 'submit');
  assert.equal(world.log.posts.length, 1, 'a second submit sends nothing');
  world.log.posts[0].d.reject(new ApiError('QA r38 refused.', { status: 400 }));
  await press.results[0];
  await flush();
  assert.equal(connect.getAttribute('aria-disabled'), null, 'a refused save frees the button');
  assert.equal(connect.textContent, 'Connect calendar');
  assert.equal(world.doc.activeElement, connect, 'focus stays on Connect calendar after the refusal');
});

test('Connect calendar is not busy while the unusual-link question is open, and Change it puts focus back in the link (row 18)', async () => {
  const { world, form, connect } = await connectForm();
  connect.focus();
  const press = world.fire(form, 'submit');
  world.log.posts[0].d.reject(new ApiError('This link does not look like a calendar.', { status: 400, code: 'ICAL_NOT_CALENDAR' }));
  await flush();
  const question = world.log.questions.at(-1);
  assert.ok(question, 'the question opens');
  assert.equal(connect.getAttribute('aria-disabled'), null, 'not busy while the question is open');
  assert.equal(connect.textContent, 'Connect calendar');
  question.d.resolve(false);
  await press.results[0];
  await flush();
  assert.equal(world.doc.activeElement, form.elements.url, 'Change it puts focus back in the link');
  assert.equal(world.log.posts.length, 1, 'nothing is sent after Change it');
});

test('Connect calendar is busy again after Save anyway, and a second press sends nothing (row 18)', async () => {
  const { world, form, connect } = await connectForm();
  connect.focus();
  const press = world.fire(form, 'submit');
  world.log.posts[0].d.reject(new ApiError('This link does not look like a calendar.', { status: 400, code: 'ICAL_NOT_CALENDAR' }));
  await flush();
  world.log.questions.at(-1).d.resolve(true);
  await flush();
  assert.equal(world.log.posts.length, 2, 'Save anyway sends the link again');
  assert.equal(connect.getAttribute('aria-disabled'), 'true', 'busy while the second request runs');
  assert.notEqual(connect.disabled, true, 'not disabled while the second request runs');
  world.fire(form, 'submit');
  assert.equal(world.log.posts.length, 2, 'a second press sends nothing');
  world.log.posts[1].d.resolve({ feed_id: 9, sync: { ok: true, message: 'Synced: 0 stays' } });
  await press.results[0];
  await flush();
  assert.equal(world.log.closed, 1, 'the dialog closes after a connected link');
  assert.deepEqual(world.log.toasts.map((t) => t.msg), ['Connected. Synced: 0 stays']);
});
