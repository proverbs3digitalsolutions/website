'use strict';
// QA round 5, lane C11 (housekeeping view). Four fixes on the cleaning job and the checklist editor:
// #29 a paid clean has no Reopen button; the job says to undo the payment on Cleaner pay first.
// #30 a found item shows Held, Returned or Disposed (Taglish for cleaners), not the raw database word.
// #34 the checklist editor refuses a repeated line before it sends anything.
// O-d a negative quantity under Supplies used is refused on its own row, and nothing is sent.
// The view imports browser modules, so the handlers are run from their own source, with stubs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/housekeeping.js'), 'utf8');
// Stands in for api.js's ApiError: the view reads message, status and fields from it.
class FakeApiError extends Error {
  constructor(message, { status, fields } = {}) { super(message); this.status = status; this.fields = fields; }
}

// #34: the checklist editor's Save handler is the onSubmit that starts by building the list.
const fieldErrorSrc = src.match(/export function fieldError[\s\S]*?\n}\n/)[0].replace('export ', '');
const checklistSrc = (src.match(/ {4}onSubmit: async \(d\) => \{\n {6}const list = [\s\S]*?\n {4}\},/) || [''])[0]
  .replace(/^\s*onSubmit: /, '').replace(/,\s*$/, '');
function makeChecklistSubmit({ api, toast = () => {} }) {
  assert.ok(checklistSrc, 'checklistModal has a Save handler');
  const fieldError = new Function('ApiError', `${fieldErrorSrc}\nreturn fieldError;`)(FakeApiError);
  return new Function('ApiError', 'fieldError', 'api', 'toast', `return (${checklistSrc});`)(FakeApiError, fieldError, api, toast);
}

// O-d: the Supplies used Save handler is the onSubmit of suppliesModal (the one with no arguments).
const suppliesSrc = (src.match(/ {4}onSubmit: async \(\) => \{[\s\S]*?\n {4}\},/) || [''])[0].replace(/^\s*onSubmit: /, '').replace(/,\s*$/, '');
function makeSuppliesSubmit({ rows, task, post }) {
  assert.ok(suppliesSrc, 'suppliesModal has a Save handler');
  return new Function('rows', 'task', 'ApiError', 'T', 'post', 'toast', 'onSaved', `return (${suppliesSrc});`)(
    rows, task, FakeApiError, (s) => s, post, () => {}, () => {});
}
const supplyRow = (id, qty, kind = 'used') => ({ sp: { supply_id: id, name: `Supply ${id}` }, key: `qty-${id}`, qty: { value: qty }, kind: { value: kind } });

// #29: Reopen is not offered on a paid clean, because the server refuses it (PAID, 409).
test('the Reopen button is not shown on a paid clean', () => {
  const reopenLine = src.split('\n').find((l) => l.includes('onclick: reopen'));
  assert.ok(reopenLine, 'the Reopen button calls the reopen handler');
  assert.match(reopenLine, /canReopen\(t, state\.user\.role\)/);
});

// Staff get no pay amount or pay status now, but the server sends is_paid to every role. The paid check
// reads is_paid, falls back to pay_status only for an older response, and the three helpers are pure so
// they can be run here with the view's own source.
function pureHelpers(names) {
  const code = names.map((n) => {
    const m = src.match(new RegExp(`export function ${n}\\([\\s\\S]*?\\n}\\n`));
    assert.ok(m, `${n} is an exported helper of the view`);
    return m[0].replace('export ', '');
  }).join('\n');
  return new Function(`${code}\nreturn { ${names.join(', ')} };`)();
}

test('a clean is paid by the server is_paid flag for every role, with pay_status as the fallback', () => {
  const { isPaidClean } = pureHelpers(['isPaidClean']);
  assert.equal(isPaidClean({ is_paid: true, pay_status: null }), true, 'staff see a paid clean as paid');
  assert.equal(isPaidClean({ is_paid: false, pay_status: 'paid' }), false, 'the server flag wins');
  assert.equal(isPaidClean({ pay_status: 'paid' }), true, 'an older response without is_paid falls back to pay_status');
  assert.equal(isPaidClean({ pay_status: 'unpaid' }), false);
});

test('nobody gets Reopen on a paid clean, staff included; an unpaid finished clean stays reopenable by staff and managers', () => {
  const { canReopen } = pureHelpers(['isPaidClean', 'canReopen']);
  const paid = { status: 'done', is_paid: true, pay_status: null };
  assert.equal(canReopen(paid, 'staff'), false);
  assert.equal(canReopen(paid, 'manager'), false);
  assert.equal(canReopen(paid, 'owner'), false);
  assert.equal(canReopen({ status: 'done', is_paid: false, pay_status: null }, 'staff'), true);
  assert.equal(canReopen({ status: 'done', is_paid: false, pay_status: null }, 'owner'), true);
  assert.equal(canReopen({ status: 'done', is_paid: false, pay_status: null }, 'cleaner'), false, 'cleaners never reopen');
  assert.equal(canReopen({ status: 'in_progress', is_paid: false, pay_status: null }, 'owner'), false, 'only a finished clean reopens');
});

test('staff on a paid clean are told an owner has to undo the payment, the same as managers', () => {
  const { undoPaidLead } = pureHelpers(['undoPaidLead']);
  assert.equal(undoPaidLead('staff'), 'Paid. To reopen it, an owner needs to undo the payment on ');
  assert.equal(undoPaidLead('manager'), undoPaidLead('staff'));
  assert.equal(undoPaidLead('owner'), 'Paid. To reopen it, undo the payment on ');
});

// The link to Cleaner pay goes only where routeaccess.js opens that page. Staff are blocked there (STAFF_BLOCKED),
// so staff get the same words as plain text.
function routeAllowedFn() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'public/js/routeaccess.js'), 'utf8').replace(/export /g, '');
  return new Function(`${code}\nreturn routeAllowed;`)();
}

test('the Cleaner pay link is shown only to the roles the route rules open to Cleaner pay', () => {
  const { canOpenCleanerPay } = pureHelpers(['canOpenCleanerPay']);
  const routeAllowed = routeAllowedFn();
  for (const role of ['owner', 'manager', 'staff']) {
    assert.equal(canOpenCleanerPay(role), routeAllowed('/cleaner-pay', { role, business_type: 'short_term' }), `${role} matches routeaccess.js`);
  }
  assert.equal(canOpenCleanerPay('cleaner'), false, 'cleaners never see the link');
});

test('the job page builds its paid note and Reopen button from those helpers', () => {
  assert.match(src, /t\.status === 'done' && isPaidClean\(t\) && \(isCleaner\(\)/);
  assert.match(src, /const payLink = canOpenCleanerPay\(state\.user\.role\) \? h\('a', \{ href: '#\/cleaner-pay' \}, 'Cleaner pay'\) : 'Cleaner pay';/);
  assert.match(src, /undoPaidLead\(state\.user\.role\), payLink, ' first\.'/);
  assert.match(src, /canReopen\(t, state\.user\.role\) && h\('button'/);
});

test('a paid clean says to undo the payment on Cleaner pay first, with a link there', () => {
  assert.match(src, /'Paid\. To reopen it, undo the payment on '/);
  assert.match(src, /h\('a', \{ href: '#\/cleaner-pay' \}, 'Cleaner pay'\)/);
});

test('a manager is told an owner has to undo the payment, because only owners see Undo paid', () => {
  assert.match(src, /an owner needs to undo the payment on /);
  assert.match(src, /role === 'owner' \? 'Paid\. To reopen it, undo the payment on '/);
});

test('cleaners see only "Paid." on a paid clean, in the workspace language', () => {
  assert.match(src, /T\('Paid\.'\)/);
  assert.match(src, /'Paid\.': 'Bayad na\.'/);
});

// #30: the found-item status is a word from a fixed list, shown with its label.
test('a found item shows Held, Returned or Disposed, never the raw database word', () => {
  assert.doesNotMatch(src, /l\.status && h\('span'/);
  assert.match(src, /const LOST_STATUS = \{ held: 'Held', returned: 'Returned', disposed: 'Disposed' \};/);
  assert.match(src, /LOST_STATUS\[l\.status\] && h\('span', \{ class: 'small muted' \}, T\(LOST_STATUS\[l\.status\]\)\)/);
});

test('the found-item labels have Taglish wording for cleaners', () => {
  assert.match(src, /'Held': 'Hawak pa'/);
  assert.match(src, /'Returned': 'Naibalik'/);
  assert.match(src, /'Disposed': 'Itinapon'/);
});

// #34: a repeated line (trimmed, any capitals) is refused in the editor, with the server's wording.
test('the checklist editor refuses a repeated line and sends nothing', async () => {
  const sent = [];
  const submit = makeChecklistSubmit({ api: async (...args) => { sent.push(args); } });
  await assert.rejects(submit({ items: 'Change towels\nSweep floor\n change TOWELS ' }), (err) => {
    assert.equal(err.message, 'This checklist has “Change towels” twice.');
    assert.deepEqual(err.fields, { items: 'This checklist has “Change towels” twice.' });
    return true;
  });
  assert.deepEqual(sent, []);
});

test('a checklist with distinct lines is saved as its trimmed lines', async () => {
  const sent = [];
  const submit = makeChecklistSubmit({ api: async (...args) => { sent.push(args); } });
  await submit({ items: ' Change towels \nSweep floor\n\nTowels for guests ' });
  assert.deepEqual(sent, [['PUT', '/cleaning-checklist', { items: ['Change towels', 'Sweep floor', 'Towels for guests'] }]]);
});

// O-d: -2 used to vanish (only > 0 was kept) and "Supplies saved." showed. It is refused on its row now.
test('a negative quantity is refused on its own row and nothing is sent', async () => {
  const sent = [];
  const submit = makeSuppliesSubmit({
    rows: [supplyRow('sup-1', '-2'), supplyRow('sup-2', '3')],
    task: { task_id: 'task-1' },
    post: async (url, body) => { sent.push({ url, body }); return { skipped: [] }; },
  });
  await assert.rejects(submit(), (err) => {
    assert.equal(err.status, 400);
    assert.equal(err.message, 'Quantity can\'t be negative.');
    assert.deepEqual(Object.keys(err.fields), ['qty-sup-1'], 'the message is placed on the negative row only');
    assert.equal(typeof err.onRender, 'function', 'the message is not repeated in the form box');
    return true;
  });
  assert.deepEqual(sent, []);
});

test('a negative decimal gets the negative message, and blank or zero rows are still ignored', async () => {
  const sent = [];
  const submit = makeSuppliesSubmit({
    rows: [supplyRow('sup-1', '-2.5'), supplyRow('sup-2', '0'), supplyRow('sup-3', '')],
    task: { task_id: 'task-1' },
    post: async (url, body) => { sent.push({ url, body }); return { skipped: [] }; },
  });
  await assert.rejects(submit(), (err) => {
    assert.deepEqual(err.fields, { 'qty-sup-1': 'Quantity can\'t be negative.' });
    return true;
  });
  assert.deepEqual(sent, []);
});

test('the negative-quantity message has Taglish wording for cleaners', () => {
  assert.match(src, /T\('Quantity can\\'t be negative\.'\)/);
  assert.match(src, /'Quantity can\\'t be negative\.': 'Hindi puwedeng negatibo ang dami\.'/);
});
