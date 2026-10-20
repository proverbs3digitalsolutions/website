'use strict';

// QA r29 FOCUSGUARD (D-111): a file chosen without focusing its input (dropped on it) is remembered like a pressed control, so the
// redraw after the upload puts focus back on the input, never on the page body. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world } = require('./focus-world');

const JS = process.env.U1_JS_DIR || path.join(__dirname, '../public/js');
const uiSrc = fs.readFileSync(path.join(JS, 'ui.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r29fg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});
const guard = (w) => ui.installFocusGuard(w, { observe: false });
const fileInput = (w) => w.main.add(w.make('input', { type: 'file', 'aria-label': 'Add damage photo' }));

function redraw(w) {
  const h1 = w.main.children.find((c) => c.tagName === 'H1');
  const old = w.main.children.find((c) => c.tagName === 'INPUT');
  w.remove(h1); w.remove(old);
  w.main.add(w.make('h1', { tabindex: '-1' }, 'Security deposit'));
  return fileInput(w);
}

test('(1) heading focused, file noted by its change, page redrawn: focus returns to the new file input', () => {
  const w = world();
  const g = guard(w);
  w.h1.attrs.tabindex = '-1'; w.h1.focus();
  const input = fileInput(w);
  g.note(input); // what the change listener does
  const fresh = redraw(w);
  g.check();
  assert.equal(w.activeElement, fresh);
});

test('(2) nothing noted: focus stays on the body (why the listener is needed)', () => {
  const w = world();
  const g = guard(w);
  w.h1.attrs.tabindex = '-1'; w.h1.focus();
  fileInput(w);
  redraw(w);
  g.check();
  assert.equal(w.activeElement, w.body);
});

test('(3) source: change listener sits in if (observe), capture phase, file inputs only; focusin and pointerdown unchanged', () => {
  const obs = uiSrc.slice(uiSrc.indexOf('if (observe) {'));
  const at = obs.indexOf("addEventListener('change'");
  assert.ok(at > obs.indexOf("addEventListener('focusin'"), 'change listener follows focusin, inside the observe block');
  const body = obs.slice(at, obs.indexOf('const keeper'));
  assert.match(body, /tagName === 'INPUT'/);
  assert.match(body, /toLowerCase\(\) === 'file'/);
  assert.match(body, /note\(t\)/);
  assert.match(body, /, true\);/);
  assert.ok(obs.includes("doc.addEventListener('focusin', (e) => { if (e.target instanceof Element) note(e.target); }, true);"));
  assert.ok(obs.includes("doc.addEventListener('pointerdown', (e) => {"));
});
