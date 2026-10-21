'use strict';
require('./helpers');

// Round 36 MAINT (D-118): maintenance buttons whose words change carry a fixed focus key, so the focus guard finds the replacement.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');

const JS = path.join(__dirname, '../public/js');
const src = fs.readFileSync(path.join(JS, 'views/maintenance.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r36maint-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

test('source: every status button shares the mt-status key; recurring Edit has its own', () => {
  assert.ok(src.includes("'data-focus-key': 'mt-status',"));
  assert.ok(!src.includes('mt-status-${s}'));
  const edit = src.split('\n').find((l) => l.includes("'aria-label': `Edit ${x.title}`"));
  assert.ok(edit.includes("'data-focus-key': `mt-sched-edit-${x.schedule_id}`"));
  assert.ok(src.includes('`mt-pause-${x.schedule_id}`'));
});

// The first button after pressing any status button exists in every state, so the shared key always has a target.
test('nextStatuses: the pressed button is replaced by at least one status button', async () => {
  const m = fs.readFileSync(path.join(JS, 'views/maintenance.js'), 'utf8');
  const STATUSES = ['open', 'in_progress', 'resolved', 'cancelled'];
  const next = (status) => ({ resolved: ['open'], cancelled: ['open'] })[status] || STATUSES.filter((s) => s !== status);
  assert.ok(m.includes("({ resolved: ['open'], cancelled: ['open'] })[status]"));
  for (const from of STATUSES) for (const s of next(from)) assert.ok(next(s).length >= 1, `${from} -> ${s}`);
});

function redraw(newKey, newLabel) {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const a = btn(w, w.main, 'Start work', { 'data-focus-key': 'mt-status' });
  const b = btn(w, w.main, 'Mark resolved', { 'data-focus-key': 'mt-status' });
  btn(w, w.main, 'Cancel request', { 'data-focus-key': 'mt-status' });
  b.focus(); g.note(b);
  [a, b, ...w.main.children.filter((x) => x.tagName === 'BUTTON' && x !== a && x !== b)].forEach((x) => w.remove(x));
  const r = btn(w, w.main, newLabel, newKey ? { 'data-focus-key': newKey } : {});
  g.check(100);
  return { w, r };
}

test('stand-in DOM: with the shared key focus lands on Reopen', () => {
  const { w, r } = redraw('mt-status', 'Reopen');
  assert.equal(w.activeElement, r);
});

test('stand-in DOM: without the key focus falls to the heading', () => {
  const { w } = redraw(null, 'Reopen');
  assert.equal(w.activeElement, w.h1);
});
