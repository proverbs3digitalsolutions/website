'use strict';

// QA round 15, lane O1 (maintenance.js, housekeeping.js; frontend only, no database).
// #37: in a maintenance list row the "From cleaning task" badge is a plain span, not a link inside the row link.
// K7: Resolved / Cancelled tabs with nothing else filtered say "No resolved requests." / "No cancelled requests." with no Clear filters.
// K10: the calendar reassign select name includes the day.
// #47: the job sheet loads supplies from the job-only route, for every role.
// node --test --test-concurrency=1 test/qa-r15-o1.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', f), 'utf8');
const maint = read('maintenance.js');
const hk = read('housekeeping.js');

test('the row badge is a span; only the request page keeps the task link (#37)', () => {
  const badge = maint.slice(maint.indexOf('const taskBadge'), maint.indexOf('export async function newMaintenanceModal'));
  assert.match(badge, /inRow\s*\? h\('span', \{ class: 'badge badge--ops'/);
  assert.doesNotMatch(badge, /stopPropagation|navigate\(/);
  assert.match(badge, /h\('a', \{\s*class: 'badge badge--ops link-tap', href: `#\/housekeeping\//);
});

test('an empty Resolved or Cancelled tab names itself, with no Clear filters (K7)', () => {
  assert.match(maint, /!isFiltered\(\) && \['resolved', 'cancelled'\]\.includes\(filters\.status\)/);
  assert.match(maint, /title: `No \$\{filters\.status\} requests\.`/);
  // The filtered and other-tab cases keep "No results found".
  assert.match(maint, /title: 'No results found'/);
});

test('the calendar reassign select name includes the day (K10)', () => {
  assert.match(hk, /'aria-label': `Assign \$\{x\.unit_name\}, \$\{fmtDate\(date\)\}`/);
  assert.match(hk, /reassignSelect\(x, date\)/);
});

test('the job sheet supplies picker loads the job-only route (#47)', () => {
  const modal = hk.slice(hk.indexOf('async function suppliesModal'), hk.indexOf('async function suppliesModal') + 400);
  assert.match(modal, /get\(`\/cleaning-tasks\/\$\{task\.task_id\}\/supplies`\)/);
  assert.doesNotMatch(modal, /get\(`\/supplies/);
});

test('the standalone link in the job-sheet pay card stays inline, exempt from link-tap (housekeeping.js 714)', () => {
  assert.match(hk, /h\('a', \{ href: '#\/cleaner-pay' \}, 'Cleaner pay'\)/);
});
