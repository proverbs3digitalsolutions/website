'use strict';

// QA round 28, HELP (INB-2). An empty (0-byte) screenshot is refused on the New
// support ticket form before the ticket is created.
// Frontend-only: help.js is loaded from a temp copy with stub modules.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/views/help.js'), 'utf8');
let help;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-help28-'));
  const w = (n, s) => fs.writeFileSync(path.join(dir, n), s);
  fs.mkdirSync(path.join(dir, 'views'));
  w('package.json', '{"type":"module"}');
  w('api.js', 'export const get = async () => ({}), post = async () => ({}), qs = () => "", uploadFile = async () => ({}); export class ApiError extends Error {}');
  w('ui.js', `export const ${['h', 'icon', 'fmtDateTime', 'badge', 'field', 'makeForm', 'emptyState', 'searchBox', 'pageHead', 'toast', 'confirmDialog', 'filesList', 'label'].map((n) => `${n} = () => null`).join(', ')};`);
  w('app.js', 'export const state = {}, navigate = () => {};');
  w('themeswitch.js', 'export const currentTheme = () => "light";');
  w('assistant.js', 'export const assistantEnabled = () => false, openAssistant = () => {};');
  w('filters.js', 'export const initFilters = () => {}, filterBar = () => null, rememberFilters = () => {}, changed = () => false;');
  w('views/help.js', SRC.replace(/from '\.\.\/(?=[a-z]+\.js')/g, "from '../"));
  help = await import(pathToFileURL(path.join(dir, 'views/help.js')));
});

const EMPTY = 'This file is empty. Choose the file again.';

test('an empty screenshot gets the empty-file sentence; real ones and wrong types are unchanged', () => {
  assert.equal(help.screenshotError({ type: 'image/png', size: 0 }), EMPTY);
  assert.equal(help.screenshotError({ type: 'image/png', size: 1000 }), null);
  assert.equal(help.screenshotError({ type: 'text/plain', size: 1000 }), 'Upload a PDF, JPG, PNG or WEBP file up to 10 MB.');
  assert.equal(help.screenshotError(undefined), null);
});

test('the form check uses screenshotError and runs before the ticket is posted', () => {
  assert.match(SRC, /check: \(\) => \(screenshotError\(/);
  assert.ok(SRC.indexOf('check: () =>') < SRC.indexOf("post('/support/tickets'"));
});
