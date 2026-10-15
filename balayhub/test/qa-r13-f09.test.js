'use strict';

// QA round 13, lane F09 (pnl-labels). #33: workspace expenses with no unit are one "Whole-property expenses" row on
// the P&L screen, the P&L CSV and the Reports CSV (the same money had two names). #32: clearing the P&L month box
// shows this month again, fills the box, and says so.
// The server checks run against the test database. The view is loaded from copies beside its helpers (as
// qa-r10-c09 does), and its month handler is checked in the source.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_04 node --test --test-concurrency=1 test/qa-r13-f09.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, ownerAccount, sql } = require('./helpers');

const M = '2026-09';
const LABEL = 'Whole-property expenses';
// The same Manila "this month" the page uses.
const manilaThisMonth = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);

let srv; let host; let dir; let pnl;

test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'QA R13 Money');
  const [{ organization_id: orgId }] = await sql('SELECT organization_id FROM organizations WHERE name = $1', ['QA R13 Money']);
  const [{ user_id: userId }] = await sql(`SELECT user_id FROM users WHERE email = 'host@example.com'`);
  const p = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  // A listing with a nightly rate puts the property in the Reports figures, so its building-level expenses are counted.
  await host.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' });
  // One expense with no unit: the building dues.
  await sql(`INSERT INTO expenses (organization_id, property_id, unit_id, category, description, amount, expense_date, recorded_by)
             VALUES ($1, $2, NULL, 'repairs', 'Association dues', '225.00', $3, $4)`, [orgId, p.property_id, `${M}-05`, userId]);

  // ui.js patches Element.prototype when it loads; the checks below only read the view's exports, so stubs are enough.
  globalThis.Element = class Element { replaceChildren() {} append() {} };
  globalThis.document = { createElement() {} };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r13-f09-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.copyFileSync(path.join(__dirname, '../public/js/views/pnl.js'), path.join(dir, 'views', 'pnl.js'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { user_id: 1 } };\n');
  pnl = await import(pathToFileURL(path.join(dir, 'views', 'pnl.js')));
});

test.after(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  await srv.close();
});

test('#33: the P&L screen names a workspace expense with no unit "Whole-property expenses"', async () => {
  const r = await host.get(`/api/reports/pnl?month=${M}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const row = r.data.rows.find((x) => x.unit_id === null);
  assert.equal(row.unit_name, LABEL);
  assert.equal(row.expenses, '225.00');
});

test('#33: the P&L CSV names that row the same way', async () => {
  const csv = await host.raw('GET', `/api/reports/pnl.csv?month=${M}`);
  assert.equal(csv.status, 200);
  assert.ok(csv.data.includes(`,${LABEL},0,0,0.00,0.00,0.00,225.00,-225.00`), csv.data);
});

test('#33: the Reports CSV names the same money the same way', async () => {
  const csv = await host.get(`/api/stay-reports/export?month=${M}`);
  assert.equal(csv.status, 200);
  assert.ok(csv.data.includes(`${LABEL},,,,,,,,225.00,`), csv.data);
});

test('#33: the P&L view no longer uses the old name for that row', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'pnl.js'), 'utf8');
  assert.match(src, /'Whole-property expenses'/);
  assert.doesNotMatch(src, /Not linked to a unit/);
});

test('#32: an empty month means this month (Manila), and a chosen month is kept', () => {
  assert.equal(pnl.monthOrToday(''), manilaThisMonth());
  assert.equal(pnl.monthOrToday('2026-09'), '2026-09');
});

test('#32: clearing the month box refills it with this month and the status line says so', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'pnl.js'), 'utf8');
  assert.match(src, /'Showing this month\.'/);
  assert.doesNotMatch(src, /if \(e\.target\.value\)/, 'an empty box must still reload the page');
  assert.match(src, /monthInput\.value = month;/);
});
