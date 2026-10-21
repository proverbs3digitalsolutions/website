'use strict';
require('./helpers');

// QA r34 TOPBAR (D-116): while the card check is due, the account menu must not offer Settings (it only bounces the
// owner back to Confirm your card). My account stays. Source scan of the account menu, comments stripped.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
const src = strip(fs.readFileSync(path.join(__dirname, '../public/js/topbar.js'), 'utf8'));

test('account menu: Settings is hidden while the card check is due; My account is not gated', () => {
  const settings = src.split('\n').find((l) => l.includes("'Settings'"));
  const account = src.split('\n').find((l) => l.includes("'My account'"));
  assert.ok(settings && account);
  assert.match(settings, /!u\.plan\?\.card_check_due/, 'Settings is guarded by !u.plan?.card_check_due');
  assert.match(settings, /u\.role !== 'cleaner'/, 'cleaners still never see Settings');
  assert.doesNotMatch(account, /card_check_due/, 'My account stays');
});
