'use strict';
require('./helpers');

// QA round 7, lane C00 (audit-helper): changedKeys decides which sent fields really differ from the stored
// row, so an edit writes an activity row only when something changed. Pure unit test, no database.
// node --test --test-concurrency=1 test/qa-r7-c00.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { changedKeys } = require('../src/lib/auditdiff');

test('null, undefined and empty string are the same empty value', () => {
  assert.deepEqual(changedKeys({ a: null }, { a: '' }), []);
  assert.deepEqual(changedKeys({ a: '' }, { a: null }), []);
  assert.deepEqual(changedKeys({}, { a: undefined }), []);
});

test('surrounding spaces do not count as a change', () => {
  assert.deepEqual(changedKeys({ name: 'a' }, { name: ' a ' }), []);
});

test('a time with :00 seconds equals the same time without seconds', () => {
  assert.deepEqual(changedKeys({ checkin_time: '14:00:00' }, { checkin_time: '14:00' }), []);
  assert.deepEqual(changedKeys({ checkin_time: '14:00' }, { checkin_time: '14:00:00' }), []);
  assert.deepEqual(changedKeys({ checkin_time: '14:00:30' }, { checkin_time: '14:00' }), ['checkin_time']);
});

test('a number string equals the number it reads as', () => {
  assert.deepEqual(changedKeys({ rate: '4200.00' }, { rate: 4200 }), []);
  assert.deepEqual(changedKeys({ rate: '4200.00' }, { rate: '4200' }), ['rate']); // text vs text is never coerced (C21)
  assert.deepEqual(changedKeys({ rate: '4200.00' }, { rate: 4300 }), ['rate']);
});

test('true equals the string "true", not the string "false"', () => {
  assert.deepEqual(changedKeys({ active: true }, { active: 'true' }), []);
  assert.deepEqual(changedKeys({ active: true }, { active: false }), ['active']);
});

test('a Date compares as its ISO string', () => {
  const at = new Date('2026-10-14T00:00:00.000Z');
  assert.deepEqual(changedKeys({ at }, { at: '2026-10-14T00:00:00.000Z' }), []);
  assert.deepEqual(changedKeys({ at }, { at: '2026-10-15T00:00:00.000Z' }), ['at']);
});

test('arrays compare in order, objects compare by key regardless of key order', () => {
  assert.deepEqual(changedKeys({ days: [1, 2] }, { days: [2, 1] }), ['days']);
  assert.deepEqual(changedKeys({ links: { a: 1, b: 2 } }, { links: { b: 2, a: 1 } }), []);
  assert.deepEqual(changedKeys({ links: { g: 'x' } }, { links: { g: 'y' } }), ['links']);
});

test('a key only in before is not reported, and the result follows the order of after', () => {
  assert.deepEqual(changedKeys({ a: 1, b: 2, c: 3 }, { c: 4, a: 1 }), ['c']);
  assert.deepEqual(changedKeys({ a: 1, b: 2 }, { b: 3, a: 9 }), ['b', 'a']);
});

test('with no before row, every non-empty key of after is changed', () => {
  assert.deepEqual(changedKeys(null, { a: '', b: 'x', c: null, d: 0, e: false }), ['b', 'd', 'e']);
});
