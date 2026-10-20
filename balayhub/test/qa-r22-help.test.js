'use strict';

// QA round 22, HELP (INB-3). A screenshot of the wrong type or over 10 MB is
// refused on the New support ticket form before the ticket is created.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-help22-'));
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

const MSG = 'Upload a PDF, JPG, PNG or WEBP file up to 10 MB.';
const file = (type, size = 1000) => ({ type, size });

test('screenshotError refuses a wrong type and an oversize file, accepts the allowed ones', () => {
  assert.equal(help.screenshotError(file('text/plain')), MSG);
  assert.equal(help.screenshotError(file('image/png', 10 * 1024 * 1024 + 1)), MSG);
  for (const t of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) assert.equal(help.screenshotError(file(t)), null);
  assert.equal(help.screenshotError(file('image/png', 10 * 1024 * 1024)), null);
  assert.equal(help.screenshotError(undefined), null);
});

test('the New ticket form checks the screenshot before post(), on a field named screenshot', () => {
  assert.match(SRC, /check: \(\) => \(screenshotError\(screenshot\.files\[0\]\) \? \{ screenshot: screenshotError\(screenshot\.files\[0\]\) \} : null\)/);
  assert.match(SRC, /dataset: \{ field: 'screenshot' \}/);
  assert.match(SRC, /name: 'screenshot'/);
  assert.ok(SRC.indexOf('check: () =>') < SRC.indexOf("post('/support/tickets'"));
});
