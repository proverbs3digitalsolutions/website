'use strict';

// Settings and My account (QA round 5, lane C18). The workspace modules select uses short option names, with the
// detail in its hint, so each option fits a 390px phone (O-a). Each device's Sign out button names its device and
// sign-in time, so a screen reader user can tell the buttons apart (#54).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SETTINGS = path.join(__dirname, '../public/js/views/settings.js');
const ACCOUNT = path.join(__dirname, '../public/js/views/account.js');

// The Modules field runs from its field() call to the Save button that follows it.
function modulesField() {
  const src = fs.readFileSync(SETTINGS, 'utf8');
  const start = src.indexOf("field({ name: 'business_type'");
  assert.notEqual(start, -1, 'the business_type field is in settings.js');
  const end = src.indexOf("h('div', null, h('button'", start);
  assert.notEqual(end, -1, 'the field ends before its Save button');
  return src.slice(start, end);
}

// ---------------------------------------------------------------- modules select (O-a)

test('the Modules for this workspace select has short option names', () => {
  const field = modulesField();
  assert.match(field, /\['short_term', 'Short-term stays'\]/);
  assert.match(field, /\['long_term', 'Long-term rentals'\]/);
  assert.match(field, /\['both', 'Both'\]/);
  assert.doesNotMatch(field, /'Short-term stays \(/, 'the detail moved out of the option text');
  assert.doesNotMatch(field, /'Long-term rentals \(/, 'the detail moved out of the option text');
});

test('the detail for each kind of workspace sits in the field hint', () => {
  assert.match(modulesField(), /hint: 'Short-term means per-night stays \(Airbnb, staycations\)\. Long-term means monthly tenants and leases\.'/);
});

// ---------------------------------------------------------------- device sign-out names (#54)

test('each device Sign out button names its device and sign-in time, and starts with the visible words', () => {
  const src = fs.readFileSync(ACCOUNT, 'utf8');
  const btn = src.match(/'aria-label': `(Sign out [^`]*)`, onclick: signOutDevice\(s\)/);
  assert.ok(btn, 'the device Sign out button has an aria-label that begins with "Sign out"');
  assert.match(btn[1], /\$\{s\.device\}/, 'the name includes the device');
  assert.match(btn[1], /\$\{fmtDateTime\(s\.created_at\)\}/, 'the name includes when the device signed in');
});

test('the device Sign out button still uses the same handler and visible text', () => {
  const src = fs.readFileSync(ACCOUNT, 'utf8');
  assert.match(src, /'aria-label': `Sign out [^`]*`, onclick: signOutDevice\(s\)\n?\s*\}, 'Sign out'\)/);
});

// ---------------------------------------------------------------- team rows name their person (same class as #54)

test('each team row button names the person or invitation it acts on', () => {
  const src = fs.readFileSync(SETTINGS, 'utf8');
  assert.match(src, /'aria-label': `Edit access for \$\{m\.full_name\}`/);
  assert.match(src, /'aria-label': `Remove \$\{m\.full_name\}`/);
  assert.match(src, /'aria-label': `New link for \$\{i\.email\}`/);
  assert.match(src, /'aria-label': `Revoke invitation for \$\{i\.email\}`/);
});
