'use strict';
// QA r28 PHONE-TAP: the bottom-bar focusin guard must not scroll for a tap, and must never scroll a tall box past the top bar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
const START = "document.addEventListener('focusin', ";
const from = SRC.indexOf(START) + START.length;
const guardSrc = SRC.slice(from, SRC.indexOf('\n});', from) + 2);

class El {
  constructor({ top, bottom, keyboard = true }) { this.top = top; this.bottom = bottom; this.keyboard = keyboard; }
  getBoundingClientRect() { return { top: this.top, bottom: this.bottom }; }
  closest() { return null; }
  matches(sel) { assert.equal(sel, ':focus-visible'); return this.keyboard; }
}
function run(target) {
  const scrolls = [];
  const rectOf = (o) => ({ getBoundingClientRect: () => o });
  const doc = { querySelector: (s) => (s === '.bottomnav' ? rectOf({ top: 700 }) : s === '.topbar' ? rectOf({ height: 64 }) : null) };
  const win = { matchMedia: () => ({ matches: true }), scrollBy: (x, y) => scrolls.push([x, y]) };
  new Function('document', 'window', 'Element', `return ${guardSrc};`)(doc, win, El)({ target });
  return scrolls;
}

test('a tap (pointer focus, not focus-visible) on a tall scroll box does not scroll the page', () => {
  assert.deepEqual(run(new El({ top: -3000, bottom: 31700, keyboard: false })), []);
});
test('keyboard focus on a small control under the bottom bar scrolls it clear, hidden + 16', () => {
  assert.deepEqual(run(new El({ top: 720, bottom: 760 })), [[0, 76]]);
});
test('keyboard focus on a box taller than the screen scrolls at most to its top under the top bar', () => {
  assert.deepEqual(run(new El({ top: 300, bottom: 34000 })), [[0, 236]]);
});
test('a tall box whose top is already at or above the top bar is not scrolled', () => {
  assert.deepEqual(run(new El({ top: 20, bottom: 34000 })), []);
});
test('without :focus-visible support the guard still helps keyboard users', () => {
  const t = new El({ top: 720, bottom: 760 }); t.matches = () => { throw new Error('unsupported'); };
  assert.deepEqual(run(t), [[0, 76]]);
});

test('the top stop follows the page scroll-padding-top when the browser reports one', () => {
  const scrolls = [];
  const rectOf = (o) => ({ getBoundingClientRect: () => o });
  const doc = { documentElement: {}, querySelector: (s) => (s === '.bottomnav' ? rectOf({ top: 700 }) : s === '.topbar' ? rectOf({ height: 64 }) : null) };
  const win = { matchMedia: () => ({ matches: true }), scrollBy: (x, y) => scrolls.push([x, y]), getComputedStyle: () => ({ scrollPaddingTop: '72px' }) };
  new Function('document', 'window', 'Element', `return ${guardSrc};`)(doc, win, El)({ target: new El({ top: 300, bottom: 34000 }) });
  assert.deepEqual(scrolls, [[0, 228]]);
});
