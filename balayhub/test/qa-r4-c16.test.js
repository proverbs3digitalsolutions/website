'use strict';

// QA round 4, C16 "landing": the Get started sign-up step (step 3) checks the "I agree" box in the browser
// before it posts, so an unticked box never sends a request that uses up the hourly sign-up limit (#26).
// A problem is named once: the banner says to check the highlighted fields, and each message sits at its
// own field, so the consent message does not show twice (N6).
// Static checks on the source, since this is a browser view with no server logic (no database needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const landing = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'landing.js'), 'utf8');
const authRoute = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.js'), 'utf8');
// Step 3 of openGetStarted: from its submit button to the Google sign-up block that follows the sheet.
const signupStep = landing.slice(landing.indexOf("const submit = h('button'"), landing.indexOf("import('./auth.js')"));
const CONSENT = 'Please accept the Terms of Service and read the Privacy Notice to continue.';

test('landing: sign-up step 3 checks the "I agree" box in the browser before it posts', () => {
  const post = signupStep.indexOf("post('/auth/signup'");
  assert.ok(post > 0, 'step 3 still posts to /auth/signup');
  const check = signupStep.indexOf('!data.accept_privacy');
  assert.ok(check > 0, 'an unticked box is caught on the page');
  assert.ok(check < post, 'the consent check runs before the post');
  assert.ok(signupStep.includes(`errs.accept_privacy = t('${CONSENT}')`), 'the consent message is set on its own field');
});

test('landing: the unticked-box message is the same wording the server sends', () => {
  const server = authRoute.match(/accept_privacy: '([^']+)'/);
  assert.ok(server, 'the sign-up route still sends an accept_privacy message');
  assert.equal(server[1], CONSENT);
});

test('landing: the consent message and the generic banner have Taglish wording registered', () => {
  assert.ok(landing.includes(`'${CONSENT}': 'Pakisang-ayunan ang Terms of Service at basahin ang Privacy Notice para magpatuloy.'`));
  assert.ok(landing.includes("'Please check the highlighted fields.': 'Pakitingnan ang mga naka-highlight.'"));
});

test('landing: step 3 names each problem once; the consent message is written once and the banner does not repeat field messages', () => {
  assert.equal(signupStep.split(`t('${CONSENT}')`).length - 1, 1, 'the consent message is written once in step 3');
  assert.ok(signupStep.includes("t('Please check the highlighted fields.')"), 'the banner is the generic line');
  assert.doesNotMatch(signupStep, /Object\.values\(errs\)\.join/, 'the client banner does not repeat the field messages');
  assert.doesNotMatch(signupStep, /Object\.values\(fields\)\.join/, 'the server banner does not repeat the field messages');
});
