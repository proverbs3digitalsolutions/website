'use strict';

// QA round 5, lane C15 (long-term pages and help). Frontend-only: no database.
// #16 the over-balance confirm reads the typed amount ("1,000.50" is not NaN), #19 an empty status chip says "No results
// found", #21 My pay is for cleaners only, #20 long-term workspaces get rent examples, #53 help stars start unchecked,
// N6 Ask with a blank box says what to do. rent.js is loaded from a temp copy with stub api, ui, app and filters modules.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const RENT_SRC = read('public/js/views/rent.js');
const HELP_SRC = read('public/js/views/help.js');
const ASSIST_SRC = read('public/js/assistant.js');
const ROUTE_SRC = read('public/js/routeaccess.js');

// String.raw keeps the regular expressions in the stubs intact.
const API_STUB = String.raw`
export class ApiError extends Error {
  constructor(message, { status = 0, code, data } = {}) { super(message); this.status = status; this.code = code; this.data = data; }
}
export const calls = [];
export const replies = [];
export async function get(url) {
  if (url === '/rent/leases') return { leases: [{ lease_id: 'L1', tenant_name: 'Ana Reyes', property_name: 'Azure', unit_name: '1A', outstanding: '0', overdue: '0', credit: '0', monthly_rent: '5000', tenant_status: 'active', lease_status: 'active' }] };
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

const UI_STUB = String.raw`
export const calls = { formModal: [], confirm: [], toast: [] };
const node = () => ({ replaceChildren() {}, addEventListener() {}, append() {}, querySelector: () => ({ addEventListener() {}, value: '' }) });
export const h = () => node();
export const icon = () => null;
export const field = () => node();
export const badge = () => null;
export const emptyState = () => null;
export const pageHead = () => null;
export const filesList = () => null;
export const openModal = () => {};
export const formModal = (opts) => { calls.formModal.push(opts); };
export const confirmDialog = async (opts) => { calls.confirm.push(opts); return true; };
export const toast = (...args) => { calls.toast.push(args); };
export const todayManila = () => '2026-10-14';
export const unitLabel = (x) => String(x);
export const options = (xs) => xs.map((x) => [x, x]);
export const label = (x) => String(x);
export const fmtDate = (x) => String(x);
export const fmtDateTime = (x) => String(x);
export const fmtMonth = (x) => String(x);
const pesoFmt = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });
export const peso = (v) => pesoFmt.format(Number(v || 0));
// Same rule as ui.js parseAmount (commas only between thousands, PHP and the peso sign removed).
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
`;

let dir; let rent; let ui; let api;
let routeAllowed;
test.before(async () => {
  // routeaccess.js has no imports, so it loads from a data: URL (as the round-1 route test does).
  ({ routeAllowed } = await import(`data:text/javascript;base64,${Buffer.from(ROUTE_SRC).toString('base64')}`));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c15-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'api.js'), API_STUB);
  fs.writeFileSync(path.join(dir, 'ui.js'), UI_STUB);
  fs.writeFileSync(path.join(dir, 'app.js'), APP_STUB);
  fs.writeFileSync(path.join(dir, 'filters.js'), FILTERS_STUB);
  fs.writeFileSync(path.join(dir, 'views', 'rent.js'), RENT_SRC);
  api = await import(pathToFileURL(path.join(dir, 'api.js')).href);
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')).href);
  rent = await import(pathToFileURL(path.join(dir, 'views', 'rent.js')).href);
});
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

// ---------------------------------------------------------------- #21 My pay
test('My pay is a cleaner page; every other role is sent home (#21, D-76)', () => {
  for (const user of [
    { role: 'owner', business_type: 'long_term' },
    { role: 'owner', business_type: 'both' },
    { role: 'manager', business_type: 'short_term' },
    { role: 'staff', business_type: 'both' },
  ]) assert.equal(routeAllowed('/my-pay', user), false, JSON.stringify(user));
  assert.equal(routeAllowed('/my-pay', { role: 'cleaner', business_type: 'long_term' }), true);
  assert.equal(routeAllowed('/my-pay', { role: 'cleaner', business_type: 'short_term' }), true);
});

// ---------------------------------------------------------------- #16 over-balance confirm
test('the over-balance confirm reads "1,000.50" as ₱1,000.50, never NaN (#16)', async () => {
  api.replies.length = 0; api.calls.length = 0; ui.calls.confirm.length = 0;
  api.replies.push(new api.ApiError('Over balance', { status: 409, code: 'PAYMENT_OVER_BALANCE', data: { credit_after: '500.50' } }));
  api.replies.push({ payment: { payment_id: 7 }, balance: { outstanding: '0' } });
  await rent.recordPaymentModal({ onSaved: () => {} });
  const modal = ui.calls.formModal.at(-1);
  await modal.onSubmit({ lease_id: 'L1', amount_paid: '1,000.50', payment_date: '2026-10-14', payment_method: 'cash' }, { idempotencyKey: 'k1', form: { querySelector: () => null } });
  const confirm = ui.calls.confirm.at(-1);
  assert.equal(confirm.text, 'Record ₱1,000.50? ₱500.50 becomes advance credit.');
  assert.doesNotMatch(confirm.text, /NaN/);
  // The confirmed retry still sends the amount as typed.
  assert.equal(api.calls.at(-1)[2].confirm_over, true);
  assert.equal(api.calls.at(-1)[2].amount_paid, '1,000.50');
});

test('rent.js reads the typed amount through parseAmount from ui.js (#16)', () => {
  assert.match(RENT_SRC, /import \{[^}]*\bparseAmount\b[^}]*\} from '\.\.\/ui\.js'/);
  assert.match(RENT_SRC, /peso\(parseAmount\(data\.amount_paid\)\)/);
  assert.doesNotMatch(RENT_SRC, /peso\(data\.amount_paid\)/);
});

// ---------------------------------------------------------------- #19 status chip empty state
test('a status chip counts as a filter for the empty list, except the chips whose own message fits (#19)', () => {
  assert.equal(typeof rent.statusCountsAsFilter, 'function');
  for (const s of ['partial', 'unpaid', 'paid']) assert.equal(rent.statusCountsAsFilter(s), true, s);
  for (const s of ['outstanding', 'overdue', 'all']) assert.equal(rent.statusCountsAsFilter(s), false, s);
});

test('an empty status chip shows "No results found"; the defaults keep their own text (#19)', () => {
  assert.match(RENT_SRC, /\(filtered \|\| statusCountsAsFilter\(f\.status\)\) \? noResults\(\)/);
  assert.match(RENT_SRC, /title: f\.status === 'outstanding' \|\| f\.status === 'overdue' \? 'No unpaid rent' : 'No rent charges'/);
});

test('Clear filters on the rent tab also resets the status chip, so the button always does something (#19)', () => {
  assert.doesNotMatch(RENT_SRC, /tab === 'rent' \? \{ status: f\.status \}/);
  assert.match(RENT_SRC, /const clearFilters = \(\) => \{[^}]*Object\.assign\(f, TABS\[tab\]\.defaults\);/);
});

// ---------------------------------------------------------------- #20 long-term examples
test('long-term workspaces get rent examples in the help search, the ask box and the subject box (#20)', () => {
  assert.match(HELP_SRC, /placeholder: longTerm \? 'Search help, e\.g\. rent reminders, receipts, maintenance' : 'Search help — e\.g\. connect Airbnb, refund, gate pass'/);
  assert.match(HELP_SRC, /placeholder: longTerm \? 'e\.g\. Paano mag-record ng bayad sa upa\?' : 'e\.g\. Paano i-connect ang Airbnb calendar ko\?'/);
  assert.match(HELP_SRC, /placeholder: longTerm \? 'e\.g\. Rent reminder not sent to my tenant' : 'e\.g\. Airbnb bookings not showing on my calendar'/);
  assert.equal((HELP_SRC.match(/const longTerm = state\.user\.business_type === 'long_term';/g) || []).length, 2);
});

test('the assistant box gives long-term workspaces a rent example and keeps its text for the others (#20)', () => {
  assert.match(ASSIST_SRC, /const longTerm = state\.user\?\.business_type === 'long_term';/);
  assert.match(ASSIST_SRC, /placeholder: longTerm \? 'Ask anything about BalayHub, e\.g\. how do I record a rent payment\? \(English or Tagalog\)' : 'Ask anything about BalayHub… \(English or Tagalog\)'/);
});

// ---------------------------------------------------------------- #53 stars
test('help rating stars start unchecked inside a named radio group (#53)', () => {
  const stars = HELP_SRC.match(/function stars\([\s\S]*?\n\}\n/);
  assert.ok(stars, 'stars() is found');
  assert.match(stars[0], /role: 'radiogroup', 'aria-label': 'Rating'/);
  assert.match(stars[0], /role: 'radio'/);
  assert.match(stars[0], /'aria-checked': 'false'/);
});

// ---------------------------------------------------------------- N6 blank Ask
test('Ask with a blank box says what to do and does not open the assistant (N6)', () => {
  assert.match(HELP_SRC, /if \(!question\) \{[^}]*Type a question first\.[^}]*return; \}/);
  const blank = HELP_SRC.indexOf('Type a question first.');
  const open = HELP_SRC.indexOf('openAssistant(question)');
  assert.ok(blank > 0 && open > blank, 'the blank check comes before the call that opens the assistant');
});
