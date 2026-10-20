// R24 MAINTENANCE (LT-1): Add repair cost amount must be above zero, and the recurring job's next-due window
// is a check hook, so every problem shows on the first Save.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/maintenance.js'), 'utf8');

test('Add repair cost amount is positive', () => {
  const line = src.split('\n').find((l) => l.includes("name: 'amount'")) || '';
  assert.match(line, /type: 'money'/);
  assert.match(line, /positive: true/);
});

test('recurring job: next-due window is a check hook with the window sentence', () => {
  const form = src.slice(src.indexOf("title: x ? 'Edit recurring job'"));
  const hook = form.slice(0, form.indexOf('onSubmit'));
  assert.match(hook, /check: \(d\) =>/);
  assert.match(hook, /nextDueWindow\(\)/);
  assert.match(hook, /next_due: `Pick a date between \$\{fmtDate\(earliest\)\} and \$\{fmtDate\(latest\)\}\.`/);
});

test('the onSubmit window check and the past-date question stay', () => {
  const submit = src.slice(src.indexOf("title: x ? 'Edit recurring job'"));
  assert.match(submit, /onSubmit[\s\S]*d\.next_due < earliest \|\| d\.next_due > latest/);
  assert.match(submit, /Next due date is in the past/);
});
