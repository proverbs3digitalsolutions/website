'use strict';
require('./helpers');

// Round 36 RESV (D-118): the payment row's Email button becomes Email again after the receipt is sent, so it carries a fixed focus key
// and the focus guard puts focus on the redrawn button, not the page heading. Frontend only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');

const JS = path.join(__dirname, '../public/js');
const src = fs.readFileSync(path.join(JS, 'views/reservations.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r36resv-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

// (a) source: the exact key is in the props of the Email / Email again button.
test('source: the Email button carries pay-email-${p.payment_id}', () => {
  const line = src.split('\n').find((l) => l.includes("p.receipt_sent_at ? 'Email again' : 'Email')") && l.includes("h('button'"));
  assert.ok(line, 'Email button line found');
  assert.ok(line.includes("'data-focus-key': `pay-email-${p.payment_id}`"));
});

// (b) stand-in DOM: the same key on a button with a new name keeps focus; without the key focus falls to the h1.
const redraw = (key) => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const old = btn(w, w.main, 'Email', { 'data-focus-key': 'pay-email-7' });
  old.focus(); g.note(old);
  w.remove(old);
  const next = btn(w, w.main, 'Email again', key ? { 'data-focus-key': 'pay-email-7' } : {});
  g.check(100);
  return { w, next };
};
test('same key, new name: focus ends on the redrawn button', () => {
  const { w, next } = redraw(true);
  assert.equal(w.activeElement, next);
});
test('key removed: focus falls to the h1', () => {
  const { w } = redraw(false);
  assert.equal(w.activeElement, w.h1);
});
