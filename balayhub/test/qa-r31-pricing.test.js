'use strict';

// QA round 31, lane PRICING (pricing.js): a manager's Listing (Add a season) and Applies to (Add a pricing rule) pickers start on
// "Select…", never on the first listing, so a season or rule saved without a look cannot land on a listing nobody chose (D-113).
// The owner keeps "All listings" as its first, chosen option. Source scans, as qa-r22-pricing and qa-r29-season do.

require('./helpers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PRICING = fs.readFileSync(path.join(__dirname, '../public/js/views/pricing.js'), 'utf8');
const UI = fs.readFileSync(path.join(__dirname, '../public/js/ui.js'), 'utf8');
const count = (text) => PRICING.split(text).length - 1;

test('PRC-1: both record pickers (Listing on a season, Applies to on a rule) take the owner-only placeholder rule', () => {
  const placeholders = [...PRICING.matchAll(/name: 'unit_id', label: '(?:Listing|Applies to)',[^\n]*placeholderOption: ([^,\n]+),/g)].map((m) => m[1]);
  assert.deepEqual(placeholders, ['isOwner ? false : undefined', 'isOwner ? false : undefined']);
});

test('PRC-1: both record pickers stay required for a manager, so the existing "is required" check names the box', () => {
  const required = [...PRICING.matchAll(/name: 'unit_id', label: '(?:Listing|Applies to)', type: 'select', required: ([^,\n]+),/g)].map((m) => m[1]);
  assert.deepEqual(required, ['!isOwner', '!isOwner']);
});

test('PRC-1: the owner keeps "All listings" as the first, chosen option of both pickers', () => {
  assert.equal(count("(isOwner ? [['', 'All listings']] : [])"), 2);
});

test('PRC-1: the reason sits above the first picker, in the words the decision gives', () => {
  const note = '// A manager has no "All listings": the box starts on "Select…", never on a listing nobody chose (D-113).';
  assert.equal(count(note), 1);
  assert.ok(PRICING.indexOf(note) < PRICING.indexOf("name: 'unit_id', label: 'Listing'"));
});

test('PRC-1: the price-mode and rule-kind selects keep their defaults (no "Select…" placeholder)', () => {
  const names = [...PRICING.matchAll(/name: '(\w+)'[^\n]*placeholderOption: false/g)].map((m) => m[1]);
  assert.deepEqual(names, ['price_mode', 'kind']);
});

test('PRC-1: the edit form still disables its scope picker, so the saved value is shown and not chosen again', () => {
  assert.equal(count("scopeField.querySelector('select').disabled = true;"), 1);
});

test('PRC-1: ui.js shows the "Select…" placeholder for any select that does not set placeholderOption to false', () => {
  assert.match(UI, /placeholderOption !== false/);
});
