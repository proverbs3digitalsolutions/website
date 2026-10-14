'use strict';

// QA round 10, C05: the guest language switch keeps what was typed (keepFormValues / restoreFormValues in
// i18n.js, used by check-in, review and pay), and the pay page draws refund lines with two-decimal money.
// Frontend-only: no database. i18n.js is loaded from a temp copy with minimal DOM stubs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const js = (f) => fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8');

let i18n; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c05-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'i18n.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.document = { documentElement: { lang: '' } };
  i18n = await import(pathToFileURL(path.join(dir, 'i18n.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); delete globalThis.document; delete globalThis.Element; });

// A fake control and root, just enough for querySelectorAll and dispatchEvent.
const ctl = (name, type, value = '', extra = {}) => {
  const c = { name, type, value, checked: false, dataset: {}, events: 0, dispatchEvent() { this.events += 1; return true; }, ...extra };
  return c;
};
const rootOf = (list) => ({ querySelectorAll: () => list });

test('values come back by name and order, one input event per changed control', () => {
  const make = () => [ctl('lead_name', 'text'), ctl('guest', 'text'), ctl('guest', 'text'), ctl('guest', 'text'),
    ctl('notes', 'textarea'), ctl('consent', 'checkbox'), ctl('id', 'file')];
  const before = make();
  before[0].value = 'Ana'; before[1].value = 'B'; before[2].value = ''; before[3].value = 'D'; before[4].value = 'late'; before[5].checked = true;
  const snap = i18n.keepFormValues(rootOf(before));
  assert.deepEqual(snap.guest, ['B', '', 'D']);
  assert.equal(snap.id, undefined, 'file inputs are skipped');
  assert.deepEqual(snap.consent, [true]);
  const after = make();
  i18n.restoreFormValues(rootOf(after), snap);
  assert.deepEqual(after.map((c) => c.value), ['Ana', 'B', '', 'D', 'late', '', '']);
  assert.equal(after[5].checked, true);
  // blank guest 2 already equals the new blank value: only the 4 changed text controls and the checkbox fire.
  assert.deepEqual(after.map((c) => c.events), [1, 1, 0, 1, 1, 1, 0]);
});

test('hidden inputs are kept only with data-keep, passwords never', () => {
  const list = [ctl('rating', 'hidden', '4', { dataset: { keep: '' } }), ctl('token', 'hidden', 'x'), ctl('pw', 'password', 'secret')];
  assert.deepEqual(i18n.keepFormValues(rootOf(list)), { rating: ['4'] });
});

test('restore with no snapshot does nothing', () => {
  const c = ctl('a', 'text', 'keep');
  i18n.restoreFormValues(rootOf([c]), undefined);
  assert.equal(c.value, 'keep');
});

test('check-in, review and pay snapshot in the toggle callback and restore after the redraw', () => {
  for (const f of ['views/checkin.js', 'views/review.js', 'views/pay.js']) {
    const src = js(f);
    assert.match(src, /langToggle\(\(\) => \w+\(el, \{ params(, query: \{\})? \}, [^)]*keepFormValues\(el\)/, `${f} snapshots on the switch`);
    assert.match(src, /restoreFormValues\(/, `${f} restores`);
  }
});

test('review keeps the stars in data-keep hidden inputs and sets them back with set(n)', () => {
  const src = js('views/review.js');
  assert.match(src, /type: 'hidden', name, value: '', dataset: \{ keep: '' \}/);
  assert.match(src, /overall\.set\(Number\(overall\.store\.value\)/);
});

test('check-in makes the added guest rows from the snapshot before restoring', () => {
  const src = js('views/checkin.js');
  assert.ok(src.indexOf('kept?.snap?.guest?.length') > 0 && src.indexOf('kept?.snap?.guest?.length') < src.indexOf('restoreFormValues(el, kept?.snap)'));
  assert.match(src, /Choose the photos again after changing the language\./);
});

test('pay: add-on choices are named so they are kept, refunds are drawn, and every peso has two decimals', () => {
  const src = js('views/pay.js');
  assert.match(src, /name: `addon-qty-/);
  assert.match(src, /name: `addon-pick-/);
  assert.match(src, /t\('Refunded to you, added back to the balance'\)/);
  assert.match(src, /`\+\$\{peso\(r\.amount\)\}`/);
  assert.match(src, /'Refunded to you, added back to the balance': 'Ibinalik sa iyo, idinagdag ulit sa babayaran'/);
  assert.match(src, /const peso = .*minimumFractionDigits: 2, maximumFractionDigits: 2/);
  assert.doesNotMatch(src, /Number\.isInteger\(n\) \? 0 : 2/);
});
