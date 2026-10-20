'use strict';

// QA r25 ASSIST-GATE (SEV3): while the card check is due the top bar is Help and account only (D-106, APP-FLOW 5.10), so the Ask the
// BalayHub assistant button must not show at all (phone top bar or desktop floating button), and must come back once the card passes.
// Frontend-only: assistant.js runs from a temp copy with stub api.js, ui.js and app.js modules, as in qa-r3-shell.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/assistant.js'), 'utf8');
let assistant; let app; let gets = 0;

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-assist-gate-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'api.js'), 'export async function get() { globalThis.__assistGets = (globalThis.__assistGets || 0) + 1; return { enabled: true }; }\nexport async function post() { return {}; }\n');
  fs.writeFileSync(path.join(dir, 'ui.js'), 'export const h = () => null;\nexport const icon = () => null;\nexport const toast = () => null;\n');
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: null };\nexport const navigate = () => {};\n');
  fs.writeFileSync(path.join(dir, 'assistant.js'), SRC);
  app = await import(pathToFileURL(path.join(dir, 'app.js')));
  assistant = await import(pathToFileURL(path.join(dir, 'assistant.js')));
  globalThis.matchMedia = () => ({ matches: true });
});
test.after(() => { delete globalThis.document; delete globalThis.matchMedia; delete globalThis.__assistGets; });

const owner = (due) => ({ role: 'owner', plan: { card_check_due: due } });

test('the assistant is off while the card check is due, without asking the server, and back on once the card passes', async () => {
  app.state.user = owner(true);
  assert.equal(await assistant.assistantEnabled(), false);
  assert.equal(globalThis.__assistGets || 0, 0);
  app.state.user = owner(false);
  assert.equal(await assistant.assistantEnabled(), true);
});

test('placing the button while the card check is due keeps it hidden, in the bar and on desktop', () => {
  const slot = { append() {} }; const shell = { append() {} };
  const fab = { hidden: false, classList: { toggle() {} } };
  globalThis.document = { querySelector: (s) => ({ '.assist-fab': fab, '.topbar__assist': slot, '.shell': shell })[s] ?? null };
  app.state.user = owner(true);
  assistant.placeAssistantButton();
  assert.equal(fab.hidden, true);
  globalThis.matchMedia = () => ({ matches: false });
  fab.hidden = false;
  assistant.placeAssistantButton();
  assert.equal(fab.hidden, true);
});

test('placing the button once the card has passed shows it again', async () => {
  const fab = { hidden: true, classList: { toggle() {} } };
  globalThis.document = { querySelector: (s) => (s === '.assist-fab' ? fab : null) };
  app.state.user = owner(false);
  await assistant.assistantEnabled();
  assistant.placeAssistantButton();
  assert.equal(fab.hidden, false);
});
