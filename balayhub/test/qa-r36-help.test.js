'use strict';
require('./helpers');

// Round 36 HELP (D-118): the ticket reply button is "Reply and reopen" on a solved ticket and "Send reply" once it reopens,
// so it carries one fixed key and the focus guard can hand focus to its replacement. Frontend only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');

const JS = path.join(__dirname, '../public/js');
const src = fs.readFileSync(path.join(JS, 'views/help.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r36help-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

test('source: the reply button carries the fixed key ticket-reply', () => {
  const line = src.split('\n').find((l) => l.includes("'Reply and reopen'"));
  assert.ok(line, 'reply button found');
  assert.match(line, /h\('button', \{ class: 'btn btn--primary', 'data-focus-key': 'ticket-reply', onclick: send \}/);
});

const redraw = (key) => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const old = btn(w, w.main, 'Reply and reopen', { 'data-focus-key': 'ticket-reply' }); old.focus(); g.note(old);
  w.remove(old);
  const fresh = btn(w, w.main, 'Send reply', key ? { 'data-focus-key': 'ticket-reply' } : {});
  g.check(100);
  return { w, fresh };
};

test('stand-in DOM: same key, new words -> focus lands on the new button', () => {
  const { w, fresh } = redraw(true);
  assert.equal(w.activeElement, fresh);
});

test('stand-in DOM: no key -> focus falls to the heading', () => {
  const { w } = redraw(false);
  assert.equal(w.activeElement, w.h1);
});
