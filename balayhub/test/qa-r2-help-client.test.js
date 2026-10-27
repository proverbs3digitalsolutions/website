'use strict';

// QA round 2, fix B29 (help-client). Cleaners are not offered the assistant, so
// nothing asks the server about it for them (rbac#4), and a question that fails
// stays in the chat with an inline note instead of vanishing (settings#8).
// Frontend-only: no database. assistant.js is loaded from a temp copy with stub
// api.js, ui.js and app.js modules. The chat panel needs a DOM, so its checks
// are source scans.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ASSISTANT_SRC = fs.readFileSync(path.join(__dirname, '../public/js/assistant.js'), 'utf8');

let assistant; let api; let app;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-help-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'api.js'),
    'export const calls = [];\nexport async function get(p) { calls.push(["GET", p]); return { enabled: true }; }\nexport async function post(p) { calls.push(["POST", p]); return {}; }\n');
  fs.writeFileSync(path.join(dir, 'ui.js'), 'export const h = () => null;\nexport const icon = () => null;\nexport const toast = () => null;\nexport const guardPress = () => {};\n');
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: null };\nexport const navigate = () => {};\n');
  fs.writeFileSync(path.join(dir, 'assistant.js'), ASSISTANT_SRC);
  api = await import(pathToFileURL(path.join(dir, 'api.js')));
  app = await import(pathToFileURL(path.join(dir, 'app.js')));
  assistant = await import(pathToFileURL(path.join(dir, 'assistant.js')));
});

test('cleaners are not offered the assistant and the server is never asked', async () => {
  app.state.user = { role: 'cleaner', business_type: 'short_term', full_name: 'Cleo Cruz' };
  assistant.resetAssistant();
  api.calls.length = 0;
  assert.equal(await assistant.assistantEnabled(), false);
  assert.deepEqual(api.calls, []);
});

test('owners, managers and staff are still asked whether the assistant is on', async () => {
  for (const role of ['owner', 'manager', 'staff']) {
    app.state.user = { role, business_type: 'short_term', full_name: 'Ana Reyes' };
    assistant.resetAssistant();
    api.calls.length = 0;
    assert.equal(await assistant.assistantEnabled(), true, role);
    assert.deepEqual(api.calls, [['GET', '/assistant']], role);
  }
});

test('a failed question stays in the chat with an inline note and no timed toast', () => {
  assert.doesNotMatch(ASSISTANT_SRC, /msgs\.pop\(\)/);
  assert.doesNotMatch(ASSISTANT_SRC, /toast\(err\.message/);
  assert.match(ASSISTANT_SRC, /failed = true/);
  assert.match(ASSISTANT_SRC, /Couldn't answer\. /);
  assert.match(ASSISTANT_SRC, /'Try again'/);
  assert.match(ASSISTANT_SRC, /contact support/);
  assert.match(ASSISTANT_SRC, /role: 'alert'/);
});

test('a failed question is left out of the history sent with the next question', () => {
  assert.match(ASSISTANT_SRC, /msgs\.filter\(\(m\) => !m\.failed\)/);
});
