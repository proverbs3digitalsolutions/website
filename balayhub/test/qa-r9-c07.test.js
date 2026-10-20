'use strict';

// QA round 9, lane C07 (rent and tenants).
// #15 the Record form says which month a payment goes to first (the oldest unpaid month); GET /rent/leases sends oldest_unpaid_period.
// #17 "Partly paid" counts every charge with some money on it and a balance left, overdue or not (partial_count and status=partial).
// #19 after Add tenant saves, the Assign unit form opens with that tenant chosen.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_05 node --test --test-concurrency=1 test/qa-r9-c07.test.js

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, ownerAccount, manilaToday, addMonths } = require('./helpers');

describe('rent server (balayhub_test_r2_05)', () => {
  let srv; let owner; let lease;
  const today = manilaToday();
  const lastMonth = addMonths(today, -1); // first day of last month, YYYY-MM-DD
  const pay = (amount) => owner.post('/api/payments', { lease_id: lease.lease_id, amount_paid: String(amount), payment_date: today, payment_method: 'cash' });
  const leaseRow = async () => (await owner.get('/api/rent/leases')).data.leases.find((x) => x.lease_id === lease.lease_id);

  before(async () => {
    srv = await startServer();
    owner = await ownerAccount(srv.base, 'owner-r9-c07@example.com', 'QA R9 C07 Rent');
    const property = (await owner.post('/api/properties', { property_name: 'Partly Flats', property_type: 'apartment', address: '3 Luna St', city: 'Bacoor', province: 'Cavite' })).data.property;
    const unit = (await owner.post(`/api/properties/${property.property_id}/units`, { unit_name: '3B', unit_type: 'studio', monthly_rent: '5000' })).data.unit;
    const tenant = (await owner.post('/api/tenants', { full_name: 'Ben Partial', phone: '0917 555 0107' })).data.tenant;
    const r = await owner.post('/api/leases', { tenant_id: tenant.tenant_id, unit_id: unit.unit_id, start_date: addMonths(today, -2), monthly_rent: '5000', due_day: 5 });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    lease = r.data.lease;
    // Three months are billed: two months back, last month and this month (5000 each).
    // The 7000 pays two months back in full and 2000 of last month, so last month is partly paid and overdue.
    const paid = await pay(7000);
    assert.equal(paid.status, 201, JSON.stringify(paid.data));
  });
  after(async () => { await srv.close(); });

  test('GET /rent/leases names the oldest unpaid month, which a payment goes to first (#15)', async () => {
    const l = await leaseRow();
    assert.equal(l.oldest_unpaid_period, lastMonth, JSON.stringify(l));
  });

  test('Partly paid counts an overdue charge with money on it (#17)', async () => {
    const { totals } = (await owner.get('/api/rent')).data;
    assert.equal(totals.partial_count, 1, JSON.stringify(totals));
    const { charges: partial } = (await owner.get('/api/rent?status=partial')).data;
    assert.equal(partial.length, 1, JSON.stringify(partial));
    assert.equal(partial[0].period, lastMonth);
    assert.equal(partial[0].status, 'overdue');
    assert.equal(Number(partial[0].amount_applied), 2000);
  });

  test('nothing is named once every charge is paid (#15)', async () => {
    const rest = await pay(8000); // exactly what is still owed
    assert.equal(rest.status, 201, JSON.stringify(rest.data));
    assert.equal((await leaseRow()).oldest_unpaid_period, null);
    assert.equal((await owner.get('/api/rent?status=partial')).data.charges.length, 0);
  });
});

// ---- screens: rent.js and tenants.js load from a temp copy with stub api, ui, app and filters modules (the same approach as qa-r8-c27).
// Stubs use String.raw, so they must not contain a template placeholder or a backtick.
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const RENT_SRC = read('public/js/views/rent.js');
const TENANTS_SRC = read('public/js/views/tenants.js');

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
  return replies.shift();
}
export const patch = async () => ({});
export const qs = () => '';
export async function uploadFile() {}
export async function fileContentError() { return null; }
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
const form = { addEventListener() {}, elements: { start_date: { value: '2026-10-14' }, due_day: { value: '14' } } };
export const formModal = (opts) => { calls.formModal.push(opts); return { el: { querySelector: () => form }, close() {} }; };
export const confirmDialog = async (opts) => { calls.confirm.push(opts); return true; };
export const icon = () => null;
export const badge = () => null;
export const emptyState = () => null;
export const pageHead = () => null;
export const filesList = () => null;
export const openModal = () => {};
export const toast = () => {};
export const todayManila = () => '2026-10-14';
export const uploadField = (i) => ({ wrap: i, show() {}, clear() {} });
export const fileRefused = () => false;
// Same as the real ui.js: the Manila calendar day of a timestamp, plain dates unchanged.
export function manilaDay(ts) {
  if (!ts) return '';
  const s = String(ts);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? s.slice(0, 10) : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(d);
}
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

const APP_STUB = `export const state = { user: { role: 'owner', business_type: 'both', full_name: 'Ana Reyes' } };
export const navCalls = [];
export const navigate = (hash) => { navCalls.push(hash); };
`;

const FILTERS_STUB = `export const initFilters = (key, query, defaults) => ({ ...defaults });
export const filterBar = () => null;
export const rememberFilters = () => {};
export const changed = (values, defaults) => Object.fromEntries(Object.entries(values).filter(([k, v]) => String(v ?? '') !== String(defaults[k] ?? '')));
export const apiFilters = (values) => Object.fromEntries(Object.entries(values).filter(([, v]) => String(v ?? '') !== ''));
`;

function* walk(node) {
  if (!node || typeof node !== 'object') return;
  yield node;
  for (const k of node.kids || []) yield* walk(k);
}
// Every row's Record button, in the order the rent roll lists them.
const recordButtons = (root) => [...walk(root)].filter((n) => n.tag === 'button' && n.kids.includes('Record'));

// Lets the screen's async work (a view that opens a dialog after its data loads) finish.
async function settle(done) {
  for (let i = 0; i < 50 && !done(); i += 1) await new Promise((r) => setImmediate(r));
}

describe('rent and tenants screens (no database)', () => {
  let dir; let api; let ui; let app; let rent; let tenants;

  before(async () => {
    if (!globalThis.history) globalThis.history = { replaceState() {} };
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c07-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    fs.mkdirSync(path.join(dir, 'views'));
    fs.writeFileSync(path.join(dir, 'api.js'), API_STUB);
    fs.writeFileSync(path.join(dir, 'ui.js'), UI_STUB);
    fs.writeFileSync(path.join(dir, 'app.js'), APP_STUB);
    fs.writeFileSync(path.join(dir, 'filters.js'), FILTERS_STUB);
    fs.writeFileSync(path.join(dir, 'views', 'rent.js'), RENT_SRC);
    fs.writeFileSync(path.join(dir, 'views', 'tenants.js'), TENANTS_SRC);
    api = await import(pathToFileURL(path.join(dir, 'api.js')).href);
    ui = await import(pathToFileURL(path.join(dir, 'ui.js')).href);
    app = await import(pathToFileURL(path.join(dir, 'app.js')).href);
    rent = await import(pathToFileURL(path.join(dir, 'views', 'rent.js')).href);
    tenants = await import(pathToFileURL(path.join(dir, 'views', 'tenants.js')).href);

    api.gets['/properties'] = { properties: [{ property_id: 'P1', property_name: 'Azure' }] };
    api.gets['/units'] = { units: [{ unit_id: 'U1', unit_name: '1A', property_id: 'P1', property_name: 'Azure', monthly_rent: '5000.00', security_deposit_amount: '5000.00' }] };
    // Ana owes two months: September (partly paid, overdue) and October (nothing paid, overdue).
    const row = (period, applied, balance) => ({ lease_id: 'L1', tenant_id: 'T1', tenant_name: 'Ana Reyes', tenant_status: 'active', lease_status: 'active',
      property_name: 'Azure', unit_name: '1A', period, due_date: `${period.slice(0, 8)}10`, amount_due: '5000.00', amount_applied: applied, balance, status: 'overdue' });
    api.gets['/rent'] = {
      charges: [row('2026-09-01', '4000.00', '1000.00'), row('2026-10-01', '0.00', '5000.00')],
      totals: { outstanding: '6000.00', overdue: '6000.00', overdue_count: 2, partial_count: 1, unpaid_count: 0 },
    };
    api.gets['/rent/leases'] = {
      leases: [{ lease_id: 'L1', tenant_name: 'Ana Reyes', property_name: 'Azure', unit_name: '1A', outstanding: '6000.00', overdue: '6000.00', credit: '0', monthly_rent: '5000.00', tenant_status: 'active', lease_status: 'active', oldest_unpaid_period: '2026-09-01' }],
    };
  });
  after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  test('a row Record on a later month says which month the payment goes to first (#15)', async () => {
    ui.calls.formModal.length = 0;
    const el = ui.h('div', {});
    await rent.rentView(el, { query: {} });
    const [september, october] = recordButtons(el);
    await october.props.onclick();
    const modal = ui.calls.formModal.at(-1);
    assert.equal(modal.title, 'Record payment');
    assert.match(modal.fields[1].text, /This payment goes to 2026-09-01 first \(the oldest unpaid month\), then to 2026-10-01\./);

    ui.calls.formModal.length = 0;
    await september.props.onclick();
    assert.doesNotMatch(ui.calls.formModal.at(-1).fields[1].text, /goes to/, 'the oldest unpaid month needs no note');
  });

  test("the tenant's own Record names the oldest unpaid month too (#15)", async () => {
    ui.calls.formModal.length = 0;
    await rent.recordPaymentModal({ leaseId: 'L1' });
    assert.match(ui.calls.formModal.at(-1).fields[1].text, /This payment goes to 2026-09-01 first \(the oldest unpaid month\)\./);
  });

  test('the rent screen says Partly paid, and the overdue card counts charges (#17)', async () => {
    const el = ui.h('div', {});
    await rent.rentView(el, { query: {} });
    assert.match(el.text, /Partly paid/);
    assert.doesNotMatch(el.text, /Partially paid/);
    assert.match(el.text, /2 overdue charges/);
    assert.doesNotMatch(el.text, /2 months/);
  });

  test('after Add tenant saves, the Assign unit form opens with that tenant chosen; Cancel leaves No lease yet (#19)', async () => {
    // Add tenant on the Tenants screen: the save goes to the new tenant's page with ?assign=1.
    api.replies.push({ tenant: { tenant_id: 'T9', full_name: 'Carla Cruz' } });
    tenants.newTenantModal();
    await ui.calls.formModal.at(-1).onSubmit({ full_name: 'Carla Cruz' });
    assert.equal(app.navCalls.at(-1), '#/tenants/T9?assign=1');

    // The tenant has no lease yet, so the page opens the Assign unit form itself, with the tenant already chosen.
    api.gets['/tenants/T9'] = { tenant: { tenant_id: 'T9', full_name: 'Carla Cruz' }, leases: [], payments: [], charges: [] };
    api.gets['/units?vacant=1'] = { units: api.gets['/units'].units };
    ui.calls.formModal.length = 0;
    await tenants.tenantDetailView(ui.h('div', {}), { params: { id: 'T9' }, query: { assign: '1' }, rerender() {} });
    await settle(() => ui.calls.formModal.length > 0);
    const assign = ui.calls.formModal.at(-1);
    assert.equal(assign.title, 'Assign Carla Cruz to a unit');
    assert.equal(assign.fields.find((f) => f.props.name === 'tenant_id').props.value, 'T9');
  });
});
