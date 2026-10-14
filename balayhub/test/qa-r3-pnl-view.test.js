// QA round 3, lane C26 (pnl-view). Frontend source scan: the view imports the app shell, which does not load in Node.
// money#15: P&L leaves cancelled stays out completely (income, refunds and money kept), and the page says so.
// The tax summary is a cash view and keeps both, so the note points to it.
// node --test --test-concurrency=1 test/qa-r3-pnl-view.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'pnl.js'), 'utf8');

test('money#15: a muted note under the P&L table says cancelled stays are left out, and what the tax summary counts', () => {
  assert.match(src, /h\('p', \{ class: 'muted small' \}, 'Cancelled stays are left out, including money kept or refunded on them\. The Income summary \(for taxes\) counts all money received and refunded\.'\)/);
});

test('money#15: the note is drawn with the table, after it, and not in the empty state', () => {
  const noteAt = src.indexOf('Cancelled stays are left out');
  assert.notEqual(noteAt, -1, 'the note is missing');
  assert.ok(noteAt > src.indexOf("h('table'"), 'the note comes after the table');
  assert.ok(noteAt > src.indexOf("'Nothing for this month'"), 'the note is not part of the empty state');
});
