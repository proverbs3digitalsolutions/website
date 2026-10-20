// QA r23 LANDING (ONB-2): in the Get started sheet, typing in a field clears that field's message, its mark and, once none is left, the banner.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/landing.js'), 'utf8');
const sheet = src.slice(src.indexOf('export function openGetStarted'), src.indexOf('// ---------------------------------------------------------------- page'));

test('box listens to input and change and clears the field it came from', () => {
  assert.match(sheet, /for \(const ev of \['input', 'change'\]\) box\.addEventListener\(ev,/);
  assert.match(sheet, /closest\?\.\('\[data-field\]'\)/);
  assert.match(sheet, /removeAttribute\('aria-invalid'\)/);
});
test('banner is cleared once no field message is left', () => {
  assert.match(sheet, /\.gs-form-error/);
  assert.match(sheet, /\[data-field\] \.error'\)\]\.some\(/);
});
test('step 3 banner holder carries the class the listener clears', () => {
  assert.match(sheet, /const formError = h\('div', \{ class: 'gs-form-error' \}\)/);
});
