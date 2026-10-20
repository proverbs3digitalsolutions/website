'use strict';
require('./helpers');

// QA round 31, PAY-R: the guest pay page's "Add the screenshot" checks the screenshot's first bytes before it is
// sent (D-113, D-112 "every upload"), and every device refusal on the proof row puts focus on that row's file box.
// Source scan only: no server or database needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pay = fs.readFileSync(path.join(__dirname, '../public/js/views/pay.js'), 'utf8');
const list = pay.slice(pay.indexOf('function pendingList('), pay.indexOf('function proofForm('));
const add = list.slice(list.indexOf("add.addEventListener('click'"), list.indexOf("back.addEventListener('click'"));

test('the screenshot is checked on the device before it is sent, after the type and size line', () => {
  assert.match(add, /const bad = await fileContentError\(f\);/);
  assert.ok(add.indexOf('PROOF_TYPES.includes(f.type)') < add.indexOf('fileContentError(f)'), 'after the type and size line');
  assert.ok(add.indexOf('fileContentError(f)') < add.indexOf("api('POST'"), 'before the screenshot is posted');
});

test('the content refusal is said on the row through t(), in Taglish too', () => {
  assert.match(add, /msg\.replaceChildren\(h\('div', \{ class: 'alert alert--error' \}, t\(bad\)\)\)/);
  assert.ok(pay.includes("'Hindi totoong PDF, JPG, PNG o WEBP ang file na ito. Piliin ulit ang file.'"));
});

test('every device refusal on the row puts focus on the file box before it returns', () => {
  assert.equal(add.split('return;').length - 1, 4, 'four refusals: no file, empty, type and size, not really its type');
  assert.equal(add.split('file.focus(); return;').length - 1, 4, 'each refusal focuses the file box first');
});

test('the file-wide size checks stay at one each (qa-r29-guest-empty counts them)', () => {
  assert.equal(pay.split('!f.size').length - 1, 1);
  assert.equal(pay.split('!file.size').length - 1, 1);
});
