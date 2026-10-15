'use strict';

// QA r13 F01: the focus scan. There is ONE mechanism for focus after a redraw (the focus guard in ui.js, D-89). This test fails when
//  (i) any other file under public/js manages redraw focus the old way,
//  (ii) a control that changes its label when used lacks its data-focus-key (the table is the contract between F01 and the view lanes),
//  (iii) a view puts focus back by hand right after rerender() or load().
// Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '../public/js');
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []));
const all = files(JS);
const rel = (f) => path.relative(JS, f).split(path.sep).join('/');

test('(i) no file other than ui.js keeps the old redraw-focus watchers', () => {
  const banned = /keepFocus\(|snapshotControl\(|findReplacement\(|sameControl\(|FOCUS_CHECKS|restoreTabFocus\(/;
  for (const f of all) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), banned, `${rel(f)} still has an old focus watcher`);
});

// file, exact attribute text, at least how many
const KEYS = [
  ['views/reservations.js', "'data-focus-key': 'stay-status'", 4],
  ['views/deposits.js', "'data-focus-key': 'deposit-action'", 3],
  ['views/calendar.js', "'data-focus-key': `cal-night-${", 1],
  ['views/calendar.js', "'data-focus-key': `cal-booking-${", 1],
  ['views/owners.js', "'data-focus-key': 'stmt-publish'", 2],
  ['views/owners.js', "'data-focus-key': 'stmt-send'", 1],
  ['views/inbox.js', "'data-focus-key': 'conv-snooze'", 2],
  ['views/inbox.js', "'data-focus-key': 'conv-archive'", 2],
  ['views/maintenance.js', "'data-focus-key': 'mt-status'", 1],
  ['views/tenants.js', "'data-focus-key': 'tenant-archive'", 1],
  ['views/housekeeping.js', "'data-focus-key': 'hk-status'", 2],
  ['views/housekeeping.js', "'data-focus-key': 'hk-pay'", 1],
  ['views/cleanerpay.js', "'data-focus-key': `cp-pay-${", 1],
  ['views/dailyclose.js', "'data-focus-key': 'dc-close'", 1],
  ['views/dailyclose.js', "'data-focus-key': 'dc-reopen'", 1],
];

test('(ii) the controls whose label changes carry their data-focus-key', () => {
  const missing = [];
  for (const [file, attr, atLeast] of KEYS) {
    const src = fs.readFileSync(path.join(JS, file), 'utf8');
    const n = src.split(attr).length - 1;
    if (n < atLeast) missing.push(`${file}: ${attr} x${n}, need ${atLeast}`);
  }
  assert.deepEqual(missing, []);
});

test('(iii) no view focuses a control by hand right after rerender() or a load function', () => {
  const bad = [];
  const re = /\b(rerender|load\w*)\(\)\s*;?\s*[^;\n]*\.focus\(/;
  for (const f of all.filter((x) => rel(x).startsWith('views/'))) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (re.test(line)) bad.push(`${rel(f)}:${i + 1}: ${line.trim()}`); });
  }
  assert.deepEqual(bad, []);
});
