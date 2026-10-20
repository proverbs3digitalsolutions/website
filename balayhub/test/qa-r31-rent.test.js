'use strict';
require('./helpers');

// QA r31 RENT (RENT-C): the payment and expense detail upload buttons say a refused file on the file box (D-113), not in a toast.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/rent.js'), 'utf8');
const views = [
  ['payment', src.slice(src.lastIndexOf("const upload = h('input'", src.indexOf("uploadFile('payment'")), src.indexOf("'Upload attachment'"))],
  ['expense', src.slice(src.lastIndexOf("const upload = h('input'", src.indexOf("uploadFile('expense'")), src.indexOf("'Upload receipt'"))],
];

test('slices are non-empty', () => { for (const [, v] of views) assert.ok(v.length > 200); });

test('rent.js imports the two upload helpers', () => {
  assert.match(src, /\buploadField\b[\s\S]{0,300}from '\.\.\/ui\.js'/);
  assert.match(src, /\bfileRefused\b[\s\S]{0,300}from '\.\.\/ui\.js'/);
});

for (const [kind, v] of views) {
  test(`${kind} detail: upload line on the file box`, () => {
    assert.match(v, /const up = uploadField\(upload\);/);
    assert.match(v, /upload\.addEventListener\('change', up\.clear\)/);
    assert.match(v, /up\.wrap/);
    assert.match(v, /up\.clear\(\);\s*if \(!upload\.files\[0\]\) \{ up\.show\('Choose a file first\.'\); return; \}/);
    assert.match(v, /const bad = fileProblem\(upload\.files\[0\]\); if \(bad\) \{ up\.show\(bad\); return; \}/);
    assert.doesNotMatch(v, /toast\(bad/);
    assert.doesNotMatch(v, /toast\('Choose a file first/);
    assert.match(v, /catch \(err\) \{ e\.target\.disabled = false; if \(fileRefused\(err\)\) up\.show\(err\.message\); else toast\(err\.message, 'error'\); \}/);
    assert.match(v, /toast\('Uploaded\.'\)/);
  });
}
