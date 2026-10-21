'use strict';
require('./helpers');

// Round 36 GATEPASS (D-118): Send now becomes Send again after a send, so the button carries one fixed focus key. Frontend only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');

const JS = path.join(__dirname, '../public/js');
const src = fs.readFileSync(path.join(JS, 'views/gatepass.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r36gp-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

test('source: the Send now / Send again button carries gp-send', () => {
  const line = src.split('\n').find((l) => l.includes("'Send again' : 'Send now'"));
  assert.ok(line, 'send button found');
  assert.match(line, /'data-focus-key': 'gp-send'/);
});

const redraw = (keyed) => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const old = btn(w, w.main, 'Send now', { 'data-focus-key': 'gp-send' });
  old.focus(); g.note(old);
  w.remove(old);
  const fresh = btn(w, w.main, 'Send again', keyed ? { 'data-focus-key': 'gp-send' } : {});
  g.check(100);
  return { w, fresh };
};

test('same key, new words: focus lands on the replacement', () => {
  const { w, fresh } = redraw(true);
  assert.equal(w.activeElement, fresh);
});

test('no key on the replacement: focus falls to the h1 (the key carries it)', () => {
  const { w } = redraw(false);
  assert.equal(w.activeElement, w.h1);
});
