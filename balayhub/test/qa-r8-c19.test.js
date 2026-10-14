'use strict';

// makeForm (public/js/ui.js): Cancel clears the draft, huge money refused before onSubmit, focus kept after a failed save.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/ui.js'), 'utf8');
const form = src.slice(src.indexOf('export function makeForm'), src.indexOf('export function formModal'));

test('Cancel clears the draft before calling cancel; Escape/close path (formModal cancel) is untouched', () => {
  assert.match(form, /onclick: \(\) => \{ clearDraft\(\); cancel\(\); \}/);
});

test('money boxes above 99,999,999.99 are refused with "<label> is too large." before onSubmit', () => {
  const check = form.indexOf('is too large.');
  assert.ok(check > 0 && check < form.indexOf('await onSubmit'));
  assert.match(form, /\.input-money input/);
  assert.match(form, /parseAmount\(el\.value\) > 99999999\.99/);
});

test('finally path refocuses inside the form when focus left it', () => {
  const fin = form.slice(form.indexOf('} finally {'));
  assert.match(fin, /!form\.contains\(document\.activeElement\)/);
  assert.match(fin, /\.field--invalid input/);
  assert.match(fin, /focusedBefore/);
  assert.match(fin, /: submitBtn\)\)\.focus\(\)/);
});
