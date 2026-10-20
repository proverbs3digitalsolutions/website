'use strict';
require('./helpers');

// QA r32 lane INBOXLIVE (OPS-1, D-114): the conversation thread is rebuilt on every save, so it is not a live region.
// Frontend-only source scan.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js'), 'utf8');
const line = src.split('\n').find((l) => l.includes("const thread = h('div'"));

test('OPS-1: the thread keeps its region role, name and tabindex', () => {
  assert.ok(line, 'thread element found');
  assert.match(line, /class: 'inbox__messages'/);
  assert.match(line, /tabindex: '0'/);
  assert.match(line, /role: 'region'/);
  assert.match(line, /'aria-label': 'Conversation messages'/);
});

test('OPS-1: the thread is not a live region and nothing else in the file is', () => {
  assert.doesNotMatch(line, /aria-live/);
  assert.equal((src.match(/aria-live/g) || []).length, 0);
});

test('OPS-1: the reason is commented above the thread', () => {
  assert.ok(src.includes('// The pane is rebuilt on every save, so a live region here never reported a new message; the toast says the save (D-114).'));
});
