'use strict';
require('./helpers');

// QA r37 lane INBOX (INB-1): the thread scrolls to its newest message once it is on the page, not while the router still holds
// the page detached (D-119). Frontend-only; the test database is set but never used.

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
  globalThis.Element = class { }; // ui.js patches Element.prototype when it loads
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-inbox-r37-'));
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
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// A detached element has no layout: scrollHeight reads 0 until it is attached.
const standIn = (height, connected) => ({
  isConnected: connected, scrollTop: 0,
  get scrollHeight() { return this.isConnected ? height : 0; },
  // The desktop thread is a 400 px scroll box, so taller content scrolls inside it.
  get clientHeight() { return this.isConnected ? 400 : 0; },
});

test('waits until the thread is attached, then scrolls to the bottom', async () => {
  const t = standIn(1513, false);
  let calls = 0;
  await inbox.scrollToNewest(t, { wait: async () => { calls += 1; if (calls === 2) t.isConnected = true; } });
  assert.equal(t.scrollTop, 1513);
  assert.equal(calls, 2);
});

test('an already attached thread scrolls at once, with no wait', async () => {
  const t = standIn(683, true);
  let calls = 0;
  await inbox.scrollToNewest(t, { wait: async () => { calls += 1; } });
  assert.equal(t.scrollTop, 683);
  assert.equal(calls, 0);
});

test('a thread that is never attached gives up quietly', async () => {
  const t = standIn(900, false);
  await inbox.scrollToNewest(t, { wait: async () => {}, maxMs: 0 });
  assert.equal(t.scrollTop, 0);
});

test('red demonstration: scrolling a detached thread directly does nothing', () => {
  const t = standIn(1513, false);
  t.scrollTop = t.scrollHeight;
  assert.equal(t.scrollTop, 0);
});

// On a phone the thread is not a scroll box: its height is its visible height, so only the page scrolls (D-119 phone path).
// The phone check reads the screen height and the page's bottom scroll padding (the strip under the bottom bar), which node
// does not have, so each test supplies them and they are removed afterwards.
const withScreen = (fn, padBottom = '0px') => {
  globalThis.window = { innerHeight: 844 };
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ scrollPaddingBottom: padBottom });
  return fn().finally(() => { delete globalThis.window; delete globalThis.document; delete globalThis.getComputedStyle; });
};
const phoneThread = (connected, lastBottom = 1600) => {
  const scrolled = [];
  return {
    isConnected: connected, scrollTop: 0, scrolled,
    lastElementChild: { scrollIntoView: (opts) => scrolled.push(opts), getBoundingClientRect: () => ({ bottom: lastBottom }) },
    get scrollHeight() { return this.isConnected ? 1714 : 0; },
    get clientHeight() { return this.isConnected ? 1714 : 0; },
  };
};

test('a thread that is not a scroll box brings its last message into view (block end) once attached', () => withScreen(async () => {
  const t = phoneThread(false);
  let calls = 0;
  await inbox.scrollToNewest(t, { wait: async () => { calls += 1; if (calls === 2) t.isConnected = true; } });
  assert.deepEqual(t.scrolled, [{ block: 'end' }]);
  assert.equal(t.scrollTop, 0);
}));

test('a thread that is not a scroll box leaves the page alone when its last message is already on screen', () => withScreen(async () => {
  const t = phoneThread(true, 500);
  await inbox.scrollToNewest(t, { wait: async () => {} });
  assert.deepEqual(t.scrolled, []);
  assert.equal(t.scrollTop, 0);
}));

test('a thread that is not a scroll box scrolls when its last message sits under the bottom bar (scroll-padding-bottom 80px)', () => withScreen(async () => {
  const t = phoneThread(true, 800);
  await inbox.scrollToNewest(t, { wait: async () => {} });
  assert.deepEqual(t.scrolled, [{ block: 'end' }]);
}, '80px'));

test('a scrolling thread still sets scrollTop to its scrollHeight and does not scroll its last message', async () => {
  const t = standIn(1513, true);
  let scrolledLast = false;
  t.lastElementChild = { scrollIntoView: () => { scrolledLast = true; } };
  await inbox.scrollToNewest(t, { wait: async () => {} });
  assert.equal(t.scrollTop, 1513);
  assert.equal(scrolledLast, false);
});

test('renderThread scrolls after the pane is filled, without awaiting, and no longer assigns scrollTop', () => {
  const body = src.slice(src.indexOf('async function renderThread'), src.indexOf('// Very long messages'));
  assert.ok(body.indexOf('pane.replaceChildren(') !== -1);
  assert.ok(body.indexOf('scrollToNewest(thread)') > body.indexOf('pane.replaceChildren('));
  assert.ok(!/await\s+scrollToNewest/.test(body));
  assert.ok(!/thread\.scrollTop\s*=/.test(body));
});
