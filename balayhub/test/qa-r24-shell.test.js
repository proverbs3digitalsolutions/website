'use strict';

// QA r24 SHELL (CARD-2): when refreshUser() changes what the shell is built from, the shell is rebuilt around the page on screen.
// Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const line = app.split('\n').find((l) => l.startsWith('export const shellStale'));
const shellStale = line && new Function(`${line.replace('export const', 'const')}; return shellStale;`)();

test('shellStale: only a connected shell with a different key and a signed-in person', () => {
  assert.ok(shellStale, 'shellStale is exported from app.js');
  const base = { user: { user_id: 1 }, sig: 'a', key: 'b', connected: true };
  assert.equal(shellStale(base), true);
  assert.equal(shellStale({ ...base, key: 'a' }), false, 'same key keeps the shell');
  assert.equal(shellStale({ ...base, user: null }), false, 'signed out: the router handles it');
  assert.equal(shellStale({ ...base, sig: null }), false, 'no shell drawn yet');
  assert.equal(shellStale({ ...base, connected: false }), false, 'shell not on the page');
});

test('refreshUser compares shellKey with shellSig and calls swapShell; render uses the same function', () => {
  const fn = app.slice(app.indexOf('export async function refreshUser'), app.indexOf('const isReady'));
  assert.match(fn, /shellStale\(\{[^}]*shellKey\(state\.user\)/);
  assert.match(fn, /swapShell\(/);
  assert.match(fn, /preventScroll: true/);
  assert.match(app, /function swapShell\(/);
  const r = app.slice(app.indexOf('export async function render'));
  assert.match(r, /swapShell\(path, prev\)/);
  assert.doesNotMatch(r, /shell = buildShell\(/, 'render no longer builds the shell itself');
});

test('an in-flight render still mounts into the rebuilt shell: it swaps through the module-level shell.content', () => {
  const r = app.slice(app.indexOf('export async function render'));
  assert.match(r, /shell\.content\.replaceWith\(mount\);\s*shell\.content = mount;/);
  const rb = app.slice(app.indexOf('function swapShell('), app.indexOf('function updateShell'));
  assert.match(rb, /shell\.content\.replaceWith\(carry\); shell\.content = carry;/);
});
