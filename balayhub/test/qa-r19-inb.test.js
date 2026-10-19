'use strict';

// QA r19 INB: Send later is read as Philippine time (UTC+8, no DST), not the device zone. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/inbox.js'), 'utf8');
const fn = src.match(/export function manilaDateTime[\s\S]*?\n}\n/)[0].replace('export ', '');
const manilaDateTime = new Function(`${fn}; return manilaDateTime;`)();

test('typed time is Manila wall-clock time', () => {
  assert.equal(manilaDateTime('2026-10-21T09:00').toISOString(), '2026-10-21T01:00:00.000Z');
  assert.equal(manilaDateTime('2026-10-21T00:30').toISOString(), '2026-10-20T16:30:00.000Z');
});
test('empty or invalid gives null', () => {
  assert.equal(manilaDateTime(''), null);
  assert.equal(manilaDateTime('nope'), null);
});
test('inbox uses the helper, the label and the short hint', () => {
  assert.match(src, /manilaDateTime\(sendAt\.value\)/);
  assert.match(src, /Send later \(Philippine time, optional\)/);
  assert.match(src, /placeholder: 'Guest, listing or code'/);
  assert.doesNotMatch(src, /new Date\(sendAt\.value\)/);
});
