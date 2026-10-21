'use strict';
require('./helpers');

// QA round 34, lane INBOX (public/js/views/inbox.js). Frontend only: source scans.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('INB-1: exactly one data-page-heading, on the open conversation h2 holding the guest name', () => {
  assert.equal((src.match(/data-page-heading/g) || []).length, 1);
  assert.match(src, /h\('h2',\s*\{\s*'data-page-heading':\s*''\s*\},\s*c\.guest_name\)/);
});

test('INB-1: Skip to conversation still targets the thread h2', () => {
  assert.match(src, /threadPane\.querySelector\('h2'\)/);
});

test('INB-2: header select is "Conversation assigned to"; the filter keeps "Assigned to"', () => {
  assert.match(src, /'aria-label':\s*'Conversation assigned to'/);
  assert.doesNotMatch(src, /'aria-label':\s*'Assigned to'/);
  assert.match(src, /label:\s*'Assigned to'/);
});
