'use strict';
require('./helpers');

// QA round 30, GST-1 and GST-2: the guest proof form checks the amount and the file in one pass, says the
// file problem on the file box, focuses the first wrong field, and checks the file's content before saving.
// Source scan only: no server or database needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pay = fs.readFileSync(path.join(__dirname, '../public/js/views/pay.js'), 'utf8');
const form = pay.slice(pay.indexOf('function proofForm('));
const submit = form.slice(form.indexOf("addEventListener('submit'"));
const pass = submit.slice(submit.indexOf('const problems'), submit.indexOf('submit.disabled = true'));

test('the file box is a field with its own message line', () => {
  assert.match(form, /dataset: \{ field: 'proof_file' \}/);
  assert.match(form, /id: 'proof-file-err'/);
  assert.match(form, /'aria-describedby': 'proof-file-err'/);
});

test('the amount and file problems are collected in one pass, with no return between them', () => {
  assert.ok(pass.includes('problems.amount') && pass.includes('problems.proof_file'));
  assert.ok(!/return/.test(pass.slice(0, pass.indexOf('showErrors'))), 'no early return before showErrors');
  assert.equal(pass.split('showErrors(form, problems)').length - 1, 1);
});

test('the four file sentences go to problems.proof_file', () => {
  for (const s of ['Choose a screenshot or receipt.', 'This file is empty. Choose the file again.', 'Upload a JPG, PNG, WEBP or PDF file up to 10 MB.']) {
    assert.ok(pass.includes(`problems.proof_file = t('${s}')`), s);
  }
  assert.match(pass, /problems\.proof_file = t\(bad\)/);
});

test('the content is checked before the proof is saved', () => {
  assert.match(pay, /import \{[^}]*fileContentError[^}]*\} from '\.\.\/api\.js'/);
  assert.ok(submit.indexOf('await fileContentError(file)') > 0);
  assert.ok(submit.indexOf('await fileContentError(file)') < submit.indexOf("post(`/public/pay/"));
});

test('a refusal after the proof was saved focuses the file box', () => {
  assert.match(submit, /const atFile = Boolean\(proofId\);/);
  assert.ok(submit.indexOf('const atFile') < submit.indexOf('await withdraw()'));
  assert.match(submit, /if \(atFile && !err\.offline\) photo\.focus\(\);/);
});

test('editing a field clears its message', () => {
  assert.match(form, /form\.addEventListener\('input', clearField\)/);
  assert.match(form, /form\.addEventListener\('change', clearField\)/);
});

test('a blank add-on press focuses the first add-on control', () => {
  assert.match(pay, /Choose at least one extra\.'\)\)\); card\.querySelector\('\.gp-addons input'\)\?\.focus\(\); return;/);
});

test('Taglish line exists and the empty-file check stays single', () => {
  assert.match(pay, /"This file isn't a real PDF, JPG, PNG or WEBP\. Choose the file again\.":\s*'Hindi totoong PDF/);
  assert.equal(form.split('!file.size').length - 1, 1);
});
