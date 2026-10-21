'use strict';
require('./helpers');

// QA r38 MAINTENANCE (row 19, D-120): a repair request's photo or document box is busy with its own upload, so it keeps
// focus. The box is marked aria-disabled, not disabled (a disabled control drops focus to the page while it waits), and a
// pick or a click during the wait sends nothing. Frontend-only: maintenance.js is imported from a temp copy with stub
// helpers, and the detail view is mounted on the stand-in page from test/focus-world.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world } = require('./focus-world');

const SRC = path.join(__dirname, '..', 'public', 'js');
const REFUSAL = "This file isn't a real PDF, JPG, PNG or WEBP. Choose the file again.";
const PDF = { name: 'QA r38 maintenance.pdf', type: 'application/pdf', size: 10 };
const REQUEST = {
  request_id: 7, title: 'QA r38 maintenance', description: '', status: 'open', priority: 'medium', created_at: '2026-10-20',
  property_name: 'QA r38 Loft', unit_name: null, assigned_to: null, reported_by: null, estimated_cost: null, actual_cost: 0,
  resolved_at: null, cleaning_task_id: null,
};

// The helpers the view imports. Each one calls through to globalThis.__r38, which the test fills in.
const STUBS = {
  'api.js': ['get', 'post', 'patch', 'qs', 'uploadFile'],
  'ui.js': ['h', 'icon', 'peso', 'fmtDate', 'fmtDateTime', 'manilaDay', 'badge', 'label', 'options', 'field', 'formModal', 'emptyState',
    'pageHead', 'toast', 'todayManila', 'filesList', 'openModal', 'unitLabel', 'confirmDialog', 'showErrors', 'parseAmount', 'uploadField', 'fileRefused'],
  'filters.js': ['initFilters', 'filterBar', 'rememberFilters', 'changed', 'apiFilters'],
  'views/rent.js': ['expenseNeedsAsk'],
};
const STATE = { user: { role: 'owner' } };
const R = {};
globalThis.__r38 = R;

let dir;
let mt;

// The stand-in element. A control that becomes disabled while it has focus drops focus to the page body (the browser's
// behaviour this test exists for); removeAttribute is added because the view clears its busy mark with it.
function makeH(page) {
  const make = (tag) => {
    const n = page.make(tag);
    let off = false;
    Object.defineProperty(n, 'disabled', {
      get: () => off,
      set(v) { off = Boolean(v); if (off && page.activeElement === n) page.activeElement = page.body; },
      enumerable: true,
      configurable: true,
    });
    n.removeAttribute = (k) => { delete n.attrs[k]; };
    return n;
  };
  return (tag, props, ...kids) => {
    const n = make(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (typeof v === 'function') n[k] = v;
      else if (v !== false && v !== null && v !== undefined) n.setAttribute(k, v);
    }
    for (const c of kids.flat(Infinity)) {
      if (c === false || c === null || c === undefined) continue;
      if (typeof c === 'object') n.add(c); else n.textContent += String(c);
    }
    return n;
  };
}

function reset() {
  Object.assign(R, {
    navigate() {},
    qs: () => '',
    async get(url) { if (url.startsWith('/maintenance/')) return { request: REQUEST, costs: [], files: [] }; throw new Error(`unexpected GET ${url}`); },
    async post() { throw new Error('unexpected POST'); },
    async patch() { throw new Error('unexpected PATCH'); },
    uploads: [],
    uploadFile(...args) { return new Promise((resolve, reject) => { R.uploads.push({ args, resolve, reject }); }); },
    toasts: [],
    toast(msg, kind) { R.toasts.push({ msg, kind }); },
    rerenders: 0,
    shown: [],
    cleared: 0,
    fileRefused: (err) => ['EMPTY_FILE', 'BAD_FILE_CONTENT', 'UNSUPPORTED_FILE'].includes(err?.code) || err?.status === 413 || err?.status === 415,
    uploadField(input) {
      R.input = input;
      R.up = { wrap: R.h('div', null, input), clear() { R.cleared += 1; }, show(msg) { R.shown.push(msg); } };
      return R.up;
    },
    expenseNeedsAsk: () => false,
    icon: () => R.h('span'),
    badge: (t) => R.h('span', null, String(t)),
    pageHead: () => R.h('div'),
    peso: (n) => String(n),
    fmtDate: (d) => String(d),
    fmtDateTime: (d) => String(d),
    manilaDay: (d) => String(d),
    label: (s) => String(s),
    options: (xs) => xs,
    unitLabel: (s) => String(s),
    parseAmount: (s) => s,
    field: () => R.h('div'),
    formModal: () => {},
    emptyState: () => R.h('div'),
    openModal: () => {},
    showErrors: () => {},
    todayManila: () => '2026-10-21',
    filesList: () => R.h('div'),
    confirmDialog: async () => true,
    initFilters: () => ({}),
    filterBar: () => R.h('div'),
    rememberFilters: () => {},
    changed: () => ({}),
    apiFilters: () => ({}),
  });
}

// Mounts the request's detail view and returns its photo or document box, focused the way a click focuses it.
async function mount() {
  reset();
  const page = world();
  R.h = makeH(page);
  const el = { kids: [], replaceChildren(...xs) { this.kids = xs; } };
  await mt.maintenanceDetailView(el, { params: { id: REQUEST.request_id }, rerender: () => { R.rerenders += 1; } });
  R.input.focus();
  return { page, upload: R.input };
}

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-maint-r38-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const [file, names] of Object.entries(STUBS)) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, names.map((n) => `export const ${n} = (...a) => globalThis.__r38.${n}(...a);`).join('\n') + '\n');
  }
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = globalThis.__r38.state;\nexport const navigate = (...a) => globalThis.__r38.navigate(...a);\n');
  R.state = STATE;
  fs.copyFileSync(path.join(SRC, 'views', 'maintenance.js'), path.join(dir, 'views', 'maintenance.js'));
  mt = await import(pathToFileURL(path.join(dir, 'views', 'maintenance.js')));
});

test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('the first pick marks the box aria-disabled, not disabled, and keeps focus while the upload waits', async () => {
  const { page, upload } = await mount();
  upload.files = [PDF];
  const pick = upload.onchange();
  assert.equal(R.uploads.length, 1, 'one upload is sent');
  assert.equal(upload.getAttribute('aria-disabled'), 'true', 'the box is busy');
  assert.notEqual(upload.disabled, true, 'not disabled: a disabled control drops focus to the page');
  assert.equal(page.activeElement === upload, true, `focus stays on the box while the upload waits (it is on ${page.activeElement.tagName})`);
  R.uploads[0].resolve({});
  await pick;
  assert.equal(R.rerenders, 1, 'the page redraws once the upload is saved');
  assert.deepEqual(R.toasts.map((t) => t.msg), ['Uploaded.']);
  assert.equal(upload.value, '');
});

test('while the upload waits, a click does not open the picker and a second pick sends nothing', async () => {
  const { upload } = await mount();
  let prevented = false;
  const click = () => upload.onclick({ preventDefault: () => { prevented = true; } });
  click();
  assert.equal(prevented, false, 'a free box opens the picker');
  upload.files = [PDF];
  const pick = upload.onchange();
  click();
  assert.equal(prevented, true, 'a click on the busy box is stopped');
  await upload.onchange();
  assert.equal(R.uploads.length, 1, 'a second pick sends no second upload');
  R.uploads[0].resolve({});
  await pick;
});

test('a refused file frees the box at once, keeps focus on it, shows the line on the box and takes a new pick', async () => {
  const { page, upload } = await mount();
  upload.files = [PDF];
  const pick = upload.onchange();
  R.uploads[0].reject(Object.assign(new Error(REFUSAL), { code: 'BAD_FILE_CONTENT', status: 415 }));
  await pick;
  assert.equal(upload.getAttribute('aria-disabled'), null, 'the busy mark is gone');
  assert.notEqual(upload.disabled, true);
  assert.equal(page.activeElement === upload, true, `focus is still on the box (it is on ${page.activeElement.tagName})`);
  assert.deepEqual(R.shown, [REFUSAL], 'the refusal shows on the box');
  assert.deepEqual(R.toasts, [], 'no toast for a refused file');
  upload.files = [PDF];
  const again = upload.onchange();
  assert.equal(R.uploads.length, 2, 'the box takes a new pick after a refusal');
  R.uploads[1].resolve({});
  await again;
});
