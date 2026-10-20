'use strict';
require('./helpers');

// QA round 33, BOOKCODE (GST-1). The discount-code box is marked like the other booking fields: it points at its
// message lines, gets aria-invalid on a code error, and a typed change clears an error message. Source scans.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/book.js'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '');

test('the message lines have ids and the box points at both', () => {
  assert.match(src, /const codeMsg = h\('div', \{ class: 'muted small', role: 'status', id: 'bk-code-msg' \}\);/);
  assert.match(src, /h\('div', \{ class: 'error', role: 'alert', id: 'bk-code-err' \}\)/);
  assert.match(src, /const codeInput = h\('input',[^\n]*'aria-describedby': 'bk-code-msg bk-code-err'[^\n]*'aria-label': t\('Discount code'\)/);
});

test('aria-invalid is set on a quote code error and removed otherwise', () => {
  assert.match(src, /if \(q\.code_error\) codeInput\.setAttribute\('aria-invalid', 'true'\); else codeInput\.removeAttribute\('aria-invalid'\);/);
});

test('the no-dates branch unmarks the box', () => {
  const m = src.match(/const applyCode = \(\) => \{[\s\S]*?\n  \};/);
  assert.ok(m, 'applyCode found');
  assert.match(m[0], /codeInput\.removeAttribute\('aria-invalid'\)/);
});

test('typing clears only an error message and the mark', () => {
  const m = src.match(/codeInput\.addEventListener\('input',[^\n]*/);
  assert.ok(m, 'input listener found');
  assert.match(m[0], /codeMsg\.className === 'error'/);
  assert.match(m[0], /codeMsg\.textContent = ''/);
  assert.match(m[0], /codeMsg\.className = 'muted small'/);
  assert.match(m[0], /codeInput\.removeAttribute\('aria-invalid'\)/);
});
