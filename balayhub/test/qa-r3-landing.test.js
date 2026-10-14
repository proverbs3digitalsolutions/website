// QA round 3, lane C23 "landing": the Get started sheet's sign-up step (step 3). It checks email and
// password on the page before sending, never names a confirm-password field the sheet does not have,
// and its step row writes the word "Step" once (in the accessible label), not under every number.
// Static checks on the source, since this is a browser view with no server logic (no database needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const landing = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'landing.js'), 'utf8');
// Step 3 of openGetStarted: from its submit button to the Google sign-up block that follows the sheet.
const signupStep = landing.slice(landing.indexOf("const submit = h('button'"), landing.indexOf("import('./auth.js')"));

test('landing: Get started step 3 checks email and password on the page before it posts to sign-up', () => {
  assert.match(landing, /import \{[^}]*\btServer\b[^}]*\} from '\.\.\/i18n\.js'/, 'tServer is imported for the server-matching messages');
  const post = signupStep.indexOf("post('/auth/signup'");
  assert.ok(post > 0, 'step 3 still posts to /auth/signup');
  for (const msg of ["tServer('Email is required.')", "tServer('Enter a valid email address.')", "tServer('Password is required.')", "t('Password must be at least 8 characters.')"]) {
    const at = signupStep.indexOf(msg);
    assert.ok(at >= 0, `missing check: ${msg}`);
    assert.ok(at < post, `check runs before the post: ${msg}`);
  }
});

test('landing: the Taglish wording for the new password message is registered', () => {
  assert.ok(landing.includes("'Password must be at least 8 characters.': 'Dapat hindi bababa sa 8 characters ang password.'"));
});

test('landing: the step-3 banner drops the confirm-password message, since this sheet has no confirm box', () => {
  assert.match(signupStep, /delete\s+\w+\.confirm_password/, 'the server confirm message is removed from the fields before the banner is built');
  assert.doesNotMatch(signupStep, /t\('Confirm password/, 'no confirm-password wording is written on this sheet');
  // The request still carries confirm_password (the server requires it); only the displayed message is dropped.
  assert.match(signupStep, /confirm_password: data\.password/);
});

test('landing: the step row writes the word "Step" once, in the accessible label, not under each number', () => {
  assert.doesNotMatch(landing, /h\('small', null, t\('Step'\)\)/);
  assert.equal((landing.match(/t\('Step'\)/g) || []).length, 1, 'only the aria-label uses t(\'Step\')');
  assert.match(landing, /'aria-label': `\$\{t\('Step'\)\} \$\{step\} \/ 3`/, 'the accessible label stays "Step 1 / 3"');
});

test('landing: the sign-up sheet does not use window.alert, confirm or prompt', () => {
  assert.doesNotMatch(landing, /window\.(alert|confirm|prompt)\(/);
});
