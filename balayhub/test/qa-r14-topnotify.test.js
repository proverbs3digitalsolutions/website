'use strict';

// Top bar notifications panel and bell (D-90, lane F4). Frontend-only: no database, fetch is stubbed.
// topnotify.js is loaded from a temp copy next to ui.js and api.js, as an ES module.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '../public/js/topnotify.js');
let tn;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-topnotify-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'topnotify.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  globalThis.Element = class { };
  tn = await import(pathToFileURL(path.join(dir, 'topnotify.js')));
});

test('bellLabel', () => {
  assert.equal(tn.bellLabel(0), 'Notifications');
  assert.equal(tn.bellLabel(3), 'Notifications, 3 unread');
});

test('badgeText', () => {
  assert.equal(tn.badgeText(0), '');
  assert.equal(tn.badgeText(7), '7');
  assert.equal(tn.badgeText(99), '99');
  assert.equal(tn.badgeText(120), '99+');
});

test('relTime in Manila time', () => {
  const now = Date.parse('2026-10-15T08:00:00+08:00');
  assert.equal(tn.relTime('2026-10-15T07:59:30+08:00', now), 'Just now');
  assert.equal(tn.relTime('2026-10-15T07:55:00+08:00', now), '5 min ago');
  assert.equal(tn.relTime('2026-10-15T05:00:00+08:00', now), '3 h ago');
  assert.equal(tn.relTime('2026-10-14T02:00:00+08:00', now), 'Yesterday');
  assert.equal(tn.relTime('2026-10-12T10:00:00+08:00', now), '12 Oct');
  assert.equal(tn.relTime('2025-10-12T10:00:00+08:00', now), '12 Oct 2025');
  // 16:30 UTC on the 14th is 00:30 on the 15th in Manila; the 16th is 09:00 there
  assert.equal(tn.relTime('2026-10-14T16:30:00Z', Date.parse('2026-10-16T01:00:00Z')), 'Yesterday');
});

test('safeUrl', () => {
  assert.equal(tn.safeUrl('javascript:x'), '/#/home');
  assert.equal(tn.safeUrl('//evil.example/#/x'), '/#/home');
  assert.equal(tn.safeUrl(undefined), '/#/home');
  assert.equal(tn.safeUrl('/#/reservations?view=recent'), '/#/reservations?view=recent');
});

test('TAB_LABELS matches exactly', () => {
  assert.deepEqual(tn.TAB_LABELS, { all: 'All', reservations: 'Reservations', payments: 'Payments', cleaning: 'Cleaning', messages: 'Messages', owners: 'Owners' });
});

test('source: tabs, mark-all key, in-place list updates, panel built once', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  assert.match(src, /role:\s*'tablist'/);
  assert.match(src, /role:\s*'tab'/);
  assert.match(src, /'data-focus-key':\s*'tb-mark-all'/);
  assert.match(src, /'data-focus-key':\s*'tb-older'/);
  const reload = src.match(/const load = async[\s\S]*?\n {2}\};\n/);
  assert.ok(reload, 'load function found');
  assert.match(reload[0], /list\.replaceChildren|list\.append/);
  assert.doesNotMatch(reload[0], /panel\.replaceChildren/);
  assert.doesNotMatch(reload[0], /role:\s*'tablist'/);
  assert.doesNotMatch(reload[0], /h\('h2'/);
  assert.doesNotMatch(src, /window\.scroll|scrollY|pageYOffset/);
});

// R14 SEV2: a focused control must never be hidden (focus fell to BODY after Enter on "Mark all as read").
test('source: no control hides itself while focused', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  assert.doesNotMatch(src, /markAll\.hidden\s*=\s*!(data|r)\./, 'markAll goes through setMarkAll');
  assert.match(src, /document\.activeElement === older[\s\S]*?older\.hidden = !nextBefore/, 'focus leaves older before it hides');
  assert.match(src, /setMarkAll/);
  assert.match(src, /aria-disabled/);
  assert.match(src, /All caught up/);
  assert.match(src, /document\.activeElement/);
});
