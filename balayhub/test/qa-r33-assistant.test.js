'use strict';
require('./helpers');

// Round 33 (ASSISTANT, AST-L, D-115): the chat transcript is never a live region; a hidden line beside it reads out only
// the newest answer, or the failure sentence.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/assistant.js'), 'utf8');

test('assist__list is not a live region; exactly one live line, the sr-only `said`', () => {
  assert.match(src, /const list = h\('div', \{ class: 'assist__list' \}\)/);
  assert.equal((src.match(/aria-live/g) || []).length, 1);
  assert.match(src, /const said = h\('div', \{ class: 'sr-only', 'aria-live': 'polite' \}\)/);
});

test('the failed bubble has no role alert', () => {
  assert.match(src, /m\.failed && h\('div', \{ class: 'alert alert--error' \}, "Couldn't answer\. "/);
});

test('said is emptied on send and New chat, and set on answer and failure', () => {
  assert.match(src, /askError\.textContent = '';\n\s*said\.textContent = '';/);
  assert.match(src, /msgs\.push\(\{ role: 'assistant'[^\n]*\n\s*said\.textContent = res\.reply;/);
  assert.match(src, /asked\.failed = true;\n\s*said\.textContent = "Couldn't answer\. Try again or contact support\.";/);
  assert.match(src, /msgs = \[\]; save\(msgs\); said\.textContent = '';/);
});

test('said sits right after list in the panel', () => {
  assert.match(src, /\n\s*list,\n\s*said,\n\s*askNote,/);
});
