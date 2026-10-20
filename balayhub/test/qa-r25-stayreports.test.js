'use strict';

// QA r25 MNY-5: the three report tabs are one Tab stop. Only the selected tab is tabindex 0; the others are -1
// (arrows, Home and End are the global handler in app.js, which focuses and opens the target, and the redrawn list marks it 0).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/stayreports.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const line = src.split('\n').find((l) => l.includes('const tabBtn = '));

test('tabBtn: the selected tab is tabindex 0, every other tab -1', () => {
  assert.ok(line, 'tabBtn exists');
  assert.match(line, /tabindex: tab === key \? '0' : '-1'/);
});

test('stand-in: exactly one of the three tabs has tabindex 0 for each selected tab', () => {
  const expr = /tabindex: (tab === key \? '0' : '-1')/.exec(line)[1];
  for (const tab of ['performance', 'tax', 'deposits']) {
    const zeros = ['performance', 'tax', 'deposits'].filter((key) => new Function('tab', 'key', `return ${expr}`)(tab, key) === '0');
    assert.deepEqual(zeros, [tab]);
  }
});

test('arrows still switch reports: the global tablist handler is in place', () => {
  assert.match(appSrc, /tabs\[next\]\.focus\(\);\s*tabs\[next\]\.click\(\);/);
  assert.match(src, /role: 'tab'/);
});
