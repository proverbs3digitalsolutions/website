'use strict';
require('./helpers');

// Round 34 (CHECKIN, GST-1, D-116): the check-in ID photo box is named by its own visible label, never by an aria-label.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/checkin.js'), 'utf8');

test('the ID photos file box has an id and no aria-label', () => {
  const line = src.split('\n').find((l) => l.includes("type: 'file'"));
  assert.ok(line, 'file input present');
  assert.match(line, /id: 'ci-id-photos'/);
  assert.doesNotMatch(line, /aria-label/);
});

test('a visible label for the box sits inside the id_photos field before the box', () => {
  const field = src.slice(src.indexOf("dataset: { field: 'id_photos' }"));
  const label = field.indexOf("h('label', { for: 'ci-id-photos' }, t('ID photos'))");
  assert.ok(label > -1, 'label linked by for with the ID photos text');
  assert.ok(label < field.indexOf('photos, progress'), 'label comes before the box');
});
