'use strict';

// QA round 16, inbox lane (IN): the Assigned to select keeps keyboard focus across the redraw (#7) and
// each composer mode keeps its own text (#11). Frontend-only: no database. Same temp-copy load as qa-r2-inbox-view.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js'), 'utf8');

let inbox;
let dir;
test.before(async () => {
  globalThis.Element = class { };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-inbox-r16-'));
  fs.cpSync(path.join(__dirname, '..', 'public', 'js'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'app.js'), [
    'export const state = { user: null, requireEmailVerification: true };',
    'export const navigate = () => {};',
    'export const refreshUser = async () => {};',
    'export const logout = async () => {};',
    'export const afterLogin = async () => {};',
    "export const homeRoute = () => '#/home';",
  ].join('\n'));
  inbox = await import(pathToFileURL(path.join(dir, 'views', 'inbox.js')));
});
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

test('the Assigned to select carries the conv-assign focus key', () => {
  assert.match(src, /'aria-label': 'Conversation assigned to', 'data-focus-key': 'conv-assign'/);
});

test('swapMode keeps a separate text per mode', () => {
  let s = { mode: 'message', box: 'Hello', guestText: '', noteText: '' };
  s = inbox.swapMode(s, 'note');
  assert.equal(s.mode, 'note');
  assert.equal(s.box, '', 'the note starts empty');
  s = inbox.swapMode({ ...s, box: 'Check the key' }, 'message');
  assert.equal(s.box, 'Hello', 'the guest text comes back');
  s = inbox.swapMode({ ...s, box: 'Hello there' }, 'note');
  assert.equal(s.box, 'Check the key', 'the note text comes back');
  assert.equal(s.guestText, 'Hello there');
});

test('setMode swaps through swapMode so Save note never sends the guest text', () => {
  assert.match(src, /swapMode\(\{ mode, box: body\.value, \.\.\.st \}, k\)/);
  assert.match(src, /composerStash\.set\(c\.conversation_id/);
});
