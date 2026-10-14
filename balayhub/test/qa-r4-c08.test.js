'use strict';
// QA round 4, lane C08 (housekeeping view): #18 Reopen asks before it clears a clean's pay;
// #19 the copy-text fallback box has a name; #20 Supplies used refuses a decimal quantity
// on its row instead of rounding it down. The view imports browser modules, so the two
// handlers are run from their own source with stubs for the dialog, the request and the toast.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/housekeeping.js'), 'utf8');
const peso = (v) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 }).format(Number(v || 0));

// Stands in for api.js's ApiError: the view only reads message, status and fields from it.
class FakeApiError extends Error {
  constructor(message, { status, fields } = {}) { super(message); this.status = status; this.fields = fields; }
}

// The Reopen handler is a named closure over the task inside housekeepingDetailView.
const reopenSrc = (src.match(/ {2}const reopen = async \(\) => \{[\s\S]*?\n {2}\};/) || [''])[0];
function makeReopen({ task, confirmDialog, setStatus }) {
  assert.ok(reopenSrc, 'Reopen is a named handler that asks before it changes the status');
  return new Function('t', 'peso', 'T', 'confirmDialog', 'setStatus', `${reopenSrc}\nreturn reopen;`)(task, peso, (s) => s, confirmDialog, setStatus);
}

// The Supplies used Save handler is the onSubmit of suppliesModal's formModal call.
const suppliesSrc = (src.match(/ {4}onSubmit: async \(\) => \{[\s\S]*?\n {4}\},/) || [''])[0].replace(/^\s*onSubmit: /, '').replace(/,\s*$/, '');
function makeSuppliesSubmit({ rows, task, post }) {
  assert.ok(suppliesSrc, 'suppliesModal has a Save handler');
  return new Function('rows', 'task', 'ApiError', 'T', 'post', 'toast', 'onSaved', `return (${suppliesSrc});`)(
    rows, task, FakeApiError, (s) => s, post, () => {}, () => {});
}
const supplyRow = (id, qty, kind = 'used') => ({ sp: { supply_id: id, name: `Supply ${id}` }, key: `qty-${id}`, qty: { value: qty }, kind: { value: kind } });

// #18: Reopen on a finished clean with a pay asks first; the pay is named in the question.
test('Reopen asks first when the clean has a pay, and names the amount that will be cleared', async () => {
  const asked = [];
  let statusCalls = 0;
  const reopen = makeReopen({
    task: { pay_amount: '600.00' },
    confirmDialog: async (opts) => { asked.push(opts); return null; },
    setStatus: () => { statusCalls += 1; },
  });
  await reopen();
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, 'Reopen this clean?');
  assert.match(asked[0].text, /Its pay of ₱600\.00 is cleared\./);
  assert.match(asked[0].text, /worked out again from the rate when the clean is finished, so check the amount then\./);
  assert.equal(statusCalls, 0, 'cancelling keeps the clean finished and the pay as it is');
});

test('confirming Reopen on a clean with a pay reopens it', async () => {
  const calls = [];
  const reopen = makeReopen({
    task: { pay_amount: '600.00' },
    confirmDialog: async () => true,
    setStatus: (...args) => calls.push(args),
  });
  await reopen();
  assert.deepEqual(calls, [['in_progress', 'Reopened.']]);
});

test('Reopen goes straight through when the clean has no pay', async () => {
  const calls = [];
  let asked = 0;
  const reopen = makeReopen({
    task: { pay_amount: null },
    confirmDialog: async () => { asked += 1; return null; },
    setStatus: (...args) => calls.push(args),
  });
  await reopen();
  assert.equal(asked, 0);
  assert.deepEqual(calls, [['in_progress', 'Reopened.']]);
});

test('the Reopen button calls that handler, not the status change directly', () => {
  assert.match(src, /onclick: reopen \}, T\('Reopen'\)\)/);
  assert.doesNotMatch(src, /onclick: \(\) => setStatus\('in_progress', T\('Reopened\.'\)\)/);
});

// #19: the fallback box shown when the clipboard is blocked has a name for screen readers.
test('the copy-text fallback box has a name for screen readers', () => {
  assert.match(src, /h\('textarea', \{ class: 'input', rows: 12, readonly: true, value: text, 'aria-label': 'Task text to copy' \}\)/);
});

// #20: a decimal quantity is refused on its own row and nothing is sent; it is never rounded down.
test('Supplies used refuses a decimal quantity on its row and sends nothing', async () => {
  const sent = [];
  const submit = makeSuppliesSubmit({
    rows: [supplyRow('sup-1', '2.5'), supplyRow('sup-2', '3')],
    task: { task_id: 'task-1' },
    post: async (url, body) => { sent.push({ url, body }); return { skipped: [] }; },
  });
  await assert.rejects(submit(), (err) => {
    assert.equal(err.status, 400);
    assert.equal(err.message, 'Quantity must be a whole number.');
    assert.deepEqual(Object.keys(err.fields), ['qty-sup-1'], 'the message is placed on the row that is not whole');
    assert.equal(err.fields['qty-sup-1'], 'Quantity must be a whole number.');
    assert.equal(typeof err.onRender, 'function', 'the message is not repeated in the form box');
    return true;
  });
  assert.deepEqual(sent, [], 'a decimal row sends nothing, not even the whole rows');
});

test('every decimal row gets its own message, and a whole quantity is still sent as a whole number', async () => {
  const sent = [];
  const submit = makeSuppliesSubmit({
    rows: [supplyRow('sup-1', '0.5'), supplyRow('sup-2', '1.25'), supplyRow('sup-3', '2.0')],
    task: { task_id: 'task-1' },
    post: async (url, body) => { sent.push(body); return { skipped: [] }; },
  });
  await assert.rejects(submit(), (err) => {
    assert.deepEqual(Object.keys(err.fields).sort(), ['qty-sup-1', 'qty-sup-2']);
    return true;
  });
  assert.deepEqual(sent, []);

  const ok = [];
  const submitOk = makeSuppliesSubmit({
    rows: [supplyRow('sup-1', '2.0'), supplyRow('sup-2', ''), supplyRow('sup-3', '0', 'restocked')],
    task: { task_id: 'task-1' },
    post: async (url, body) => { ok.push({ url, body }); return { skipped: [] }; },
  });
  await submitOk();
  assert.deepEqual(ok, [{ url: '/cleaning-tasks/task-1/supplies', body: { items: [{ supply_id: 'sup-1', kind: 'used', quantity: 2 }] } }]);
});

test('the decimal refusal is a source-level rule too: no rounding, and Taglish wording for cleaners', () => {
  assert.doesNotMatch(src, /Math\.floor\(Number\(r\.qty\.value\)\)/);
  assert.match(src, /Number\.isInteger\(Number\(r\.qty\.value\)\)/);
  assert.match(src, /T\('Quantity must be a whole number\.'\)/);
  assert.match(src, /'Quantity must be a whole number\.': 'Dapat buong bilang ang dami\.'/);
});
