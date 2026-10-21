'use strict';
require('./helpers');

// QA round 34, lane MAINTFILE (public/js/views/maintenance.js). Frontend only.
// The upload box is named by its own visible label, never an aria-label (D-116, class l).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'maintenance.js'), 'utf8');
const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('the upload input has an id and no aria-label', () => {
  const m = code.match(/const upload = h\('input',[^\n]*/);
  assert.ok(m, 'upload input found');
  assert.match(m[0], /id: 'maint-upload-file'/);
  assert.doesNotMatch(m[0], /aria-label/);
});

test('a visible label for the upload box sits before it in the Photos card', () => {
  assert.match(code, /h\('label', \{ for: 'maint-upload-file' \}, 'Upload photo or document'\), up\.wrap/);
});

test('no file input in the view carries an aria-label', () => {
  for (const m of code.matchAll(/h\('input',\s*\{[^}]*type: 'file'[^\n]*/g)) assert.doesNotMatch(m[0], /aria-label/);
});
