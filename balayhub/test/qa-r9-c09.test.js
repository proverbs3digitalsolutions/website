'use strict';

// QA round 9, lane C09 (housekeeping, lost and found, settings label). K2: the checklist activity row names the items
// field ("Changed: Checklist items"), not a count, and a save with no change writes no row. #38: each lost-and-found
// row button names its item, so Returned, Disposed and Back to held are told apart. N17: with exactly one listing,
// Add task starts on that listing (the shared field helper; checked here, not assumed).
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_07 node --test --test-concurrency=1 test/qa-r9-c09.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, sql, ownerAccount } = require('./helpers');

let srv; let owner; let orgId; let dir; let settings; let ui;

// A minimal stand-in for the browser DOM: just enough for h() and field() to build their nodes.
class FakeElement {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.attributes = {}; this.children = []; this.style = {}; this.dataset = {}; }
  setAttribute(k, v) { this.attributes[k] = v; }
  addEventListener() { }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
}
const findTag = (node, tag) => {
  if (node.tagName === tag) return node;
  for (const c of node.children || []) {
    const hit = c.tagName ? findTag(c, tag) : null;
    if (hit) return hit;
  }
  return null;
};

test.before(async () => {
  // settings.js and ui.js are browser modules. Load them from a temp copy, with their browser-only imports stubbed.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r9-c09-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = {}; export async function refreshUser() {}\n');
  fs.writeFileSync(path.join(dir, 'notifications.js'), 'export async function notificationsCard() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'themeswitch.js'), 'export function themeSwitch() { return null; }\n');
  fs.copyFileSync(path.join(__dirname, '../public/js/views/settings.js'), path.join(dir, 'views', 'settings.js'));
  globalThis.Node = FakeElement;
  globalThis.Element = FakeElement;
  globalThis.document = { createElement: (tag) => new FakeElement(tag), createTextNode: (text) => ({ text }) };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')).href);
  settings = await import(pathToFileURL(path.join(dir, 'views', 'settings.js')).href);

  srv = await startServer();
  owner = await ownerAccount(srv.base, 'c09r9-owner@example.com', 'C09 Stays');
  const ownerId = (await owner.get('/api/auth/me')).data.user.user_id;
  [{ organization_id: orgId }] = await sql('SELECT organization_id FROM users WHERE user_id = $1', [ownerId]);
});
test.after(async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('K2 a checklist change writes one row that names the items field, not a count; the same list writes no row', async () => {
  const rows = () => sql(
    `SELECT details FROM audit_logs WHERE action = 'cleaning.checklist_updated' AND organization_id = $1 ORDER BY created_at`, [orgId]);
  const before = (await rows()).length;
  assert.equal((await owner.raw('PUT', '/api/cleaning-checklist', { items: ['C09 sweep', 'C09 mop'] })).status, 200);
  const after = await rows();
  assert.equal(after.length, before + 1, 'the change writes one row');
  assert.deepEqual(after.at(-1).details, { fields: ['items'] });
  assert.equal((await owner.raw('PUT', '/api/cleaning-checklist', { items: ['C09 sweep', 'C09 mop'] })).status, 200);
  assert.equal((await rows()).length, before + 1, 'the same list writes no row');
});

test('K2 the activity line for a checklist change reads "Changed: Checklist items", not a bare key', () => {
  assert.equal(settings.summarize({ fields: ['items'] }, 'cleaning.checklist_updated'), 'Changed: Checklist items');
});

test('N17 a required listing choice with one listing starts on that listing; with two it starts on Select', () => {
  const one = ui.field({ name: 'unit_id', label: 'Listing', type: 'select', required: true, options: [['u-1', '1201 — Azure']] });
  const oneOptions = findTag(one, 'SELECT').children.filter((o) => o.tagName === 'OPTION');
  assert.equal(oneOptions.find((o) => o.attributes.value === 'u-1').selected, true);

  const two = ui.field({ name: 'unit_id', label: 'Listing', type: 'select', required: true, options: [['u-1', '1201 — Azure'], ['u-2', 'Loft A']] });
  const twoOptions = findTag(two, 'SELECT').children.filter((o) => o.tagName === 'OPTION');
  assert.equal(twoOptions.some((o) => o.selected), false, 'two listings: nothing is preselected');
  assert.equal(twoOptions[0].attributes.value, '', 'the Select placeholder stays first');
});

test('#38 each lost-and-found row button names its item, so Returned, Disposed and Back to held are told apart', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/lostfound.js'), 'utf8');
  assert.ok(src.includes("'aria-label': `Mark returned: ${it.description}`"), 'Returned button');
  assert.ok(src.includes("'aria-label': `Mark disposed: ${it.description}`"), 'Disposed button');
  assert.ok(src.includes("'aria-label': `Back to held: ${it.description}`"), 'Back to held button (same name on every row)');
});
