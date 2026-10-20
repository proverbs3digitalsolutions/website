'use strict';

// QA round 29, HELP (INB-1). A screenshot whose first bytes don't match its type is refused on the
// New support ticket form before the ticket is created.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-help29-'));
  const w = (n, s) => fs.writeFileSync(path.join(dir, n), s);
  fs.mkdirSync(path.join(dir, 'views'));
  w('package.json', '{"type":"module"}');
  w('api.js', 'export const get = async () => ({}), post = async () => ({}), qs = () => "", uploadFile = async () => ({}); export class ApiError extends Error { constructor(m, o = {}) { super(m); Object.assign(this, o); } }');
  w('ui.js', `export const ${['h', 'icon', 'fmtDateTime', 'badge', 'field', 'makeForm', 'emptyState', 'searchBox', 'pageHead', 'toast', 'confirmDialog', 'filesList', 'label'].map((n) => `${n} = () => null`).join(', ')};`);
  w('app.js', 'export const state = {}, navigate = () => {};');
  w('themeswitch.js', 'export const currentTheme = () => "light";');
  w('assistant.js', 'export const assistantEnabled = () => false, openAssistant = () => {};');
  w('filters.js', 'export const initFilters = () => {}, filterBar = () => null, rememberFilters = () => {}, changed = () => false;');
  w('views/help.js', SRC);
  help = await import(pathToFileURL(path.join(dir, 'views/help.js')));
});

const BAD = "This file isn't a real PDF, JPG, PNG or WEBP. Choose the file again.";
const f = (bytes, type) => new File([Buffer.from(bytes)], 'x', { type });

test('real signatures pass', async () => {
  assert.equal(await help.screenshotContentError(f([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png')), null);
  assert.equal(await help.screenshotContentError(f([0xff, 0xd8, 0xff, 0xe0], 'image/jpeg')), null);
  assert.equal(await help.screenshotContentError(f(Buffer.from('%PDF-1.4'), 'application/pdf')), null);
  assert.equal(await help.screenshotContentError(f(Buffer.from('RIFF\0\0\0\0WEBP'), 'image/webp')), null);
});

test('a renamed text file gets the sentence', async () => {
  assert.equal(await help.screenshotContentError(f(Buffer.from('hello'), 'image/png')), BAD);
  assert.equal(await help.screenshotContentError(f(Buffer.from('hello world!!'), 'image/webp')), BAD);
});

test('no file, an empty file and an unknown type are left to screenshotError', async () => {
  assert.equal(await help.screenshotContentError(undefined), null);
  assert.equal(await help.screenshotContentError(f([], 'image/png')), null);
  assert.equal(await help.screenshotContentError(f(Buffer.from('hi'), 'text/plain')), null);
});

test('onSubmit checks the content before posting the ticket, and names the screenshot field', () => {
  const body = SRC.slice(SRC.indexOf('onSubmit: async (data) => {'));
  const at = body.indexOf('await screenshotContentError(');
  assert.ok(at > -1 && at < body.indexOf("post('/support/tickets'"));
  assert.match(body.slice(at, body.indexOf("post('/support/tickets'")), /fields: \{ screenshot: bad \}/);
});
