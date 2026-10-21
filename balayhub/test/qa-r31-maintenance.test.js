'use strict';
require('./helpers');

// QA r31 MAINTENANCE (MNT-R): the repair's "Upload photo or document" says a refused file on the file box (D-113), not in a toast.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/maintenance.js'), 'utf8');
const start = src.indexOf("const upload = h('input'");
const block = src.slice(start, src.indexOf('el.replaceChildren(', start));
const onchange = block.slice(block.indexOf('onchange'));

test('slice is non-empty', () => { assert.ok(block.length > 200); });

test('maintenance.js imports the two upload helpers', () => {
  assert.match(src, /\buploadField\b[\s\S]{0,300}from '\.\.\/ui\.js'/);
  assert.match(src, /\bfileRefused\b[\s\S]{0,300}from '\.\.\/ui\.js'/);
});

test('the input is wrapped by uploadField and up.wrap is rendered in its place', () => {
  assert.match(block, /const up = uploadField\(upload\);/);
  assert.match(src, /h\('div', \{ class: 'field' \}, h\('label', \{ for: 'maint-upload-file' \}, 'Upload photo or document'\), up\.wrap\)/);
  assert.doesNotMatch(src, /\}, upload\)/);
});

test('onchange clears the line first', () => {
  assert.match(onchange, /if \(!upload\.files\[0\]\) return;\s*up\.clear\(\);/);
});

test('catch enables the input before up.show, and fileRefused chooses line or toast', () => {
  const c = onchange.slice(onchange.indexOf('catch'));
  assert.ok(c.indexOf("upload.removeAttribute('aria-disabled')") > -1 && c.indexOf("upload.removeAttribute('aria-disabled')") < c.indexOf('up.show('));
  assert.match(c, /if \(fileRefused\(err\)\) up\.show\(err\.message\); else toast\(err\.message, 'error'\);/);
});

test('success toast unchanged', () => { assert.match(onchange, /toast\('Uploaded\.'\)/); });
