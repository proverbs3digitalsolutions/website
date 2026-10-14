'use strict';

// QA round 4, C18 "signup-page consent": the standalone sign-up page (public/js/views/auth.js) checks the
// "I agree" box in the browser before it posts, so an unticked box never sends a request that uses up the
// hourly sign-up limit (#26). The message is the one the server sends, shown under the box. This page has
// no Taglish strings anywhere, so the message stays in English like the rest of the page.
// Static checks on the source, since this is a browser view with no server logic (no database needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auth = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'auth.js'), 'utf8');
const authRoute = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.js'), 'utf8');
// The sign-up view: from signupView to the password recovery screens that follow it.
const signupView = auth.slice(auth.indexOf('export async function signupView'), auth.indexOf('// ---------------------------------------------------------------- password recovery'));
const CONSENT = 'Please accept the Terms of Service and read the Privacy Notice to continue.';

test('sign-up page: an unticked "I agree" box is refused in the browser before the request is sent', () => {
  const post = signupView.indexOf("post('/auth/signup'");
  assert.ok(post > 0, 'the view still posts to /auth/signup');
  const check = signupView.indexOf('!data.accept_privacy');
  assert.ok(check > 0, 'an unticked box is caught on the page');
  assert.ok(check < post, 'the consent check runs before the post');
});

test('sign-up page: the unticked box stops at its own field with the server wording, and the banner is the generic line', () => {
  const check = signupView.indexOf('!data.accept_privacy');
  const refusal = signupView.slice(check, signupView.indexOf("post('/auth/signup'"));
  assert.ok(refusal.includes(`fields: { accept_privacy: '${CONSENT}' }`), 'the consent message is set on the box itself');
  assert.ok(refusal.includes("new ApiError('Please check the highlighted fields.'"), 'the banner names the fields and does not repeat the message');
  assert.equal(auth.split(CONSENT).length - 1, 1, 'the consent message is written once in auth.js');
});

test('sign-up page: the unticked-box message is the same wording the server sends', () => {
  const server = authRoute.match(/accept_privacy: '([^']+)'/);
  assert.ok(server, 'the sign-up route still sends an accept_privacy message');
  assert.equal(server[1], CONSENT);
});
