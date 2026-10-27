'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validate } = require('../src/lib/validate');

// settings.js needs the browser shell, so the pure pieces are pulled out of its source (as qa-r19-st does).
const src = fs.readFileSync(path.join(__dirname, '../public/js/views/settings.js'), 'utf8');
const money = (v) => `₱${v}`;

function loadPasswordChangeProblems() {
  const fn = src.match(/^export function passwordChangeProblems\(d\) \{[\s\S]*?\n\}$/m);
  assert.ok(fn, 'settings.js exports passwordChangeProblems(d)');
  return new Function(`${fn[0].replace(/^export /, '')}; return passwordChangeProblems;`)();
}

// MINUTEWORD (D-128): a count of one reads "1 minute", as every other wait in BalayHub does.
test('a payment waiting at the bank counts its minutes right: 1 minute, 2 minutes, 12 minutes, and 0', () => {
  const block = src.match(/^export (const pendingText = [\s\S]*?\));$/m);
  assert.ok(block, 'settings.js exports pendingText');
  const pendingText = new Function(`${block[1]}; return pendingText;`)();
  const pp = (minutes_left) => ({ amount: '499.50', minutes_left });
  assert.equal(pendingText(pp(1), money), 'A payment of ₱499.50 is waiting for your bank. Finish it in the bank window, or try again in 1 minute.');
  assert.equal(pendingText(pp(2), money), 'A payment of ₱499.50 is waiting for your bank. Finish it in the bank window, or try again in 2 minutes.');
  assert.equal(pendingText(pp(12), money), 'A payment of ₱499.50 is waiting for your bank. Finish it in the bank window, or try again in 12 minutes.');
  assert.equal(pendingText(pp(0), money), 'A payment of ₱499.50 is still waiting for your bank. Pay another way, or try again later.');
});

// PWCHECK (D-128): the new password's length and the match are checked in the form's one pass, in the server's words.
test('Change password names a short new password and a mismatched confirmation in one pass; blank boxes are the required check\'s', () => {
  const passwordChangeProblems = loadPasswordChangeProblems();
  assert.deepEqual(passwordChangeProblems({ current_password: 'x', new_password: 'abc', confirm_password: 'abd' }), {
    new_password: 'New password must be at least 8 characters.',
    confirm_password: 'The passwords do not match.',
  });
  assert.deepEqual(passwordChangeProblems({ new_password: 'qa-r46-long-1', confirm_password: 'qa-r46-long-2' }), { confirm_password: 'The passwords do not match.' });
  assert.deepEqual(passwordChangeProblems({ new_password: 'abcdefg', confirm_password: 'abcdefg' }), { new_password: 'New password must be at least 8 characters.' });
  assert.equal(passwordChangeProblems({ current_password: 'x', new_password: 'qa-r46-match-1', confirm_password: 'qa-r46-match-1' }), null);
  assert.equal(passwordChangeProblems({ current_password: 'x', new_password: 'abcdefgh', confirm_password: 'abcdefgh' }), null);
  assert.equal(passwordChangeProblems({ current_password: '', new_password: '', confirm_password: '' }), null);
});

test('changePassword hands its form the check, so the messages show with the required ones in the same save', () => {
  const cp = src.match(/^export function changePassword\(\) \{[\s\S]*?\n\}$/m);
  assert.ok(cp, 'settings.js exports changePassword()');
  assert.match(cp[0], /^    check: passwordChangeProblems,$/m);
  assert.match(cp[0], /^    submitText: 'Change password',$/m);
});

test('the two messages are the server\'s own words (POST /auth/change-password and validate)', () => {
  const passwordChangeProblems = loadPasswordChangeProblems();
  const account = fs.readFileSync(path.join(__dirname, '../src/routes/account.js'), 'utf8');
  assert.ok(account.includes("'The passwords do not match.'"), 'account.js names the mismatch in the same words');
  const spec = { new_password: { type: 'password', required: true, label: 'New password' } };
  assert.ok(account.includes("new_password: { type: 'password', required: true, label: 'New password' }"), 'account.js uses this password rule');
  let caught = null;
  try { validate({ new_password: 'abc' }, spec); } catch (e) { caught = e; }
  const serverLength = caught?.extra?.fields?.new_password;
  assert.equal(serverLength, 'New password must be at least 8 characters.');
  assert.equal(passwordChangeProblems({ new_password: 'abc', confirm_password: 'abd' }).new_password, serverLength);
});
