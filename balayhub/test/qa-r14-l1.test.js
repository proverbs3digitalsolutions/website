'use strict';
// QA round 14, lane L1 (reports, dashboard, properties; red-first).
// #23: the Generated line of the Reports export and the P&L download reads "Oct 15, 2026, 11:43 AM" (Manila), not a US date.
// #30: a short-term workspace that opens #/reports is sent to #/stay-reports (replacing the page) before any report data loads.
// #20: the Billed sub-line names the dates the period covers.
// #22, #26: the dashboard "View all" links, the property tenant names and the Reports property links carry link-tap.
// Database part: TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_14 node --test --test-concurrency=1 test/qa-r14-l1.test.js

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, ownerAccount } = require('./helpers');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const GENERATED = /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} (AM|PM)$/;

let srv; let host;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'l1-owner@example.com', 'L1 Rentals');
});
test.after(async () => { await srv.close(); });

// The Generated value of a CSV. The writer quotes a value with a comma in it, so the quotes come off here.
function generatedOf(csv) {
  const line = csv.split('\r\n').find((l) => l.startsWith('Generated,'));
  assert.ok(line, 'the CSV has a Generated line');
  return line.slice('Generated,'.length).replace(/^"|"$/g, '');
}

test('#23 the Generated line of the Reports export reads like the screens, in Manila time', async () => {
  const csv = await host.raw('GET', '/api/reports/export?from=2026-01-01&to=2026-12-31');
  assert.equal(csv.status, 200);
  assert.match(generatedOf(csv.data), GENERATED);
});

test('#23 the Generated line of the P&L download reads the same way', async () => {
  const csv = await host.raw('GET', '/api/reports/pnl.csv?month=2026-01');
  assert.equal(csv.status, 200);
  assert.match(generatedOf(csv.data), GENERATED);
});

// reports.js loads from a temp copy beside a stub app shell, because the real shell does not load in Node
// (the same set-up as test/qa-r13-f08.test.js). The stub records navigate() calls.
let dir; let shell; let reportsView;
test.before(async () => {
  globalThis.Element = class { };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r14-l1-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '..', 'public', 'js', f), path.join(dir, f));
  fs.copyFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'reports.js'), path.join(dir, 'views', 'reports.js'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: null };\nexport const navigations = [];\nexport function navigate(hash, opts) { navigations.push([hash, opts]); }\n');
  shell = await import(pathToFileURL(path.join(dir, 'app.js')).href);
  ({ reportsView } = await import(pathToFileURL(path.join(dir, 'views', 'reports.js')).href));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => { shell.navigations.length = 0; });

// Runs the page with a fetch that records each address and fails, so the page stops at its first request.
async function openWithoutServer(user) {
  shell.state.user = user;
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => { asked.push(String(url)); throw new Error('no server in this test'); };
  try {
    await reportsView({}, { query: {} }).catch(() => {});
  } finally {
    globalThis.fetch = realFetch;
  }
  return asked;
}

test('#30 a short-term workspace opening #/reports is sent to #/stay-reports with replace, before any report loads', async () => {
  const asked = await openWithoutServer({ role: 'owner', business_type: 'short_term' });
  assert.deepEqual(shell.navigations, [['#/stay-reports', { replace: true }]]);
  assert.deepEqual(asked, []);
});

test('#30 a both-modules workspace stays on #/reports', async () => {
  const asked = await openWithoutServer({ role: 'owner', business_type: 'both' });
  assert.deepEqual(shell.navigations, []);
  assert.ok(asked.includes('/api/properties'));
});

test('#20 the Billed sub-line names the period it covers', () => {
  assert.ok(read('public/js/views/reports.js').includes('`Billed ${peso(t.billed)} (due ${shortDate(from)} – ${shortDate(to)})`'));
});

test('#22 and #26 the standalone links that were too small carry link-tap', () => {
  const dash = read('public/js/views/dashboard.js');
  assert.equal(dash.split("h('a', { href: '#/rent' }, 'View all')").length - 1, 0);
  assert.equal(dash.split("h('a', { href: '#/rent?tab=payments' }, 'View all')").length - 1, 0);
  assert.equal(dash.split("h('a', { class: 'link-tap', href: '#/rent', 'aria-label':").length - 1, 1);
  assert.equal(dash.split("h('a', { class: 'link-tap', href: '#/rent?tab=payments', 'aria-label':").length - 1, 1);
  assert.ok(read('public/js/views/properties.js').includes("h('a', { class: 'link-tap', href: `#/tenants/${u.tenant_id}` }, u.tenant_name)"));
  assert.ok(read('public/js/views/reports.js').includes("h('a', { class: 'link-tap', href: `#/properties/${p.property_id}` }, p.property_name)"));
});

test('#22 and #26 follow-up: the dashboard N overdue link and the Reports Outstanding tenant links carry link-tap', () => {
  assert.ok(read('public/js/views/dashboard.js').includes("h('a', { class: 'link-tap', href: '#/rent?status=overdue' }, `${d.overdue_tenant_count} overdue`)"));
  assert.ok(read('public/js/views/reports.js').includes("h('a', { class: 'link-tap', href: `#/tenants/${o.tenant_id}` }, o.tenant_name)"));
});

test('D-81 the two dashboard View all links have their own accessible names, each naming its card heading', () => {
  const src = read('public/js/views/dashboard.js');
  assert.equal(src.split(", 'View all')").length - 1, 2);
  assert.ok(src.includes("const rentTitle = `Rent for ${fmtMonth(d.month_start)}`"));
  assert.ok(src.includes('h(\'h2\', null, rentTitle)'));
  assert.ok(src.includes("h('a', { class: 'link-tap', href: '#/rent', 'aria-label': `View all: ${rentTitle}` }, 'View all')"));
  assert.ok(src.includes("h('a', { class: 'link-tap', href: '#/rent?tab=payments', 'aria-label': 'View all: Recent payments' }, 'View all')"));
});
