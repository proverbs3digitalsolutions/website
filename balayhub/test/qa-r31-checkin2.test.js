'use strict';
require('./helpers');

// Round 31 (CHECKIN2, CHECKIN3): the "finish registering" note appears once. On a page that loaded a saved draft it is the top
// banner, so a refused replacement photo adds no second copy; on a first save (no saved record at load) it goes in the error box.
// A submitted registration never shows it. A refused photo is said on the ID box.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/checkin.js'), 'utf8');
const submit = src.slice(src.indexOf("form.addEventListener('submit'"), src.indexOf('// ---------------------------------------------------------------- host: card'));

test('draftNote in the save catch is only shown when the page had no saved record at load', () => {
  const uses = [...submit.matchAll(/^.*draftNote.*$/gm)].map((m) => m[0]);
  assert.equal(uses.length, 2, 'two draftNote uses in the save catch');
  for (const line of uses) {
    assert.match(line, /!r\)/, line.trim());
    assert.doesNotMatch(line, /submitted_at/, line.trim());
  }
});

test('a refused photo still lands on the ID box and returns', () => {
  const branch = submit.slice(submit.indexOf('if (photoRefused)'));
  const body = branch.slice(0, branch.indexOf('return;'));
  assert.match(body, /showErrors\(form, \{ id_photos: tServer\(err\.message\) \}\)/);
});
