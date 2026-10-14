'use strict';
// Housekeeping task screen (frontend): Mark done counts what is unticked on screen,
// a team member and a typed outside name are one choice, the checklist editor refuses
// an empty list, and the inspection and lost-item lines cope with fields the server leaves out.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/housekeeping.js'), 'utf8');
// The view imports browser modules, so pull the pure helpers out of the source.
const grab = (name) => src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`))[0].replace('export ', '');
// Stands in for api.js's ApiError: the view only reads message and fields from it.
class FakeApiError extends Error {
  constructor(message, { fields } = {}) { super(message); this.fields = fields; }
}
const { uncheckedCount, metaLine, linkAssignee, assigneeChoice } = new Function('ApiError', `${grab('uncheckedCount')}\n${grab('metaLine')}\n${grab('linkAssignee')}\n${grab('fieldError')}\n${grab('assigneeChoice')}\nreturn { uncheckedCount, metaLine, linkAssignee, assigneeChoice };`)(FakeApiError);

test('unticked count is taken from the checkboxes on screen', () => {
  assert.equal(uncheckedCount([true, false, false]), 2);
  assert.equal(uncheckedCount([true, true]), 0);
  assert.equal(uncheckedCount([]), 0);
});

test('Mark done no longer uses the count from page load', () => {
  assert.doesNotMatch(src, /t\.item_count - t\.done_count/);
  assert.match(src, /uncheckedCount\(\[\.\.\.items\.querySelectorAll\('input\[type="checkbox"\]'\)\]\.map\(\(b\) => b\.checked\)\)/);
});

test('record lines skip the parts the server left out', () => {
  assert.equal(metaLine('Oct 14, 2026', undefined, 'Juan'), 'Oct 14, 2026 · Juan');
  assert.equal(metaLine(undefined, false, ''), '');
});

test('picking a team member clears the typed name, and typing a name clears the member', () => {
  const el = (value) => ({ value, on: {}, addEventListener(type, fn) { this.on[type] = fn; } });
  const member = el('user-1'); const name = el('Aling Rosa');
  linkAssignee(member, name);
  member.on.change();
  assert.equal(name.value, '');
  member.value = 'user-2'; name.value = 'Aling Rosa'; name.on.input();
  assert.equal(member.value, '');
  assert.equal(name.value, 'Aling Rosa');
});

test('choosing "Not a team member" keeps the typed name, and a blank name keeps the member', () => {
  const el = (value) => ({ value, on: {}, addEventListener(type, fn) { this.on[type] = fn; } });
  const member = el(''); const name = el('Aling Rosa');
  linkAssignee(member, name);
  member.on.change();
  assert.equal(name.value, 'Aling Rosa');
  member.value = 'user-1'; name.value = '   '; name.on.input();
  assert.equal(member.value, 'user-1');
});

test('an assignment is a team member or a typed name, never both sent', () => {
  assert.deepEqual(assigneeChoice({ assigned_to: 'user-1', assignee_name: '' }), { assigned_to: 'user-1', assignee_name: null });
  assert.deepEqual(assigneeChoice({ assigned_to: '', assignee_name: 'Aling Rosa' }), { assigned_to: null, assignee_name: 'Aling Rosa' });
  assert.deepEqual(assigneeChoice({ assigned_to: '', assignee_name: '' }), { assigned_to: null, assignee_name: null });
  assert.throws(() => assigneeChoice({ assigned_to: 'user-1', assignee_name: 'Aling Rosa' }),
    (err) => err.message === 'Pick a team member or type a name, not both.' && err.fields.assignee_name === err.message);
  assert.match(src, /assigneeChoice\(d\)/);
});

test('a client-side field error shows only under its field, not again in the form box', () => {
  // makeForm also draws err.message in the form's top box; fieldError empties that box again once drawn.
  const { fieldError } = new Function('ApiError', `${grab('fieldError')}\nreturn { fieldError };`)(FakeApiError);
  const err = fieldError('items', 'Add at least one checklist item.');
  assert.equal(err.message, 'Add at least one checklist item.');
  assert.deepEqual(err.fields, { items: 'Add at least one checklist item.' });
  const box = { children: ['the repeated message'], replaceChildren(...kids) { this.children = kids; } };
  err.onRender(box);
  assert.deepEqual(box.children, []);
});

test('each client-side field error in this view goes through fieldError, so the form box never repeats it', () => {
  assert.match(src, /throw fieldError\('assignee_name', msg\)/);
  assert.match(src, /throw fieldError\('due_date', msg\)/);
  assert.match(src, /throw fieldError\('items', msg\)/);
  assert.doesNotMatch(src, /throw new ApiError\(msg, \{ status: 400, fields: \{/);
});

test('owner pay card tells the owner to use Set pay, with no hours wording', () => {
  assert.match(src, /Pay not set\. Use Set pay\./);
  assert.doesNotMatch(src, /add the hours/);
});

test('the checklist editor refuses an empty list', () => {
  assert.match(src, /Add at least one checklist item\./);
  assert.match(src, /throw fieldError\('items', msg\)/);
});

test('lines with fields the server leaves out render without undefined or stray labels', () => {
  assert.match(src, /i\.score != null && h\('strong', null, `\$\{i\.score\}%`\)/);
  assert.match(src, /typeof i\.passed === 'boolean' && badge\(i\.passed/);
  assert.doesNotMatch(src, /\$\{fmtDate\(l\.found_on\)\}/);
  assert.match(src, /metaLine\(l\.found_where, l\.found_on && fmtDate\(l\.found_on\), l\.found_by_name\)/);
  assert.match(src, /metaLine\(i\.created_at && fmtDateTime\(i\.created_at\), i\.inspected_by_name\)/);
});
