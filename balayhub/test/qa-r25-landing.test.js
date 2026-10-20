// QA r25 LANDING (ONB-1): Get started step 2 shows the same summary line as step 3 when fields are missing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/landing.js'), 'utf8');
const sheet = src.slice(src.indexOf('export function openGetStarted'), src.indexOf('// ---------------------------------------------------------------- page'));
const step2 = sheet.slice(sheet.indexOf('} else if (step === 2) {'), sheet.indexOf('} else {\n      const submit'));

test('step 2 has a banner holder the clearing rule can find', () => {
  assert.match(step2, /const formError = h\('div', \{ class: 'gs-form-error' \}\)/);
});
test('step 2 error path sets the banner, then shows the field messages', () => {
  assert.match(step2, /formError\.replaceChildren\(h\('div', \{ class: 'alert alert--error', role: 'alert' \}, t\('Please check the highlighted fields\.'\)\)\)/);
  assert.match(step2, /showErrors\(errs\);/);
});
test('step 2 clears the banner on a fresh submit and renders it above the fields', () => {
  assert.match(step2, /formError\.replaceChildren\(\)/);
  assert.ok(step2.indexOf('formError,') > step2.indexOf("h('form'"));
  assert.ok(step2.indexOf('formError,') < step2.indexOf("input('first_name'"));
});
