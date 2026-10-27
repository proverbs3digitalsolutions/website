'use strict';
require('./helpers');
// QA round 50, lane DASHNAME (C6, D-132): the dashboard's heading is its menu name. A workspace with both kinds of rental
// shows "Long-term rentals" (the menu's word); a long-term-only workspace keeps "Dashboard".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'dashboard.js'), 'utf8');

// dashboard.js loads from a temp copy beside stand-in modules; h() builds plain objects so no DOM is needed.
let dir; let view; let shell;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r50-dashname-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  fs.copyFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'dashboard.js'), path.join(dir, 'views', 'dashboard.js'));
  fs.writeFileSync(path.join(dir, 'api.js'), "export const get = async () => ({ portfolio: { properties: 0 }, month_start: '2026-10-01' });\n");
  fs.writeFileSync(path.join(dir, 'ui.js'),
    "export const h = (tag, props, ...children) => ({ tag, props, children: children.flat() });\n" +
    "export const icon = () => null; export const peso = String; export const fmtDate = String; export const fmtMonth = String;\n" +
    "export const badge = () => null; export const emptyState = () => null; export const label = String; export const unitLabel = String;\n");
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: null };\n");
  for (const [f, n] of [['rent', 'recordPaymentModal'], ['maintenance', 'newMaintenanceModal'], ['tenants', 'newTenantModal'], ['properties', 'newPropertyModal']]) {
    fs.writeFileSync(path.join(dir, 'views', `${f}.js`), `export const ${n} = () => {};\n`);
  }
  shell = await import(pathToFileURL(path.join(dir, 'app.js')).href);
  view = await import(pathToFileURL(path.join(dir, 'views', 'dashboard.js')).href);
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const h1Of = (node) => {
  if (!node || typeof node !== 'object') return null;
  if (node.tag === 'h1') return node.children.join('');
  for (const c of node.children || []) { const r = h1Of(c); if (r) return r; }
  return null;
};
async function heading(businessType) {
  shell.state.user = { role: 'owner', organization_name: 'Org', business_type: businessType };
  let drawn;
  await view.dashboardView({ replaceChildren: (...n) => { drawn = n; } }, { rerender() {} });
  return drawn.map(h1Of).find(Boolean);
}

test('a workspace with both kinds of rental reads "Long-term rentals"', async () => {
  assert.equal(await heading('both'), 'Long-term rentals');
});
test('a long-term-only workspace still reads "Dashboard"', async () => {
  assert.equal(await heading('long_term'), 'Dashboard');
});
test('source: the heading follows business_type', () => {
  assert.match(SRC, /business_type === 'both' \? 'Long-term rentals' : 'Dashboard'/);
});
