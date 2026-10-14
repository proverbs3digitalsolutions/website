'use strict';

// QA round 3, guest#5: a proof whose screenshot is refused must not stay in the host's queue with no
// screenshot and the amount locked. The guest's page takes the proof back (DELETE, contract from C12)
// so the details can be corrected and sent again. Source scan only: no server or database needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pay = fs.readFileSync(path.join(__dirname, '../public/js/views/pay.js'), 'utf8');
// proofForm is the last function in the file, so everything from its declaration on belongs to it.
const form = pay.slice(pay.indexOf('function proofForm('));

test('a refused screenshot takes the saved proof back with DELETE on the proof', () => {
  assert.match(form, /api\('DELETE',\s*`\/public\/pay\/\$\{encodeURIComponent\(token\)\}\/proofs\/\$\{encodeURIComponent\(proofId\)\}`/);
});

test('the withdrawal runs when the screenshot step fails, and then unlocks the details and clears the file', () => {
  const catchBlock = form.slice(form.indexOf('} catch (err) {'));
  assert.match(catchBlock, /withdraw\(\)/, 'the catch for the screenshot step withdraws the proof');
  assert.match(form, /proofId = null;/, 'the next send saves the details again');
  assert.match(form, /el\.disabled = false;/, 'the detail fields are unlocked again');
  assert.match(form, /photo\.value = '';/, 'the refused file is cleared so the guest chooses another');
});

test('the retry message says what to do, in English and Taglish', () => {
  assert.match(form, /Choose a different file and send again\./);
  assert.match(pay, /^\s*'Choose a different file and send again\.':\s*'[^']+',/m, 'has a Taglish translation');
});

test('when the withdrawal fails, the details stay locked as before', () => {
  assert.match(form, /catch \{\s*return false;\s*\}/, 'a failed DELETE returns false and changes nothing');
});
