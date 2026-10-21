'use strict';
// QA round 16 (BC): coupon box markup/a11y/wording and the comped Plan & billing card (source scans).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bc = fs.readFileSync(path.join(__dirname, '../public/js/views/billingcoupon.js'), 'utf8');
const st = fs.readFileSync(path.join(__dirname, '../public/js/views/settings.js'), 'utf8');

test('Apply sits in a coupon-row beside the code box', () => assert.match(bc, /class: 'coupon-row' \}, input,/));
test('setMsg ties the error to the code box and clears it', () => {
  assert.match(bc, /id: 'coupon-code-err'/);
  assert.match(bc, /setAttribute\('aria-invalid', 'true'\)[\s\S]*setAttribute\('aria-describedby', 'coupon-code-err'\)/);
  assert.match(bc, /removeAttribute\('aria-invalid'\)[\s\S]*removeAttribute\('aria-describedby'\)/);
});
test('banner names the card charge of a free coupon', () => {
  assert.match(bc, /q\.card_only && q\.min_charge_applied && q\.coupon\.kind === 'free'/);
  assert.match(bc, /You pay \$\{money\(q\.amount\)\} once by card\./);
});
test('live box no longer repeats "Applies every month."', () => assert.doesNotMatch(bc, /Applies every month/));
test('comped workspaces see the sentence, not Pay now', () => {
  assert.match(st, /p\.plan === 'comped' \? h\('p', \{ class: 'muted' \}, 'Your workspace is on a complimentary plan, so there is nothing to pay\.'\)\s*: p\.reason === 'deleting' \? null\s*: bill\.online \? payOnline/);
});
