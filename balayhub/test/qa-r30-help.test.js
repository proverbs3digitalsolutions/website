'use strict';
require('./helpers');

// QA round 30, HELP (INB-1 part 2, a4). Contact support uses the shared first-bytes helper from api.js in its async
// check; a ticket reply's file refusals show on the Attach a file box. Frontend-only: source scans plus a temp copy.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/views/help.js'), 'utf8');
const BAD = "This file isn't a real PDF, JPG, PNG or WEBP. Choose the file again.";

test('help.js uses the shared helper and no longer owns the byte table', () => {
  assert.doesNotMatch(SRC, /SIGNATURES/);
  assert.doesNotMatch(SRC, /screenshotContentError/);
  assert.match(SRC, /import \{[^}]*\bfileContentError\b[^}]*\} from '\.\.\/api\.js'/);
});

test('Contact support: async check awaits fileContentError after screenshotError; onSubmit has no content check', () => {
  assert.match(SRC, /check: async \(\) => \{[^}]*screenshotError\([^}]*await fileContentError\(/);
  const onSubmit = SRC.slice(SRC.indexOf('onSubmit: async (data)'), SRC.indexOf("post('/support/tickets'"));
  assert.doesNotMatch(onSubmit, /ContentError|ApiError/);
});

test('the check puts the content sentence on the screenshot field (temp copy, stubbed makeForm)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-help30-'));
  const w = (n, s) => { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), s); };
  w('package.json', '{"type":"module"}');
  w('api.js', `export const get = async () => ({}), post = async () => ({}), qs = () => "", uploadFile = async () => ({}), fileContentError = async (f) => (f && f.bad ? ${JSON.stringify(BAD)} : null);`);
  w('ui.js', `export const ${['h', 'icon', 'fmtDateTime', 'badge', 'field', 'emptyState', 'searchBox', 'pageHead', 'toast', 'confirmDialog', 'filesList', 'label'].map((n) => `${n} = (t, p, ...c) => ({ t, p, c })`).join(', ')}; export const makeForm = (o) => { globalThis.__opts = o; return null; };`);
  w('app.js', 'export const state = { user: { business_type: "stays" } }, navigate = () => {};');
  w('themeswitch.js', 'export const currentTheme = () => "light";');
  w('assistant.js', 'export const assistantEnabled = () => false, openAssistant = () => {};');
  w('filters.js', 'export const initFilters = () => {}, filterBar = () => null, rememberFilters = () => {}, changed = () => false;');
  w('views/help.js', SRC);
  const help = await import(pathToFileURL(path.join(dir, 'views/help.js')));
  assert.equal(typeof help.screenshotError, 'function');
  assert.equal(help.screenshotContentError, undefined);
});

test('ticket reply: file refusals show on the Attach a file box, focus it, keep the reply, skip the toast', () => {
  assert.match(SRC, /id: 'reply-attach-err'/);
  assert.match(SRC, /'aria-describedby': 'reply-attach-err'/);
  const send = SRC.slice(SRC.indexOf('const send = async'), SRC.indexOf('let rating = 0'));
  const up = send.indexOf("uploadFile('support'");
  const catchAt = send.indexOf('catch (err)', up);
  const post = send.indexOf('/reply`');
  assert.ok(up > 0 && catchAt > up && catchAt < post, 'upload has its own catch before the reply post');
  const c = send.slice(catchAt, post);
  for (const code of ['EMPTY_FILE', 'BAD_FILE_CONTENT', 'UNSUPPORTED_FILE']) assert.ok(c.includes(code), code);
  assert.match(c, /413/);
  assert.match(c, /aria-invalid/);
  assert.match(c, /attach\.focus\(\)/);
  assert.ok(c.indexOf('return') < (c.indexOf('toast') < 0 ? Infinity : c.indexOf('toast')));
  // clearing on edit also clears the attach box
  assert.match(SRC, /const clearReplyError = \(\) => \{[^}]*attachError\.textContent = ''/);
  assert.match(SRC, /'Write a reply first\.'/);
});
