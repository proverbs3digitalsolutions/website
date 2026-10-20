'use strict';
require('./helpers');

// QA round 31, HOUSEKEEPING (PHN-1). A refused photo is said on the control's own line (uploadField), not in a toast.
// Frontend-only source scans of the slice from `let uploading` to `const actionBtn`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/housekeeping.js'), 'utf8');
const a = src.indexOf('let uploading');
const slice = src.slice(a, src.indexOf('const actionBtn', a));

test('imports uploadField and fileRefused from ui.js', () => {
  const imp = src.slice(src.indexOf('import {\n  h, icon'), src.indexOf("from '../ui.js'"));
  assert.match(imp, /\buploadField\b/);
  assert.match(imp, /\bfileRefused\b/);
});

test('uploadField wraps the input and up.wrap is rendered in its place', () => {
  assert.match(slice, /const up = uploadField\(upload\)/);
  assert.match(src, /h\('div', \{ class: 'form'[^\n]*\}, up\.wrap\)/);
  assert.doesNotMatch(src.slice(src.indexOf('const actionBtn')), /\}, upload\)/, 'bare input no longer rendered');
});

test('up.clear() runs before photoProblem on a new pick', () => {
  assert.ok(slice.indexOf('up.clear()') > -1 && slice.indexOf('up.clear()') < slice.indexOf('photoProblem('));
});

test('device refusal goes to up.show, not a toast', () => {
  assert.match(slice, /if \(bad\) \{ upload\.value = ''; up\.show\(bad\); return; \}/);
  assert.doesNotMatch(slice, /toast\(bad/);
});

test('catch: file refusals to up.show, other failures keep the toast', () => {
  assert.match(slice, /fileRefused\(err\) \|\| err\.message === "The file content doesn't match its type\."/);
  assert.match(slice, /up\.show\(/);
  assert.match(slice, /toast\(err\.message, 'error'\)/);
  assert.ok(slice.indexOf('BAD_FILE_CONTENT') < slice.indexOf('UNSUPPORTED_FILE'));
  assert.match(slice, /toast\(T\('Photo uploaded\.'\)\)/);
});

test('focus key kept once', () => {
  assert.equal(slice.split("'data-focus-key': 'hk-photo'").length - 1, 1);
});
