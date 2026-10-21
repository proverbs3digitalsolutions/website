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
let api;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-help29-'));
  const w = (n, s) => fs.writeFileSync(path.join(dir, n), s);
  fs.mkdirSync(path.join(dir, 'views'));
  w('package.json', '{"type":"module"}');
  fs.copyFileSync(path.join(__dirname, '../public/js/api.js'), path.join(dir, 'api.js'));
  w('ui.js', `export const ${['h', 'icon', 'fmtDateTime', 'badge', 'field', 'makeForm', 'emptyState', 'searchBox', 'pageHead', 'toast', 'confirmDialog', 'filesList', 'label'].map((n) => `${n} = () => null`).join(', ')};`);
  w('app.js', 'export const state = {}, navigate = () => {};');
  w('themeswitch.js', 'export const currentTheme = () => "light";');
  w('assistant.js', 'export const assistantEnabled = () => false, openAssistant = () => {};');
  w('filters.js', 'export const initFilters = () => {}, filterBar = () => null, rememberFilters = () => {}, changed = () => false;');
  w('views/help.js', SRC);
  api = await import(pathToFileURL(path.join(dir, 'api.js')));
  help = await import(pathToFileURL(path.join(dir, 'views/help.js')));
});

const BAD = "This file isn't a real PDF, JPG, PNG or WEBP. Choose the file again.";
const f = (bytes, type) => new File([Buffer.from(bytes)], 'x', { type });
// Complete images, not only their first bytes: the device checks the whole file as the server does (D-119, QA r37 PINS).
const ascii = (s) => [...Buffer.from(s, 'latin1')];
const PNG_OK = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii('IHDR'), ...Array(17).fill(0), 0, 0, 0, 10, ...ascii('IDAT'), ...Array(14).fill(0), 0, 0, 0, 0, ...ascii('IEND'), 0, 0, 0, 0];
const JPEG_OK = [0xff, 0xd8, 0xff, 0xe0, ...Array(60).fill(0), 0xff, 0xd9];
const WEBP_OK = [...ascii('RIFF'), 60, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8L'), ...Array(52).fill(0)];

test('real signatures pass', async () => {
  assert.equal(await api.fileContentError(f(PNG_OK, 'image/png')), null);
  assert.equal(await api.fileContentError(f(JPEG_OK, 'image/jpeg')), null);
  assert.equal(await api.fileContentError(f(Buffer.from('%PDF-1.4'), 'application/pdf')), null);
  assert.equal(await api.fileContentError(f(WEBP_OK, 'image/webp')), null);
});

test('a renamed text file gets the sentence', async () => {
  assert.equal(await api.fileContentError(f(Buffer.from('hello'), 'image/png')), BAD);
  assert.equal(await api.fileContentError(f(Buffer.from('hello world!!'), 'image/webp')), BAD);
});

test('no file, an empty file and an unknown type are left to screenshotError', async () => {
  assert.equal(await api.fileContentError(undefined), null);
  assert.equal(await api.fileContentError(f([], 'image/png')), null);
  assert.equal(await api.fileContentError(f(Buffer.from('hi'), 'text/plain')), null);
});

test('the New ticket check awaits the content check before the ticket is posted, and names the screenshot field', () => {
  const body = SRC.slice(SRC.indexOf('check: async () =>'));
  const at = body.indexOf('await fileContentError(');
  assert.ok(at > -1 && at < body.indexOf("post('/support/tickets'"));
  assert.match(SRC, /return p \? \{ screenshot: p \} : null;/);
});
