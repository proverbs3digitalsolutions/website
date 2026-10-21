'use strict';
require('./helpers');

// Round 36 PRICING (D-118): the rule Edit button's name carries the rule summary, which its own Save changes, so it has a fixed key.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');

const JS = path.join(__dirname, '../public/js');
const src = fs.readFileSync(path.join(JS, 'views/pricing.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r36pricing-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

test('source: the rule Edit button has the fixed key rule-edit-<rule_id>', () => {
  const call = src.split("h('button'").find((c) => c.includes('Edit rule: ${ruleSummary(r)}'));
  assert.ok(call, 'found the rule Edit button');
  assert.ok(call.slice(0, call.indexOf("'Edit')")).includes("'data-focus-key': `rule-edit-${r.rule_id}`"));
});

const redraw = (withKey) => {
  const w = world();
  const key = { 'data-focus-key': 'rule-edit-7' };
  const old = btn(w, w.main, 'Edit', { ...key, 'aria-label': 'Edit rule: 10% off, All listings' });
  old.focus();
  const g = ui.installFocusGuard(w, { observe: false });
  g.note(old);
  w.remove(old);
  const nu = btn(w, w.main, 'Edit', { ...(withKey ? key : {}), 'aria-label': 'Edit rule: 15% off, All listings' });
  g.check(100);
  return { w, nu };
};

test('after a save renames the rule, focus lands on the new Edit button', () => {
  const { w, nu } = redraw(true);
  assert.equal(w.activeElement, nu);
});

test('without the key focus falls to the heading', () => {
  const { w } = redraw(false);
  assert.equal(w.activeElement, w.h1);
});
