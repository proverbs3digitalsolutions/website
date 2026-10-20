'use strict';

// QA round 27, OPS-2: the saved-close line names the day first, so a close made on a later day
// ("Oct 17 was closed on Oct 20, 7:51 PM by ...") does not read as if Oct 20 were the page's day.
// Frontend-only source scan: no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/dailyclose.js'), 'utf8');

test('the closed banner names the day before the save time', () => {
  assert.ok(src.includes('`${fmtDate(date)} was closed on ${fmtDateTime(closed.closed_at)} by ${closed.closed_by_name || \'a team member\'}${closed.note ? `: ${closed.note}` : \'\'}`'), 'banner reads "{day} was closed on {saved time} by {name}"');
  assert.ok(!/`Closed \$\{fmtDateTime\(closed\.closed_at\)\}/.test(src), 'the old "Closed {saved time}" line is gone');
});

test('the Reopen question keeps its wording', () => {
  assert.ok(src.includes('`Reopen ${fmtDate(date)}?`'));
});
