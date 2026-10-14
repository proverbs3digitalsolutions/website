'use strict';

// QA round 8, lane C23 "signup-setup": Get started answers belong to the person who typed them (#49), the
// "Password updated" note goes on the first log-in attempt (#53), sign-up shows every client problem at once (#54),
// the Get started fields tie their messages to the field (K23), and the long-term option is in Taglish (N2).
// Static checks on the source plus the pure helper pulled out of auth.js (a browser module, no database needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', f), 'utf8');
const auth = read('auth.js');
const landing = read('landing.js');

const fnSrc = auth.slice(auth.indexOf('const SETUP_MAX_AGE'), auth.indexOf('export async function setupView'))
  .replace('export function', 'function');
const savedSetupFor = new Function(`${fnSrc}; return savedSetupFor;`)();
const T0 = Date.UTC(2026, 9, 14, 12, 0, 0);
const answers = { email: 'a@x.ph', name: 'Santos', business_type: 'both', units_band: '2-5', saved_at: T0 };

test('#49 an email-tied answer set is used for that email only (case aside)', () => {
  assert.equal(savedSetupFor(answers, 'a@x.ph', T0 + 99 * 60000), answers);
  assert.equal(savedSetupFor(answers, 'A@X.ph', T0), answers);
  assert.equal(savedSetupFor(answers, 'b@x.ph', T0), null);
  assert.equal(savedSetupFor(answers, undefined, T0), null);
});

test('#49 Google answers (email null) live 30 minutes', () => {
  const g = { ...answers, email: null };
  assert.equal(savedSetupFor(g, 'any@x.ph', T0 + 30 * 60000), g);
  assert.equal(savedSetupFor(g, 'any@x.ph', T0 + 30 * 60000 + 1), null);
  assert.equal(savedSetupFor({ ...g, saved_at: undefined }, 'any@x.ph', T0), null);
  assert.equal(savedSetupFor(null, 'a@x.ph', T0), null);
  assert.equal(savedSetupFor({ email: 'a@x.ph' }, 'a@x.ph', T0), null, 'no name, nothing to fill');
});

test('#49 setupView never posts before a submit, drops answers that are not the person\'s, and offers "Use a different account"', () => {
  const view = auth.slice(auth.indexOf('export async function setupView'));
  const firstPost = view.indexOf("post('/workspace'");
  assert.ok(view.indexOf('onSubmit:') > 0 && firstPost > view.indexOf('onSubmit:'), 'the only workspace post is inside onSubmit');
  assert.equal(view.split("post('/workspace'").length - 1, 1);
  assert.match(view, /savedSetupFor\(stored, state\.user\.email\)/);
  assert.match(view, /if \(stored && !saved\)[^\n]*removeItem\('bh-setup'\)/);
  assert.match(view, /removeItem\('bh-setup'\)[\s\S]*post\('\/auth\/logout'\)[\s\S]*Use a different account/);
  const pending = auth.slice(auth.indexOf('export async function verifyPendingView'), auth.indexOf('// ---------------------------------------------------------------- workspace setup'));
  assert.match(pending, /removeItem\('bh-setup'\)[\s\S]*Use a different account/);
});

test('#49 landing saves the email (or null for Google) and a time, and never the password', () => {
  assert.match(landing, /email: email \? email\.toLowerCase\(\) : null/);
  assert.match(landing, /saved_at: Date\.now\(\)/);
  assert.match(landing, /saveSetup\(data\.email\)/);
  assert.match(landing, /saveSetup\(null\)/);
  const saver = landing.slice(landing.indexOf('const saveSetup'), landing.indexOf('const read = '));
  assert.ok(!/password/.test(saver));
  assert.equal(landing.split("setItem('bh-setup'").length - 1, 1, 'one writer');
});

test('#53 the reset note is removed on the first submit and reset=1 leaves the address', () => {
  const login = auth.slice(auth.indexOf('export async function loginView'), auth.indexOf('// ---------------------------------------------------------------- Screen 2: Sign up'));
  assert.match(login, /let resetNote = query\.reset/);
  const submit = login.slice(login.indexOf('onSubmit:'));
  assert.ok(submit.indexOf('resetNote.remove()') > 0 && submit.indexOf('resetNote.remove()') < submit.indexOf("post('/auth/login'"));
  assert.match(submit, /history\.replaceState\(null, '', '#\/login'\)/);
});

test('#54 sign-up gathers length, mismatch and terms in one pass', () => {
  const view = auth.slice(auth.indexOf('export async function signupView'), auth.indexOf("post('/auth/signup'"));
  const a = view.indexOf('const errs = {}');
  assert.ok(a > 0);
  for (const key of ['errs.password =', 'errs.confirm_password =', 'errs.accept_privacy =']) assert.ok(view.indexOf(key) > a, key);
  assert.equal((view.match(/throw new ApiError/g) || []).length, 1, 'a single throw, after every check');
});

test('K23 Get started messages set aria-invalid and aria-describedby on the field', () => {
  const fn = landing.slice(landing.indexOf('const showErrors = '), landing.indexOf('const saveSetup'));
  assert.match(fn, /setAttribute\('aria-invalid', 'true'\)/);
  assert.match(fn, /setAttribute\('aria-describedby'/);
  assert.match(fn, /removeAttribute\('aria-invalid'\)/);
});

test('N2 the long-term option has a real Taglish entry', () => {
  assert.match(landing, /'Long-term rentals \(monthly tenants\)': 'Pangmatagalang upa \(buwanan\)'/);
});
