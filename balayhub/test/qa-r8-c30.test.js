'use strict';
// QA round 8, lane C30 (housekeeping view): #30 owners and managers are stopped before Supplies used
// records stock that is not there (a use with nothing on hand is refused on its row; more than on hand
// asks first, and Cancel posts nothing); #31 "Tell your manager." is said to cleaners only; #34 the
// cleaner calendar's Today and weekday follow the workspace language; K7 owners and managers can edit a
// job's notes; D-81 the board's Open task links name their unit. The view imports browser modules, so the
// Supplies used Save handler is run from its own source, with stubs for the dialog, the request, the toast
// and the role check.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/housekeeping.js'), 'utf8');

// Stands in for api.js's ApiError: the view only reads message, status and fields from it.
class FakeApiError extends Error {
  constructor(message, { status, fields } = {}) { super(message); this.status = status; this.fields = fields; }
}

// The Supplies used Save handler is the onSubmit of suppliesModal's formModal call (the one with no arguments).
const suppliesSrc = (src.match(/ {4}onSubmit: async \(\) => \{[\s\S]*?\n {4}\},/) || [''])[0].replace(/^\s*onSubmit: /, '').replace(/,\s*$/, '');

// One Supplies used row, as suppliesModal builds it. askFirst is true for owners and managers.
const row = (id, qty, { kind = 'used', onHand = 5, askFirst = true, unit = 'pcs' } = {}) => ({
  sp: { supply_id: id, name: `Supply ${id}`, on_hand: onHand, unit_label: unit },
  key: `qty-${id}`, askFirst, qty: { value: qty }, kind: { value: kind },
});

// Runs the handler with stubs. confirm() answers the "Not enough on hand" question; post() answers the request.
function runSupplies({ rows, post = async () => ({ skipped: [] }), confirm = async () => true, cleaner = false }) {
  const sent = [];
  const asked = [];
  const toasts = [];
  let saved = 0;
  const submit = new Function('rows', 'task', 'ApiError', 'T', 'post', 'toast', 'onSaved', 'confirmDialog', 'qtyLabel', 'isCleaner',
    `return (${suppliesSrc});`)(
    rows, { task_id: 'task-1' }, FakeApiError,
    (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => v[k]) : s),
    async (url, body) => { sent.push(body); return post(url, body); },
    (msg, kind) => toasts.push({ msg, kind }),
    () => { saved += 1; },
    async (o) => { asked.push(o); return confirm(o); },
    (n, unit) => `${n} ${unit}`,
    () => cleaner);
  return { submit, sent, asked, toasts, saved: () => saved };
}

// #30: owners and managers are refused a use with nothing on hand on its own row, and nothing is sent.
test('a use with nothing on hand is refused on its row for an owner or manager, and nothing is sent', async () => {
  const r = runSupplies({ rows: [row('sup-1', '2', { onHand: 0 }), row('sup-2', '1')] });
  await assert.rejects(r.submit(), (err) => {
    assert.equal(err.message, 'Nothing on hand. Restock it first.');
    assert.deepEqual(Object.keys(err.fields), ['qty-sup-1'], 'only the item with nothing on hand is named');
    assert.equal(typeof err.onRender, 'function', 'the message is not repeated in the form box');
    return true;
  });
  assert.deepEqual(r.sent, [], 'nothing is recorded, not even the item that has stock');
});

test('restocking an item with nothing on hand is still allowed', async () => {
  const r = runSupplies({ rows: [row('sup-1', '4', { kind: 'restocked', onHand: 0 })] });
  await r.submit();
  assert.deepEqual(r.sent, [{ items: [{ supply_id: 'sup-1', kind: 'restocked', quantity: 4 }] }]);
});

// #30: more than is on hand asks first, with the Supplies page's wording; Cancel leaves the form open and posts nothing.
test('more than is on hand asks first with the Supplies page wording; Cancel posts nothing and keeps the form open', async () => {
  const r = runSupplies({ rows: [row('sup-1', '7', { onHand: 3, unit: 'towels' })], confirm: async () => false });
  assert.equal(await r.submit(), false, 'returning false keeps the dialog open');
  assert.equal(r.asked.length, 1);
  assert.equal(r.asked[0].title, 'Not enough on hand');
  assert.equal(r.asked[0].text, 'You asked to record 7 towels used. On hand is 3 towels, so only that much is logged as used, and on hand goes to 0.');
  assert.equal(r.asked[0].confirmText, 'Record what is on hand');
  assert.deepEqual(r.sent, []);
  assert.equal(r.saved(), 0);
});

test('confirming "Record what is on hand" sends the quantity asked for with record_on_hand, so the server logs only what is there', async () => {
  const r = runSupplies({ rows: [row('sup-1', '7', { onHand: 3 })] });
  await r.submit();
  assert.deepEqual(r.sent, [{ items: [{ supply_id: 'sup-1', kind: 'used', quantity: 7, record_on_hand: true }] }]);
  assert.equal(r.saved(), 1);
});

// The server refuses a use above what is on hand unless the item says record_on_hand; only the confirmed rows say so.
test('record_on_hand is sent only on the confirmed short rows; in-stock rows get no key at all', async () => {
  const r = runSupplies({ rows: [row('sup-1', '7', { onHand: 3 }), row('sup-2', '2', { onHand: 5 }), row('sup-3', '4', { kind: 'restocked', onHand: 0 })] });
  await r.submit();
  assert.deepEqual(r.sent, [{ items: [
    { supply_id: 'sup-1', kind: 'used', quantity: 7, record_on_hand: true },
    { supply_id: 'sup-2', kind: 'used', quantity: 2 },
    { supply_id: 'sup-3', kind: 'restocked', quantity: 4 },
  ] }]);
  assert.equal(Object.prototype.hasOwnProperty.call(r.sent[0].items[1], 'record_on_hand'), false);
});

// Cancelling one question sends nothing, so no row can go out with the flag.
test('a second short row cancelled after the first is confirmed posts nothing', async () => {
  let n = 0;
  const r = runSupplies({ rows: [row('sup-1', '7', { onHand: 3 }), row('sup-2', '9', { onHand: 4 })], confirm: async () => { n += 1; return n === 1; } });
  assert.equal(await r.submit(), false);
  assert.equal(r.asked.length, 2);
  assert.deepEqual(r.sent, []);
});

test('staff and cleaners are neither asked nor refused here; the server still skips an empty item and names it', async () => {
  const r = runSupplies({
    rows: [row('sup-1', '7', { onHand: 3, askFirst: false }), row('sup-2', '1', { onHand: 0, askFirst: false })],
    post: async () => ({ skipped: ['Supply sup-2'] }),
    cleaner: true,
  });
  await r.submit();
  assert.equal(r.asked.length, 0);
  assert.deepEqual(r.sent, [{ items: [{ supply_id: 'sup-1', kind: 'used', quantity: 7 }, { supply_id: 'sup-2', kind: 'used', quantity: 1 }] }]);
});

// #31: the Tell your manager sentence is for cleaners only.
test('"Tell your manager." is said to cleaners only', async () => {
  const skipped = async () => ({ skipped: ['Shampoo bar'] });
  const cleaner = runSupplies({ rows: [row('sup-1', '1', { onHand: 0, askFirst: false })], cleaner: true, post: skipped });
  await cleaner.submit();
  assert.equal(cleaner.toasts[0].msg, 'Shampoo bar was out of stock, so it wasn\'t recorded. Tell your manager.');
  assert.equal(cleaner.toasts[0].kind, 'error');
  const owner = runSupplies({ rows: [row('sup-1', '1', { onHand: 0, askFirst: false })], cleaner: false, post: skipped });
  await owner.submit();
  assert.equal(owner.toasts[0].msg, 'Shampoo bar was out of stock, so it wasn\'t recorded.');
});

// Source-level rules the handler test cannot reach.
test('the rows carry the owner-and-manager flag from the role check, and the save still posts the same request', () => {
  assert.match(src, /askFirst: canManage\(\)/);
  assert.match(src, /const \{ skipped, short: shortfall = \[\] \} = await post\(`\/cleaning-tasks\/\$\{task\.task_id\}\/supplies`, \{ items \}\);/);
  assert.match(src, /\.\.\.\(isCleaner\(\) \? \[T\('Tell your manager\.'\)\] : \[\]\)/);
  assert.ok(src.includes("T('{name} was out of stock, so it wasn\\'t recorded.', { name })"), 'the skipped-item line keeps its wording');
});

// #34: the cleaner calendar's Today and weekday follow the workspace language.
test('the calendar day label says Today through T() and dates the weekday in the cleaner locale', () => {
  assert.match(src, /import \{[^}]*\blocale\b[^}]*\} from '\.\.\/i18n\.js';/);
  assert.match(src, /toLocaleDateString\(isCleaner\(\) \? locale\(\) : 'en-PH', \{ weekday: 'short'/);
  assert.match(src, /h\('span', \{ class: 'hk-day__today' \}, T\('Today'\)\)/);
  assert.doesNotMatch(src, /'hk-day__today' \}, 'Today'\)/);
  assert.match(src, /'Today': 'Ngayon'/);
});

// D-81: each board Open task link names its unit, so the repeated links tell apart.
test('the board Open task link is named with its unit, not only its status', () => {
  assert.match(src, /const openTaskText = \(o\) => `\$\{T\(STATUS\[o\.status\]\?\.\[1\] \|\| 'To do'\)\}/);
  assert.match(src, /'aria-label': `\$\{openTaskText\(u\.open_task\)\}, \$\{u\.unit_name\}`/);
});

// K7: owners and managers can edit a job's notes from the job page; the save PATCHes notes.
test('owners and managers can edit a job\'s notes from the job page, and the save PATCHes notes', () => {
  assert.match(src, /\(t\.notes \|\| isManager\) && \[h\('dt', null, T\('Notes'\)\)/);
  assert.match(src, /isManager && h\('div', null, h\('button', \{ class: 'linkbtn', onclick: \(\) => notesModal\(t, rerender\) \}, 'Edit notes'\)\)/);
  assert.match(src, /function notesModal\(task, onSaved\) \{[\s\S]*?field\(\{ name: 'notes', label: 'Notes', type: 'textarea', maxlength: 1000, value: task\.notes \?\? '' \}\)[\s\S]*?await patch\(`\/cleaning-tasks\/\$\{task\.task_id\}`, \{ notes: d\.notes \}\)/);
});
