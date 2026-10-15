'use strict';

// QA round 14, lane F7b (ops, rent and tenants views). Frontend-only: no database.
// TOPBAR-PLAN F7: the Add new links open the dialog once the page is drawn, and never move focus.
// #21 the payment hint names the clicked month second; K5 each lease card button names its lease;
// #39 and #22 the standalone phone, email and board links are link-tap (44px on phones).
// node --test --test-concurrency=1 test/qa-r14-f7b.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public/js/views', f), 'utf8');
const hk = read('housekeeping.js');
const rent = read('rent.js');
const ten = read('tenants.js');

// The source between two markers, so a test reads one view's function and not the whole file.
const between = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to));
// The first line that matches one check, so a failure names the line it could not find.
const lineWith = (src, re) => {
  const line = src.split('\n').find((l) => re.test(l));
  assert.ok(line, `no line matches ${re}`);
  return line;
};
// An exported function's source, for pure helpers (the views import app.js, which a node test cannot load).
const grab = (src, name) => {
  const m = src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `export function ${name} not found`);
  return m[0].replace('export ', '');
};

// ---- Add new links open their dialog (TOPBAR-PLAN F7)

test('?new=1 on Housekeeping opens Add task for a manager once, after the list is drawn', () => {
  const tasks = between(hk, 'async function tasksTab', '// ---------------------------------------------------------------- board');
  const opener = lineWith(tasks, /query\??\.new\s*&&\s*canManage\(\)/);
  assert.match(opener, /newTaskModal\(/);
  assert.ok(opener.indexOf('delete query.new') > 0 && opener.indexOf('delete query.new') < opener.indexOf('newTaskModal('), 'the flag is dropped before the dialog opens');
  assert.doesNotMatch(opener, /\.focus\(/);
  assert.ok(tasks.indexOf('box.replaceChildren(') < tasks.indexOf(opener), 'the opener runs after the list is drawn');
  assert.ok(tasks.indexOf('await load();') < tasks.indexOf(opener), 'load() has already written the address without ?new');
});

test('Housekeeping passes the route query on unchanged, so a dropped flag stays dropped on every tab draw', () => {
  const view = between(hk, 'export async function housekeepingView', 'async function tasksTab');
  assert.doesNotMatch(view, /new: undefined/);
  assert.match(view, /run\(body, query\)/);
});

test('?new=expense and ?new=payment on Rent open their dialogs after the page is drawn', () => {
  const view = between(rent, 'export async function rentView', 'export async function paymentDetailView');
  const expense = lineWith(view, /query\.new === 'expense'/);
  const payment = lineWith(view, /query\.new === 'payment' && !stayOnly/);
  assert.match(expense, /addExpenseModal\(\{ onSaved: reload \}\)/);
  assert.match(payment, /recordPaymentModal\(\{ onSaved: reload \}\)/);
  assert.match(expense, /delete query\.new;[^\n]*addExpenseModal\(/, 'the flag is dropped before the dialog opens');
  assert.match(payment, /delete query\.new;[^\n]*recordPaymentModal\(/, 'the flag is dropped before the dialog opens');
  assert.doesNotMatch(`${expense}\n${payment}`, /\.focus\(/);
  assert.ok(view.indexOf('el.replaceChildren(') < view.indexOf(expense), 'the dialogs open after the page is drawn');
  assert.ok(view.indexOf('await load();') < view.indexOf(expense), 'load() has already written the address, keeping tab=expenses');
  assert.match(rent, /qs\(\{ tab: tab === 'rent' \? '' : tab/, 'the address keeps the tab');
});

test('?new=1 on Tenants opens Add tenant with the list reload, after the list is drawn', () => {
  const view = between(ten, 'export async function tenantsView', 'export async function tenantDetailView');
  const opener = lineWith(view, /query\??\.new\s*&&[^\n]*newTenantModal\(\{ onSaved/);
  assert.ok(opener.indexOf('delete query.new') > 0 && opener.indexOf('delete query.new') < opener.indexOf('newTenantModal('), 'the flag is dropped before the dialog opens');
  assert.doesNotMatch(opener, /\.focus\(/);
  assert.ok(view.indexOf('el.replaceChildren(') < view.indexOf(opener), 'the opener runs after the list is drawn');
  assert.ok(view.indexOf('await load();') < view.indexOf(opener), 'load() has already written the address without ?new');
});

// ---- #21 the payment hint (D-85): the oldest month takes the money first, the clicked month is named second

test('#21 the payment hint names the clicked month second, and the oldest month alone when none is clicked', () => {
  const goesFirstLine = new Function(`${grab(rent, 'goesFirstLine')}\nreturn goesFirstLine;`)();
  assert.equal(goesFirstLine('September 2026', 'October 2026'),
    'This payment goes to September 2026 first (the oldest unpaid month), then to October 2026.');
  assert.equal(goesFirstLine('September 2026', 'September 2026'), 'This payment goes to September 2026 first (the oldest unpaid month).');
  assert.equal(goesFirstLine('September 2026'), 'This payment goes to September 2026 first (the oldest unpaid month).');
});

test('#21 the balance line uses goesFirstLine with the oldest and the clicked month', () => {
  assert.match(rent, /goesFirstLine\(fmtMonth\(l\.oldest_unpaid_period\), row && fmtMonth\(row\)\)/);
});

// ---- K5 (D-81): the lease card buttons repeat their names when a tenant has two leases

test('K5 each lease card button names its unit and start date', () => {
  const card = between(ten, 'const leaseCard', 'const chargeRows');
  const buttons = card.split('\n').filter((l) => l.includes("h('button'"));
  assert.equal(buttons.length, 5);
  for (const b of buttons) assert.match(b, /'aria-label': leaseLabel\(l, '[^']+'\)/, b);
  assert.match(ten, /const leaseLabel = \(l, action\) => `\$\{action\}, \$\{unitLabel\(l\.unit_name\)\}, from \$\{fmtDate\(l\.start_date\)\}`;/);
});

// ---- Phone sizes (#22, #39): standalone links are link-tap

test('#22 the tenant phone and email links are link-tap', () => {
  assert.match(lineWith(ten, /href: `tel:/), /class: 'link-tap'/);
  assert.match(lineWith(ten, /href: `mailto:/), /class: 'link-tap'/);
});

test('#39 the board Open task link is link-tap', () => {
  assert.match(lineWith(hk, /\$\{u\.open_task\.task_id\}/), /class: 'link-tap'/);
});

test('the standalone Open the reservation and View request links are link-tap', () => {
  assert.match(lineWith(hk, /Open the reservation/), /class: 'link-tap'/);
  assert.match(lineWith(rent, /View request/), /class: 'link-tap'/);
});
