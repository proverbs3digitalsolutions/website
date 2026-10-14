'use strict';

// QA r9 C12: shared ui.js: focus after a redraw, date range, confirm label, toasts, thumbnails. Frontend-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const src = fs.readFileSync(path.join(__dirname, '../public/js/ui.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c12-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  globalThis.Element = class { };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

const el = (tagName, attrs = {}, text = '', isConnected = true) => ({
  tagName, isConnected, textContent: text, getAttribute: (k) => attrs[k] ?? null,
});

test('sameControl finds the new control by tag and aria-label, else by text, else null', () => {
  const old = el('BUTTON', { 'aria-label': 'Mark paid' }, 'x', false);
  const fresh = el('BUTTON', { 'aria-label': 'Mark paid' });
  const other = el('BUTTON', { 'aria-label': 'Undo' });
  const doc = { querySelectorAll: (t) => (t === 'button' ? [other, fresh] : []) };
  assert.equal(ui.sameControl(old, doc), fresh);
  const oldText = el('BUTTON', {}, ' Record ', false);
  const byText = el('BUTTON', {}, 'Record');
  assert.equal(ui.sameControl(oldText, { querySelectorAll: () => [other, byText] }), byText);
  assert.equal(ui.sameControl(oldText, { querySelectorAll: () => [other] }), null);
  assert.equal(ui.sameControl(el('A', {}, '', false), { querySelectorAll: () => [other] }), null);
  assert.equal(ui.sameControl(null, doc), null);
});

test('dateOutOfRange refuses years outside 2000 to 2100', () => {
  assert.equal(ui.dateOutOfRange('1900-01-01'), true);
  assert.equal(ui.dateOutOfRange('2000-01-01'), false);
  assert.equal(ui.dateOutOfRange('2100-12-31'), false);
  assert.equal(ui.dateOutOfRange('2101-01-01'), true);
  assert.equal(ui.dateOutOfRange('0202-05-05'), true);
  assert.equal(ui.dateOutOfRange('12345-01-01'), true);
  assert.equal(ui.dateOutOfRange(''), false);
});

test('source: dialogs restore focus, confirm swaps the saving label, summaries, toasts, thumbnails', () => {
  const modal = src.slice(src.indexOf('export function openModal'), src.indexOf('export function confirmDialog'));
  assert.match(modal, /const opener = document\.activeElement/);
  assert.match(modal, /settleFocus\(opener\)/);
  const confirm = src.slice(src.indexOf('export function confirmDialog'), src.indexOf('// ---------------------------------------------------------------- forms'));
  assert.match(confirm, /b\.textContent = b\.dataset\.ownLabel/);
  assert.match(confirm, /= 'Saving…'/);
  assert.match(src, /'Please fill in the highlighted fields\.' : 'Please check the highlighted fields\.'/);
  const form = src.slice(src.indexOf('export function makeForm'), src.indexOf('export function formModal'));
  assert.ok(form.indexOf('must be between 2000 and 2100.') < form.indexOf('await onSubmit'));
  assert.match(src, /closest\?\.\('details'\)[\s\S]{0,80}\.open = true/);
  assert.match(src, /old\.textContent === String\(message\)\) old\.remove\(\)/);
  assert.match(src, /clearSuccessToasts\(\);\s*\n\s*if \(err instanceof ApiError\)/);
  assert.match(src, /class: 'file-thumb'/);
  assert.match(src, /startsWith\('image\/'\)/);
  assert.match(src, /document\.addEventListener\('click'/);
});
