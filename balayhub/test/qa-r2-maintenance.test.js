'use strict';

// QA round 2, lane A19 (maintenance): search treats % and _ as plain text; the photo/document
// upload input has an accessible name; Cancel request asks first in the app's own dialog.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ownerAccount } = require('./helpers');

const VIEW = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'maintenance.js'), 'utf8');

let srv; let owner; let prop;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-r2-19@example.com', 'R2 Maintenance Co');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  for (const title of ['Fix 50% of roof', 'Fix roof gutter', 'Check a_b joint', 'Check axb joint', 'Pipe \\ bracket']) {
    const r = await owner.post('/api/maintenance', { property_id: prop.property_id, title, priority: 'medium' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
});
test.after(async () => { await srv.close(); });

async function searchTitles(q) {
  const r = await owner.get(`/api/maintenance?q=${encodeURIComponent(q)}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.requests.map((m) => m.title).sort();
}

test('GET /api/maintenance search matches % and _ as plain characters, not wildcards', async () => {
  assert.deepEqual(await searchTitles('%'), ['Fix 50% of roof']);
  assert.deepEqual(await searchTitles('_'), ['Check a_b joint']);
  assert.deepEqual(await searchTitles('a_b'), ['Check a_b joint']);
  assert.deepEqual(await searchTitles('\\'), ['Pipe \\ bracket']);
});

test('GET /api/maintenance search still matches ordinary words', async () => {
  assert.deepEqual(await searchTitles('roof'), ['Fix 50% of roof', 'Fix roof gutter']);
});

test('the photo/document upload input has an accessible name', () => {
  const fileInputs = VIEW.split('\n').filter((l) => l.includes("type: 'file'"));
  assert.ok(fileInputs.length > 0, 'upload input found');
  for (const line of fileInputs) assert.match(line, /'aria-label': 'Upload photo or document'/);
});

test('Cancel request asks first in the app dialog, says recorded costs stay, and only then changes the status', () => {
  const block = VIEW.slice(VIEW.indexOf('const statusButtons'), VIEW.indexOf('const edit = '));
  const ask = block.indexOf('await confirmDialog(');
  assert.ok(ask > -1, 'Cancel goes through confirmDialog');
  assert.match(block, /Recorded costs stay on the books\./);
  assert.ok(ask < block.indexOf('await patch('), 'the status change waits for the answer');
});

test('the maintenance view uses no native alert, confirm or prompt', () => {
  assert.doesNotMatch(VIEW, /(^|[^.\w])(alert|confirm|prompt)\(/m);
});
