'use strict';

// QA round 8, lane C27 (money views: rent.js, refunds.js). Frontend-only: no database.
// #22 a rent row's Record starts the payment at that row's own remaining amount; the balance line still shows the whole balance.
// N1 the rent row's Record and the refund row's Void name their row (D-81).
// node --test --test-concurrency=1 test/qa-r8-c27.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const RENT_SRC = read('public/js/views/rent.js');
const REFUNDS_SRC = read('public/js/views/refunds.js');

// The views load from a temp copy with stub api, ui, app and filters modules (the same approach as qa-r5-c15).
// Stubs use String.raw, so they must not contain a template placeholder or a backtick.
const API_STUB = String.raw`
export class ApiError extends Error {
  constructor(message, { status = 0, code, data } = {}) { super(message); this.status = status; this.code = code; this.data = data; }
}
export const calls = [];
export const replies = [];
export const gets = {};
export async function get(url) {
  if (url in gets) return gets[url];
  throw new Error('unexpected GET ' + url);
}
export async function post(url, body) {
  calls.push(['POST', url, body]);
  const next = replies.shift();
  if (next instanceof Error) throw next;
  return next;
}
export const patch = async () => ({});
export const qs = () => '';
export async function uploadFile() {}
`;

// Every element is a small tree: tag, props, kids, and text (the strings inside it, in order).
const UI_STUB = String.raw`
export const calls = { formModal: [], confirm: [] };
export const fields = {};
const flat = (kids) => kids.map((k) => (k && typeof k === 'object' ? k.text : (k === false || k == null ? '' : String(k)))).join('');
function make(tag, props, kids) {
  const input = { value: '', addEventListener() {} };
  return {
    tag, props: props || {}, kids: kids || [],
    get text() { return flat(this.kids); },
    replaceChildren(...xs) { this.kids = xs; },
    querySelector() { return input; },
    addEventListener() {},
    append() {},
  };
}
export const h = (tag, props, ...kids) => make(tag, props, kids.flat(Infinity));
export const field = (f) => { const el = make('field', f, []); fields[f.name] = el; return el; };
export const formModal = (opts) => { calls.formModal.push(opts); };
export const confirmDialog = async (opts) => { calls.confirm.push(opts); return true; };
export const icon = () => null;
export const badge = () => null;
export const emptyState = () => null;
export const pageHead = () => null;
export const filesList = () => null;
export const openModal = () => {};
export const toast = () => {};
export const todayManila = () => '2026-10-14';
export const unitLabel = (x) => 'Unit ' + String(x);
export const options = (xs) => xs.map((x) => [x, x]);
export const label = (x) => String(x);
export const fmtDate = (x) => String(x);
export const fmtDateTime = (x) => String(x);
export const fmtMonth = (x) => String(x);
const pesoFmt = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });
export const peso = (v) => pesoFmt.format(Number(v || 0));
export function parseAmount(text) {
  const s = String(text ?? '').replace(/₱/g, '').replace(/\s/g, '').replace(/^PHP/i, '');
  const ok = s.includes(',') ? /^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s) : /^-?\d+(\.\d{1,2})?$/.test(s);
  return ok ? Number(s.replace(/,/g, '')) : NaN;
}
`;

const APP_STUB = 'export const state = { user: { role: \'owner\', business_type: \'both\', full_name: \'Ana Reyes\' } };\nexport const navigate = () => {};\n';
const FILTERS_STUB = `export const initFilters = (key, query, defaults) => ({ ...defaults });
export const filterBar = () => null;
export const rememberFilters = () => {};
export const changed = (values, defaults) => Object.fromEntries(Object.entries(values).filter(([k, v]) => String(v ?? '') !== String(defaults[k] ?? '')));
export const apiFilters = (values) => Object.fromEntries(Object.entries(values).filter(([, v]) => String(v ?? '') !== ''));
`;

let dir; let api; let ui; let rent; let refunds;

function* walk(node) {
  if (!node || typeof node !== 'object') return;
  yield node;
  for (const k of node.kids || []) yield* walk(k);
}
const buttonWith = (root, text) => [...walk(root)].find((n) => n.tag === 'button' && n.kids.includes(text));

test.before(async () => {
  if (!globalThis.history) globalThis.history = { replaceState() {} };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c27-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'api.js'), API_STUB);
  fs.writeFileSync(path.join(dir, 'ui.js'), UI_STUB);
  fs.writeFileSync(path.join(dir, 'app.js'), APP_STUB);
  fs.writeFileSync(path.join(dir, 'filters.js'), FILTERS_STUB);
  fs.writeFileSync(path.join(dir, 'views', 'rent.js'), RENT_SRC);
  fs.writeFileSync(path.join(dir, 'views', 'refunds.js'), REFUNDS_SRC);
  api = await import(pathToFileURL(path.join(dir, 'api.js')).href);
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')).href);
  rent = await import(pathToFileURL(path.join(dir, 'views', 'rent.js')).href);
  refunds = await import(pathToFileURL(path.join(dir, 'views', 'refunds.js')).href);

  api.gets['/properties'] = { properties: [{ property_id: 'P1', property_name: 'Azure' }] };
  api.gets['/units'] = { units: [{ unit_id: 'U1', unit_name: '1A', property_id: 'P1', property_name: 'Azure' }] };
  // One charge, half paid: 3500 still to collect, out of a 7000 lease balance.
  api.gets['/rent'] = {
    charges: [{ lease_id: 'L1', tenant_id: 'T1', tenant_name: 'Ana Reyes', tenant_status: 'active', lease_status: 'active',
      property_name: 'Azure', unit_name: '1A', period: '2026-09-01', due_date: '2026-09-05', amount_due: '7000.00', amount_applied: '3500.00', balance: '3500.00', status: 'partial' }],
    totals: { outstanding: '3500.00', overdue: '0', overdue_count: 0, partial_count: 1, unpaid_count: 0 },
  };
  api.gets['/rent/leases'] = {
    leases: [{ lease_id: 'L1', tenant_name: 'Ana Reyes', property_name: 'Azure', unit_name: '1A', outstanding: '7000.00', overdue: '0', credit: '0', monthly_rent: '7000.00', tenant_status: 'active', lease_status: 'active' }],
  };
});
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

// Opens the rent roll and returns its row Record button.
async function rentRecordButton() {
  const el = ui.h('div', {});
  await rent.rentView(el, { query: {} });
  return buttonWith(el, 'Record');
}

test('a rent row Record names its row (N1, D-81)', async () => {
  const record = await rentRecordButton();
  assert.ok(record, 'the rent row has a Record button');
  assert.equal(record.props['aria-label'], 'Record payment for Ana Reyes, Unit 1A, 2026-09-01');
});

test('a rent row Record starts the payment at that row remaining amount, and the balance line keeps the whole balance (#22)', async () => {
  ui.calls.formModal.length = 0;
  const record = await rentRecordButton();
  await record.props.onclick();
  const modal = ui.calls.formModal.at(-1);
  assert.equal(modal.title, 'Record payment');
  assert.equal(ui.fields.amount_paid.querySelector('input').value, '3500.00', 'the row remaining amount, not the 7000.00 lease balance');
  assert.match(modal.fields[1].text, /Current balance: ₱7,000\.00/, 'the balance line still shows the whole balance');
});

test('the tenant-level Record still starts at the whole lease balance (#22 scope)', async () => {
  ui.calls.formModal.length = 0;
  await rent.recordPaymentModal({ leaseId: 'L1' });
  assert.equal(ui.fields.amount_paid.querySelector('input').value, '7000.00');
});

test('a refund row Void button names its refund (N1, D-81)', async () => {
  api.gets['/reservations/B1/refunds'] = {
    policy: null, suggestion: null, paid: '5000.00', refunded: '1000.00', refundable: '4000.00',
    refunds: [{ refund_id: 'R1', amount: '1000.00', method: 'gcash', refund_date: '2026-10-01', reason: 'Cancelled by guest', reference_number: null, recorded_by_name: 'Ana Reyes', voided_at: null, void_reason: null }],
  };
  const card = await refunds.refundsCard({ booking_id: 'B1', status: 'confirmed' }, () => {});
  const voidBtn = buttonWith(card, 'Void');
  assert.ok(voidBtn, 'the refund row has a Void button');
  assert.equal(voidBtn.props['aria-label'], 'Void refund of ₱1,000.00 on 2026-10-01');
});
