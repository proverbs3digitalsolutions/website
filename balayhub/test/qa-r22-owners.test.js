'use strict';

// QA r22 OWNERS (PHN-1): ?new=1 opens Add owner after the page is drawn, so Escape returns focus to the H1. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/owners.js'), 'utf8');

test('?new=1 opens Add owner in a setTimeout guarded by el.isConnected, not synchronously', () => {
  const line = src.split('\n').find((l) => l.includes('query.new') && l.includes('add()'));
  assert.ok(line, 'opener line exists');
  assert.match(line, /setTimeout\(\(\) => \{ if \(el\.isConnected\) add\(\); \}, 0\)/);
  assert.ok(line.indexOf('delete query.new') < line.indexOf('setTimeout'), 'flag dropped first');
  assert.doesNotMatch(line.replace(/setTimeout\(.*\)\)/, ''), /add\(\)/, 'no direct add() outside the timeout');
});
