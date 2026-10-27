'use strict';
require('./helpers');

// QA round 50, PHOTOTYPE (ONB50-1, DEP50-S1; D-132). A photo-only box refuses a file that is not a JPG, PNG or WEBP photo on the
// device, before any request: the listing photos box (after the resize) and the deposit photo box. uploadFile takes an optional
// `kinds`, so a renamed file in a photo-only box is called "not a real JPG, PNG or WEBP". Frontend only: no database, no server.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '..', 'public', 'js');
const LISTING_LINE = 'Upload a photo (JPG, PNG or WEBP) up to 10 MB.';
const DEPOSIT_LINE = 'Upload a JPG, PNG or WEBP photo up to 10 MB.';
const PHOTO_SENTENCE = "This file isn't a real JPG, PNG or WEBP. Choose the file again.";
const PDF_SENTENCE = "This file isn't a real PDF, JPG, PNG or WEBP. Choose the file again.";
const flush = () => new Promise((r) => setTimeout(r, 0));

class ApiError extends Error {
  constructor(message, { status, code, fields } = {}) { super(message); this.status = status; this.code = code; this.fields = fields; }
}
const fileRefused = (err) => ['EMPTY_FILE', 'BAD_FILE_CONTENT', 'UNSUPPORTED_FILE'].includes(err?.code) || err?.status === 413 || err?.status === 415;

// A tiny stand-in page: nodes with attributes, listeners and children; `files` and `value` as a file box has them.
function makeDom() {
  const node = (tag) => ({
    tagName: tag.toUpperCase(), attrs: {}, children: [], listeners: {}, files: [], value: '', textContent: '',
    classList: { add() {}, remove() {}, contains: () => false },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    focus() {}, select() {},
    replaceChildren(...kids) { this.children = []; this.append(...kids); },
    append(...kids) { for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false && k !== true) this.children.push(typeof k === 'object' ? k : { tagName: '#TEXT', textContent: String(k), children: [] }); },
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; },
    querySelectorAll(sel) {
      const out = [];
      const walk = (x) => x.children.forEach((c) => { if (sel === 'input[type="file"]' ? (c.tagName === 'INPUT' && c.attrs.type === 'file') : false) out.push(c); walk(c); });
      walk(this);
      return out;
    },
  });
  const h = (tag, props, ...kids) => {
    const n = node(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false || k === 'style') continue;
      if (/^on[a-z]+$/.test(k)) n.listeners[k.slice(2)] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    n.append(...kids);
    return n;
  };
  const find = (root, pred) => { for (const c of root.children || []) { if (pred(c)) return c; const hit = find(c, pred); if (hit) return hit; } return null; };
  return { h, find };
}

// ---- (a) the listing photos box --------------------------------------------------------------------------------------------
function listingWorld(shrunkType) {
  const { h } = makeDom();
  const log = { apis: [], shown: [], toasts: [] };
  const stubs = {
    h, ApiError, fileRefused,
    get: async () => ({ photos: [] }),
    post: async () => ({}),
    api: async (method, url, query, opts) => { log.apis.push({ method, url, opts }); return {}; },
    fileContentError: async () => null,
    PHOTO_KINDS: 'JPG, PNG or WEBP',
    uploadField: (input) => ({ wrap: h('div', {}, input), show: (msg) => log.shown.push(msg), clear() {} }),
    openModal: (opts) => { log.body = opts.body; return { close() {}, el: {} }; },
    confirmDialog: async () => true,
    toast: (msg, kind) => log.toasts.push({ msg, kind }),
    shrink: async (f) => ({ ...f, type: shrunkType }),
  };
  return { log, stubs };
}
async function runListing(shrunkType) {
  const SRC = fs.readFileSync(path.join(JS, 'views', 'listings.js'), 'utf8');
  const start = SRC.indexOf('async function photosModal(');
  assert.notEqual(start, -1);
  const fn = SRC.slice(start, SRC.indexOf('\n}\n', start) + 3);
  const world = listingWorld(shrunkType);
  const names = Object.keys(world.stubs);
  const { photosModal } = new Function(...names, `${fn}\nreturn { photosModal };`)(...names.map((k) => world.stubs[k]));
  await photosModal({ unit_id: 7, unit_name: 'QA r50 phototype loft' });
  const input = world.log.body.querySelector('input[type="file"]');
  input.files = [{ name: 'QA r50 phototype', size: 4, type: 'image/jpeg' }];
  await input.listeners.change();
  await flush();
  return world.log;
}

test('listing photos: a PDF left unchanged by the resize is refused on the device, in the server\'s words', async () => {
  const log = await runListing('application/pdf');
  assert.equal(log.apis.length, 0, 'no request is sent');
  assert.deepEqual(log.shown, [LISTING_LINE], 'the line under the box names JPG, PNG or WEBP');
  assert.deepEqual(log.toasts, [], 'a refused file is not toasted');
});

test('listing photos: a JPEG, a PNG or a WEBP after the resize is sent, once', async () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    const log = await runListing(type);
    assert.equal(log.apis.length, 1, `${type} is sent`);
    assert.deepEqual(log.shown, []);
    assert.deepEqual(log.toasts.map((t) => t.msg), ['Photos uploaded.']);
  }
});

// ---- (b) the deposit photo box ---------------------------------------------------------------------------------------------
const STUBS = {
  'package.json': '{"type":"module"}',
  'api.js': [
    'export const get = (...a) => globalThis.__r50.get(...a);',
    'export const post = (...a) => globalThis.__r50.post(...a);',
    'export const uploadFile = (...a) => globalThis.__r50.uploadFile(...a);',
    "export const qs = () => '';",
    "export const PHOTO_KINDS = 'JPG, PNG or WEBP';",
  ].join('\n'),
  'filters.js': 'export const initFilters = () => ({}); export const filterBar = () => null; export const changed = () => ({}); export const apiFilters = () => ({});',
  'app.js': "export const state = { user: { role: 'owner' } };",
  'ui.js': [
    'const S = () => globalThis.__r50;',
    'export const h = (tag, props, ...kids) => S().h(tag, props, ...kids);',
    "export const peso = (n) => 'PHP ' + Number(n).toFixed(2);",
    'export const fmtDate = (d) => String(d);',
    'export const fmtDateTime = (d) => String(d);',
    'export const field = () => null;',
    'export const formModal = () => null;',
    'export const confirmDialog = async () => true;',
    'export const toast = (msg, kind) => S().toast(msg, kind);',
    "export const badge = (cls, text) => S().h('span', { class: cls }, text);",
    "export const todayManila = () => '2026-10-27';",
    "export const emptyState = () => S().h('div', {});",
    "export const parseAmount = (s) => Number(String(s).replace(/[^0-9.-]/g, ''));",
    "export const fileRefused = (err) => ['EMPTY_FILE', 'BAD_FILE_CONTENT', 'UNSUPPORTED_FILE'].includes(err?.code) || err?.status === 413 || err?.status === 415;",
    'export function uploadField(input) {',
    "  const line = S().h('div', { class: 'error', role: 'alert' });",
    "  const wrap = S().h('div', { class: 'field' }, input, line);",
    "  const clear = () => { line.textContent = ''; };",
    "  const show = (msg) => { line.textContent = msg; };",
    '  return { wrap, show, clear };',
    '}',
  ].join('\n'),
};
const DEPOSIT = {
  suggested: 1000, suggested_deduction: 0,
  deposit: { deposit_id: 9, amount: '1000.00', method: 'cash', received_date: '2026-10-20', reference_number: null, deduction_amount: '0.00', deduction_reason: null, refund_amount: null, refund_method: null, refund_reference: null, settled_at: null, status: 'held', files: [] },
};
let deposits;
let tmp;
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-phototype-r50-'));
  for (const [name, text] of Object.entries(STUBS)) fs.writeFileSync(path.join(tmp, name), text);
  fs.mkdirSync(path.join(tmp, 'views'));
  fs.writeFileSync(path.join(tmp, 'views', 'deposits.js'), fs.readFileSync(path.join(JS, 'views', 'deposits.js'), 'utf8'));
  deposits = await import(pathToFileURL(path.join(tmp, 'views', 'deposits.js')).href);
});
test.after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

async function mountDeposit() {
  const { h, find } = makeDom();
  const ctx = { h, uploads: [], toasts: [], get: async () => DEPOSIT, post: async () => { throw new Error('no post expected'); }, toast: (m, k) => ctx.toasts.push({ m, k }) };
  ctx.uploadFile = (...args) => { ctx.uploads.push(args); return Promise.resolve({}); };
  globalThis.__r50 = ctx;
  const card = await deposits.depositCard({ booking_id: 7, status: 'checked_in', check_out: '2026-10-30', checked_out_at: null, guest_email: null, guest_has_email: false }, () => {});
  const input = find(card, (n) => n.tagName === 'INPUT' && n.attrs.type === 'file');
  const line = find(card, (n) => n.attrs?.role === 'alert');
  assert.ok(input && line, 'the deposit card has its photo box and its line');
  return { ctx, input, line };
}

test('deposit photo box: a PDF is refused on the device, no upload, the box is not left busy', async () => {
  const { ctx, input, line } = await mountDeposit();
  input.files = [{ name: 'QA r50 phototype.pdf', type: 'application/pdf', size: 8 }];
  await input.listeners.change();
  assert.equal(ctx.uploads.length, 0, 'no upload');
  assert.equal(line.textContent, DEPOSIT_LINE);
  assert.equal(input.getAttribute('aria-disabled'), null, 'the box is not busy');
  assert.equal(input.value, '', 'the chosen file is cleared');
  assert.deepEqual(ctx.toasts, []);
});

test('deposit photo box: a PNG is uploaded once, with PHOTO_KINDS as the fourth argument', async () => {
  const { ctx, input, line } = await mountDeposit();
  const png = { name: 'QA r50 phototype.png', type: 'image/png', size: 8 };
  input.files = [png];
  await input.listeners.change();
  assert.equal(ctx.uploads.length, 1);
  assert.deepEqual(ctx.uploads[0], ['deposit', 9, png, 'JPG, PNG or WEBP']);
  assert.equal(line.textContent, '');
});

// ---- (c) uploadFile's `kinds` ----------------------------------------------------------------------------------------------
test('uploadFile: a renamed text file in a photo-only box is not a real JPG, PNG or WEBP; without kinds the PDF sentence stays', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-phototype-api-r50-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    fs.copyFileSync(path.join(JS, 'api.js'), path.join(dir, 'api.js'));
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) }; };
    const api = await import(pathToFileURL(path.join(dir, 'api.js')).href);
    const fake = () => new File(['this is plain text, not a picture'], 'x.png', { type: 'image/png' });
    await assert.rejects(api.uploadFile('deposit', 9, fake(), api.PHOTO_KINDS), (e) => e.message === PHOTO_SENTENCE && e.code === 'BAD_FILE_CONTENT' && e.status === 415);
    await assert.rejects(api.uploadFile('deposit', 9, fake()), (e) => e.message === PDF_SENTENCE);
    assert.equal(calls, 0, 'no request is sent');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
