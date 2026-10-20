'use strict';
require('./helpers');

// QA r31 lane INBOX: INB-1 (a press inside the composer holds the @ list so Save note does not move before the press lands)
// and INB-2 (a typed, unpicked @name saves as plain text, so the toast says nobody was notified). Frontend-only source scans.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js'), 'utf8');

test('INB-1: the blur listener respects a held press', () => {
  assert.match(src, /let held = false;/);
  assert.match(src, /body\.addEventListener\('blur', \(\) => \{ if \(!held\) close\(\); \}\);/);
  assert.doesNotMatch(src, /body\.addEventListener\('blur', close\);/);
  assert.match(src, /return \{ list, close, hold: \(v\) => \{ held = v; \} \};/);
});

test('INB-1: the composer holds on pointerdown and releases on click and pointercancel', () => {
  assert.match(src, /form\.addEventListener\('pointerdown', \(e\) => \{ if \(!picker\.list\.contains\(e\.target\)\) picker\.hold\(true\); \}\);/);
  assert.match(src, /for \(const ev of \['click', 'pointercancel'\]\) form\.addEventListener\(ev, \(\) => \{ picker\.hold\(false\); if \(document\.activeElement !== body\) picker\.close\(\); \}\);/);
});

test('INB-2: the unpicked @name toast', () => {
  const sentence = 'Note saved. Nobody was notified: pick a name from the @ list to mention someone.';
  assert.ok(src.includes(`toast('${sentence}')`));
  const re = /(^|\s)@[^\s@]/;
  assert.ok(src.includes('/(^|\\s)@[^\\s@]/.test(body.value)'));
  assert.ok(re.test('QA r31 note @Mara'));
  assert.ok(re.test('@Mara hi'));
  assert.ok(!re.test('mail ana@x.com'));
  assert.ok(!re.test('no mention'));
  // the new branch sits after the picked-mentions branch and before the plain toast
  const a = src.indexOf('r.mentions.length) toast');
  const b = src.indexOf(sentence);
  const c = src.indexOf("toast({ note: 'Note saved.'");
  assert.ok(a > 0 && a < b && b < c);
});
