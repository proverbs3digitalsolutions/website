'use strict';
// Round 21 RES: a date clash says it once (boxes marked, no repeated text); the confirmation tick follows the email box.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/reservations.js'), 'utf8');

test('date clash blanks both date field texts on the new and edit forms', () => {
  assert.match(src, /err\?\.code === 'DATES_TAKEN'\) err\.fields = \{ check_in: '', check_out: '' \}/);
  assert.match(src, /post\('\/reservations', data\)\.catch\(\(err\) => \{ throw dateClashOnce\(err\)/);
  assert.match(src, /\}\)\(\)\.catch\(\(err\) => \{ throw dateClashOnce\(err\); \}\),/);
});

test('confirmation checkbox is off and disabled until an email is typed', () => {
  assert.match(src, /conf\.disabled = !has;/);
  assert.match(src, /conf\.checked = has && !hostUnticked;/);
  assert.match(src, /mail\.addEventListener\('input', syncConf\)/);
  assert.match(src, /conf\.addEventListener\('change', \(\) => \{ hostUnticked = !conf\.checked; \}\)/);
});
