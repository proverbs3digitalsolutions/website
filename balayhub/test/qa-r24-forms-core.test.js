'use strict';

// QA r24 FORMS-CORE: date min/max in the device pass, dialogs skip disabled fields, a reason box is marked. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r24fc-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

const ctl = (sel, name, value, o = {}) => ({
  sel, name, value, disabled: !!o.disabled, min: o.min ?? '', max: o.max ?? '',
  closest: () => (o.hidden ? {} : null),
  hasAttribute: (a) => a === 'data-positive' && !!o.positive,
  getAttribute: () => null,
});
const formOf = (...els) => ({ querySelectorAll: (s) => els.filter((e) => e.sel === s) });
const label = (el) => ({ received_on: 'Date received', next_due: 'Next due', amount: 'Amount' }[el.name] || el.name);
const D = 'input[type=date]';
const M = '.input-money input';
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('max today and tomorrow gives the future message, together with a money 0 in one pass', () => {
  const today = ui.todayManila();
  const out = ui.typeProblems(formOf(
    ctl(D, 'received_on', addDays(today, 1), { max: today }),
    ctl(M, 'amount', '0', { positive: true })), {}, label);
  assert.deepEqual(out, { received_on: 'Date received cannot be in the future.', amount: 'Amount must be greater than zero.' });
});

test('min today and yesterday says past; other min and max say the date', () => {
  const today = ui.todayManila();
  assert.deepEqual(ui.typeProblems(formOf(ctl(D, 'next_due', addDays(today, -1), { min: today })), {}, label), { next_due: 'Next due cannot be in the past.' });
  assert.deepEqual(ui.typeProblems(formOf(ctl(D, 'next_due', '2026-01-01', { max: '2026-06-30' })), {}, label), {});
  assert.deepEqual(ui.typeProblems(formOf(ctl(D, 'next_due', '2026-07-01', { max: '2026-06-30' })), {}, label), { next_due: 'Next due must be on or before Jun 30, 2026.' });
  assert.deepEqual(ui.typeProblems(formOf(ctl(D, 'next_due', '2026-01-01', { min: '2026-02-01' })), {}, label), { next_due: 'Next due must be on or after Feb 1, 2026.' });
});

test('min and max window message; a date inside passes', () => {
  const w = { min: '2026-01-01', max: '2026-12-31' };
  assert.deepEqual(ui.typeProblems(formOf(ctl(D, 'next_due', '2040-01-01', w)), {}, label), { next_due: 'Pick a date between Jan 1, 2026 and Dec 31, 2026.' });
  assert.deepEqual(ui.typeProblems(formOf(ctl(D, 'next_due', '2025-12-31', w)), {}, label), { next_due: 'Pick a date between Jan 1, 2026 and Dec 31, 2026.' });
  assert.deepEqual(ui.typeProblems(formOf(ctl(D, 'next_due', '2026-06-01', w)), {}, label), {});
});

test('hidden, disabled, empty, out-of-2000-2100 and already-flagged dates are skipped', () => {
  const today = ui.todayManila(); const bad = addDays(today, 5);
  assert.deepEqual(ui.typeProblems(formOf(
    ctl(D, 'a', bad, { max: today, hidden: true }), ctl(D, 'b', bad, { max: today, disabled: true }),
    ctl(D, 'c', '', { max: today }), ctl(D, 'd', '3000-01-01', { max: today }), ctl(D, 'e', bad, { max: today })), { e: 'Required.' }, label), {});
});

test('a view check message on the same field wins (mergeChecks never replaces)', () => {
  const today = ui.todayManila();
  const typed = ui.typeProblems(formOf(ctl(D, 'received_on', addDays(today, 1), { max: today })), {}, label);
  const merged = ui.mergeChecks({ received_on: 'View says.' }, typed);
  assert.equal(merged.received_on, 'View says.');
});

test('openModal picks the first field that is not disabled (source pin; the dialog needs a real DOM)', () => {
  const src = fs.readFileSync(path.join(JS, 'ui.js'), 'utf8');
  assert.match(src, /input:not\(\[type=hidden\]\):not\(:disabled\), select:not\(:disabled\), textarea:not\(:disabled\)/);
  assert.doesNotMatch(src, /dlg\.querySelector\('input:not\(\[type=hidden\]\), select, textarea'\)/);
});

test('confirmDialog source: empty reason marks the box and typing clears it', () => {
  const src = fs.readFileSync(path.join(JS, 'ui.js'), 'utf8');
  assert.match(src, /Please enter a reason\.'; reasonInput\.setAttribute\('aria-invalid', 'true'\)/);
  assert.match(src, /reasonInput\?\.addEventListener\('input', \(\) => \{ err\.textContent = ''; reasonInput\.removeAttribute\('aria-invalid'\); refusal\.replaceChildren\(\); \}\)/);
});
