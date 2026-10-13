'use strict';

// Shared browser helpers (api.js, ui.js, i18n.js), loaded from a temp copy as ES modules.
// Frontend-only: no database, fetch is stubbed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let api; let ui; let i18n;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-shared-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'i18n.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  globalThis.Element = class { };
  api = await import(pathToFileURL(path.join(dir, 'api.js')));
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
  i18n = await import(pathToFileURL(path.join(dir, 'i18n.js')));
});

const stub = (status, body) => { globalThis.fetch = async () => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body }); };

test('VALIDATION errors carry the field messages as message and keep the generic text as summary', async () => {
  stub(400, { error: 'Please check the highlighted fields.', code: 'VALIDATION', fields: { addons: 'Too many.', date: 'Too late.' } });
  const err = await api.get('/x').catch((e) => e);
  assert.equal(err.message, 'Too many. Too late.');
  assert.equal(err.summary, 'Please check the highlighted fields.');
  assert.deepEqual(err.fields, { addons: 'Too many.', date: 'Too late.' });
});

test('non-validation errors keep the server message', async () => {
  stub(409, { error: 'Dates taken.', code: 'CONFLICT' });
  const err = await api.get('/x').catch((e) => e);
  assert.equal(err.message, 'Dates taken.');
  assert.equal(err.summary, undefined);
});

test('showErrors returns messages for fields that are not on the form', () => {
  const wrap = { classList: { add() {} }, querySelector: () => null };
  const form = { querySelector: (sel) => (sel.includes('"name"') ? wrap : null) };
  globalThis.CSS = { escape: (s) => s };
  assert.deepEqual(ui.showErrors(form, { name: 'Bad', addons: 'Over the limit.' }), ['Over the limit.']);
});

test('manilaDay and fmtDate use the Manila calendar day', () => {
  assert.equal(ui.manilaDay('2026-10-13T21:53:00.000Z'), '2026-10-14');
  assert.equal(ui.manilaDay('2026-10-13T15:59:00.000Z'), '2026-10-13');
  assert.equal(ui.manilaDay('2026-10-13'), '2026-10-13');
  assert.equal(ui.manilaDay(null), '');
  assert.match(ui.fmtDate('2026-10-13T21:53:00.000Z'), /Oct 14, 2026/);
  assert.match(ui.fmtDate('2026-10-13'), /Oct 13, 2026/);
  assert.match(i18n.fmtDateL('2026-10-13T21:53:00.000Z'), /Oct 14, 2026/);
});

test('unitLabel adds "Unit" only for names starting with a digit', () => {
  assert.equal(ui.unitLabel('1'), 'Unit 1');
  assert.equal(ui.unitLabel('2B'), 'Unit 2B');
  assert.equal(ui.unitLabel('Unit 1'), 'Unit 1');
  assert.equal(ui.unitLabel('Room A'), 'Room A');
});
