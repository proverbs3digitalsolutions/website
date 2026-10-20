// QA r33 INBOXNAME: the "Send later" box is named by its wrapping label, not an aria-label that replaces it (D-115).
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/inbox.js'), 'utf8');
const line = src.split('\n').find((l) => l.includes('const sendAt = h('));

test('sendAt has no aria-label and keeps aria-describedby errId', () => {
  assert.ok(line, 'sendAt declaration found');
  assert.ok(!/aria-label/.test(line.split('//')[0]));
  assert.ok(/'aria-describedby': errId/.test(line));
});

test('sendAt sits inside the composer__later label starting "Send later (Philippine time, optional)"', () => {
  assert.match(src, /h\('label', \{ class: 'composer__later small muted' \}, 'Send later \(Philippine time, optional\) ', sendAt\)/);
});
