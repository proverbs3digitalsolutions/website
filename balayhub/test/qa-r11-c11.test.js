'use strict';
// QA round 11, lane C11 (housekeeping and lost-and-found views). #33: the owner's own finished clean
// with no pay reads "Done by you, no pay" on the task page, as Cleaner pay does. #36: an owner or manager logs a repair
// ("Log repair", and the toast says it is on the Maintenance list); cleaners and staff still send it to the
// host. #34: a partial supplies shortfall is named in the toast the way a zero stock is (the server sends
// `short`, C10 owns it). #28: the lost-item name field is labelled "Item". Frontend only, no database.
// The view imports browser modules, so pure helpers are pulled from the source and the Supplies used Save
// handler is run from its own source with stubs, as qa-r8-c30 does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/housekeeping.js'), 'utf8');
const lost = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/lostfound.js'), 'utf8');

// The view imports browser modules, so pull the pure helper out of the source.
const grab = (name) => src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`))[0].replace('export ', '');

test('#33: the owner\'s own finished clean with no pay reads "Done by you, no pay"', () => {
  const { payText } = new Function(`${grab('payText')}\nreturn { payText };`)();
  const owner = { role: 'owner', user_id: 'u-owner' };
  const own = { status: 'done', done_by_viewer: true, pay_amount: null };
  assert.equal(payText(own, owner), 'Done by you, no pay');
  assert.equal(payText({ ...own, done_by_viewer: false }, owner), 'Pay not set. Use Set pay.', 'someone else\'s clean is still unpriced');
  assert.equal(payText({ ...own, status: 'in_progress' }, owner), 'Pay not set. Use Set pay.', 'an unfinished clean is still unpriced');
  assert.equal(payText(own, { role: 'manager', user_id: 'u-owner' }), 'Pay not set. Use Set pay.', 'only the owner gets the self wording');
});

test('#33: the task pay card asks payText for its line and keeps the Set pay button', () => {
  assert.match(src, /h\('span', \{ class: 'muted' \}, payText\(t, state\.user\)\)/);
  assert.match(src, /t\.pay_status !== 'paid' && h\('button', \{ class: 'btn btn--secondary', onclick: \(\) => payModal\(t, rerender\) \}, t\.pay_amount != null \? 'Edit pay' : 'Set pay'\)/);
});

test('#36: an owner or manager logs a repair; cleaners and staff still send it to the host', () => {
  assert.match(src, /submitText: canManage\(\) \? 'Log repair' : T\('Send to host'\)/);
  assert.match(src, /toast\(canManage\(\) \? 'Repair logged\. It\\'s on your Maintenance list\.' : T\('Sent to the host\. Thank you\.'\)\)/);
});

// The Supplies used Save handler is the onSubmit of suppliesModal's formModal call (the one with no arguments).
const suppliesSrc = (src.match(/ {4}onSubmit: async \(\) => \{[\s\S]*?\n {4}\},/) || [''])[0].replace(/^\s*onSubmit: /, '').replace(/,\s*$/, '');

// Stands in for api.js's ApiError: the handler only reads message, status and fields from it.
class FakeApiError extends Error {
  constructor(message, { status, fields } = {}) { super(message); this.status = status; this.fields = fields; }
}

// One Supplies used row for a cleaner or staff member: askFirst is false, so nothing is asked before the save.
const row = (id, qty, { onHand = 5 } = {}) => ({
  sp: { supply_id: id, name: `Supply ${id}`, on_hand: onHand, unit_label: 'roll' },
  key: `qty-${id}`, askFirst: false, qty: { value: qty }, kind: { value: 'used' },
});

// Runs the handler with stubs; post() answers the save with the server's skipped and short lists.
async function saveToast({ rows, post, cleaner }) {
  const toasts = [];
  const submit = new Function('rows', 'task', 'ApiError', 'T', 'post', 'toast', 'onSaved', 'confirmDialog', 'qtyLabel', 'isCleaner',
    `return (${suppliesSrc});`)(
    rows, { task_id: 'task-1' }, FakeApiError,
    (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => v[k]) : s),
    async () => post(),
    (msg, kind) => toasts.push({ msg, kind }),
    () => {},
    async () => true,
    (n, unit) => `${n} ${unit}`,
    () => cleaner);
  await submit();
  return toasts[0];
}

const short = [{ name: 'toilet paper', unit_label: 'rolls', asked: 20, recorded: 7 }];

test('#34: a cleaner who asks for more than is on hand is told what was recorded, then to tell the manager', async () => {
  const toast = await saveToast({ rows: [row('sup-1', '20', { onHand: 7 })], cleaner: true, post: async () => ({ skipped: [], short }) });
  assert.equal(toast.msg, 'Only 7 rolls of toilet paper were on hand, so 7 were recorded. Tell your manager.');
  assert.equal(toast.kind, 'error');
});

test('#34: an owner gets the same sentence without the manager line, and a single item uses "was" and "1 roll"', async () => {
  const one = [{ name: 'toilet paper', unit_label: 'roll', asked: 2, recorded: 1 }];
  const toast = await saveToast({ rows: [row('sup-1', '2', { onHand: 1 })], cleaner: false, post: async () => ({ skipped: [], short: one }) });
  assert.equal(toast.msg, 'Only 1 roll of toilet paper was on hand, so 1 was recorded.');
  assert.equal(toast.kind, 'error');
});

test('#34: a short item and a zero-stock item are both named, then the manager line once for a cleaner', async () => {
  const toast = await saveToast({ rows: [row('sup-1', '20', { onHand: 7 })], cleaner: true, post: async () => ({ skipped: ['Shampoo bar'], short }) });
  assert.equal(toast.msg, 'Only 7 rolls of toilet paper were on hand, so 7 were recorded. Shampoo bar was out of stock, so it wasn\'t recorded. Tell your manager.');
});

test('#34: with nothing short or skipped the toast still says Supplies saved.', async () => {
  const toast = await saveToast({ rows: [row('sup-1', '2', { onHand: 9 })], cleaner: true, post: async () => ({ skipped: [], short: [] }) });
  assert.deepEqual(toast, { msg: 'Supplies saved.', kind: 'info' });
});

test('#34: the handler reads short from the save response, and the Taglish sentence is in the dictionary', () => {
  assert.match(src, /const \{ skipped, short: shortfall = \[\] \} = await post\(`\/cleaning-tasks\/\$\{task\.task_id\}\/supplies`, \{ items \}\);/);
  assert.ok(src.includes("'Only {recorded} of {name} {verb} on hand, so {count} {verb} recorded.': '{recorded} lang ng {name} ang nasa stock, kaya {count} ang na-record.'"), 'Taglish entry for the shortfall sentence');
});

test('#28: the lost-item name field is labelled Item, so the required message reads "Item is required."', () => {
  assert.match(lost, /field\(\{ name: 'description', label: 'Item', required: true, maxlength: 300, placeholder: 'e\.g\. Blue umbrella' \}\)/);
  assert.doesNotMatch(lost, /What is it/);
});
