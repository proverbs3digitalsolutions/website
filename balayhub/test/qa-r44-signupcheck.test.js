'use strict';
require('./helpers');

// QA r44 SIGNUPCHECK (ONB44-1 / contract C6, D-105, D-126): the sign-up form's password length, password match and Terms box, and the
// reset form's password match, run in the form's one pass (makeForm's check), so every problem shows on the first save. Before this they
// ran only in onSubmit, which makeForm calls only after its own pass is clean, so they showed on the next save. The onSubmit checks stay
// as backstops. Frontend only: no database. The pure function and the reset check are taken out of the file text and run.
//
// R44_AUTH_FILE (optional) points the checks at another copy of auth.js (used to prove the test red on an older tree).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AUTH = process.env.R44_AUTH_FILE || path.join(__dirname, '..', 'public', 'js', 'views', 'auth.js');
const auth = fs.readFileSync(AUTH, 'utf8');

const CONSENT = 'Please accept the Terms of Service and read the Privacy Notice to continue.';
const LENGTH = 'Password must be at least 8 characters.';
const MISMATCH = 'Passwords do not match.';

// signupProblems(data): the function's text, from its export to its closing brace, run as a plain function.
const start = auth.indexOf('export function signupProblems');
const signupProblems = start < 0 ? null : new Function(`${auth.slice(start, auth.indexOf('\n}', start) + 2).replace('export function', 'function')}; return signupProblems;`)();

// The sign-up view and the reset view, from their export to the section that follows each.
const signupView = auth.slice(auth.indexOf('export async function signupView'), auth.indexOf('// ---------------------------------------------------------------- password recovery'));
const resetView = auth.slice(auth.indexOf('export async function resetView'), auth.indexOf('// ---------------------------------------------------------------- email verification'));

test('sign-up: a short password, a mismatch and an unticked Terms box are all reported by signupProblems in one pass', () => {
  assert.ok(signupProblems, 'signupProblems is exported from auth.js');
  assert.deepEqual(signupProblems({ password: 'abc', confirm_password: 'abd' }), {
    password: LENGTH,
    confirm_password: MISMATCH,
    accept_privacy: CONSENT,
  });
});

test('sign-up: a complete, matching, accepted set gives no problems', () => {
  assert.ok(signupProblems, 'signupProblems is exported from auth.js');
  assert.equal(signupProblems({ password: 'correct horse', confirm_password: 'correct horse', accept_privacy: true }), null);
});

test('sign-up: a blank password is the required check\'s, so it gives no length message and the form keeps its "fill in" line', () => {
  assert.ok(signupProblems, 'signupProblems is exported from auth.js');
  assert.equal(signupProblems({ password: '', confirm_password: '', accept_privacy: true }), null);
});

test('sign-up: a typed confirmation that differs from a blank password is reported at the confirmation box', () => {
  assert.ok(signupProblems, 'signupProblems is exported from auth.js');
  assert.deepEqual(signupProblems({ password: '', confirm_password: 'correct horse', accept_privacy: true }), { confirm_password: MISMATCH });
});

test('sign-up: the form passes signupProblems as its check, and the onSubmit checks stay as backstops', () => {
  const form = signupView.slice(signupView.indexOf('const form = makeForm({'), signupView.indexOf('onSubmit: async (data) => {'));
  assert.ok(form.includes('check: signupProblems,'), 'the checks run in the form\'s one pass');
  assert.ok(signupView.includes(`errs.password = '${LENGTH}'`), 'the length backstop stays in onSubmit');
  assert.ok(signupView.includes(`errs.confirm_password = '${MISMATCH}'`), 'the match backstop stays in onSubmit');
  assert.ok(signupView.includes(`errs.accept_privacy = '${CONSENT}'`), 'the Terms backstop stays in onSubmit');
});

test('reset: a typed confirmation that does not match is checked in the one pass, and a blank one is the required check\'s', () => {
  const m = resetView.match(/check: (\(d\) => \(d\.confirm[^\n]*\)),/);
  assert.ok(m, 'the reset form has its check line');
  const resetCheck = new Function(`return ${m[1]};`)();
  assert.deepEqual(resetCheck({ password: 'correct horse', confirm: 'correct hors' }), { confirm: MISMATCH });
  assert.deepEqual(resetCheck({ password: '', confirm: 'correct horse' }), { confirm: MISMATCH }, 'a blank password box still gets the mismatch at the confirmation box');
  assert.equal(resetCheck({ password: 'correct horse', confirm: 'correct horse' }), null);
  assert.equal(resetCheck({ password: 'correct horse', confirm: '' }), null, 'a blank confirmation is the required check\'s');
  assert.ok(resetView.includes("if (data.password !== data.confirm) throw new ApiError("), 'the onSubmit backstop stays');
});
