'use strict';
// MNY-3 (D-107 f): a discount code that has already ended is asked about, not refused; the toast tells the truth.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/guestcare.js'), 'utf8');
const m = src.match(/export function codeSavedToast[\s\S]*?\n}\n/);
const codeSavedToast = m ? new Function('fmtDate', `${m[0].replace('export ', '')}; return codeSavedToast;`)((d) => `<${d}>`) : null;

test('toast: ended, upcoming and plain codes', () => {
  assert.ok(m, 'export function codeSavedToast exists');
  assert.equal(codeSavedToast({ valid_until: '2020-01-01' }, '2026-10-21'), "Code created. It has already ended, so guests can't use it.");
  assert.equal(codeSavedToast({ valid_from: '2026-11-02' }, '2026-10-21'), 'Code created. It starts <2026-11-02>.');
  assert.equal(codeSavedToast({}, '2026-10-21'), 'Code created. Share it with your guests.');
  assert.equal(codeSavedToast({ valid_until: '2026-10-21' }, '2026-10-21'), 'Code created. Share it with your guests.');
});

// Stand-in for onSubmit: pull the handler body out of the source and run it with fakes.
function runSubmit(answer, d) {
  const calls = { posts: [], toasts: [], focused: 0, asked: null };
  const start = src.indexOf('onSubmit: async (d');
  const end = src.indexOf('\n    },\n  });', start);
  assert.ok(start > 0 && end > start, 'onSubmit found');
  const body = src.slice(start + 'onSubmit: '.length, end + 6);
  const fn = new Function('post', 'toast', 'confirmDialog', 'todayManila', 'fmtDate', 'codeSavedToast', 'rerender', `return (${body});`)(
    async (u, x) => { calls.posts.push([u, x]); }, (t) => calls.toasts.push(t),
    async (o) => { calls.asked = o; return answer; }, () => '2026-10-21', (x) => `<${x}>`, codeSavedToast, () => {});
  const f = { elements: { valid_until: { focus() { calls.focused++; } } } };
  return fn(d, { form: f }).then((r) => ({ r, calls }));
}

test('ended code: Change it posts nothing, keeps the dialog and focuses Valid until', async () => {
  const { r, calls } = await runSubmit(false, { code: 'QAR25PAST', percent_off: '10', valid_until: '2020-01-01' });
  assert.equal(r, false);
  assert.equal(calls.posts.length, 0);
  assert.equal(calls.focused, 1);
  assert.equal(calls.asked.title, 'This code has already ended');
  assert.equal(calls.asked.text, "Valid until <2020-01-01> is in the past, so guests can't use it. Save it anyway?");
  assert.equal(calls.asked.confirmText, 'Save anyway');
  assert.equal(calls.asked.cancelText, 'Change it');
});

test('ended code: Save anyway posts and says it has ended', async () => {
  const { calls } = await runSubmit(true, { code: 'QAR25PAST', percent_off: '10', valid_until: '2020-01-01' });
  assert.equal(calls.posts.length, 1);
  assert.deepEqual(calls.toasts, ["Code created. It has already ended, so guests can't use it."]);
});

test('current and upcoming codes ask nothing', async () => {
  let x = await runSubmit(false, { code: 'A1B', percent_off: '10', valid_from: '2026-11-02' });
  assert.equal(x.calls.asked, null);
  assert.deepEqual(x.calls.toasts, ['Code created. It starts <2026-11-02>.']);
  x = await runSubmit(false, { code: 'A1B', percent_off: '10' });
  assert.equal(x.calls.asked, null);
  assert.deepEqual(x.calls.toasts, ['Code created. Share it with your guests.']);
});
