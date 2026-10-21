'use strict';
// Channels dialog: 'Connecting…' is set only when a request really starts, never before the 'Save it anyway?' question.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/listings.js'), 'utf8');
const block = src.slice(src.indexOf("addForm.addEventListener('submit'"));
const handler = block.slice(0, block.indexOf('const m = openModal'));

test('Connect calendar is not busy before the question is answered', () => {
  const lines = handler.split('\n');
  const idx = (re) => lines.findIndex((l) => re.test(l));
  const dialog = idx(/confirmDialog\(\{ title: 'Check the calendar link'/);
  assert.ok(dialog > 0);
  // Nothing before the first post may set the busy label inline.
  assert.equal(idx(/btn\.setAttribute\('aria-disabled', 'true'\); btn\.textContent = 'Connecting…'/), idx(/const busy = /));
  // The button is reset before the question opens, and busy again only after Save anyway.
  const reset = idx(/btn\.removeAttribute\('aria-disabled'\); btn\.textContent = 'Connect calendar';/);
  assert.ok(reset > 0 && reset < dialog, 'button restored before the question');
  const busyCalls = lines.map((l, i) => (/^\s*busy\(\);/.test(l) ? i : -1)).filter((i) => i >= 0);
  assert.equal(busyCalls.length, 2);
  assert.ok(busyCalls[1] > dialog, 'second busy() comes after the question');
});
