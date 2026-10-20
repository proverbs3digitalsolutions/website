'use strict';

// PHN-1: the ?new=1 dialog on Properties opens after the page is drawn, so the
// router's heading focus is the dialog's opener and Escape returns to it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/properties.js'), 'utf8');

test('?new=1 opens the property dialog from a deferred, connected-guarded call', () => {
  assert.match(src, /if \(query\.new && isOwner\) \{[^}]*setTimeout\(\(\) => \{ if \(el\.isConnected\) newPropertyModal\(\); \}, 0\);/s);
});

test('the list view never opens the dialog synchronously', () => {
  const view = src.slice(src.indexOf('export async function propertiesView'), src.indexOf('export async function propertyDetailView'));
  const bare = view.split('\n').filter((l) => /newPropertyModal\(\)/.test(l) && !/setTimeout|onclick/.test(l));
  assert.deepEqual(bare, []);
});
