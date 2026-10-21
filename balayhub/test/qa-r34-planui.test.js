'use strict';
require('./helpers');

// QA round 34 (PLANUI): a workspace scheduled for deletion shows the deletion sentence, no pay controls (D-116).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/settings.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
const SENTENCE = 'This workspace is scheduled for deletion, so plan payments are turned off. Cancel the deletion first, then pay.';
const planCard = src.slice(src.indexOf('export async function planCard'), src.indexOf('export function cardBlock'));
const payOnline = src.slice(src.indexOf('export function payOnline'), src.indexOf('function guestLanguageCard'));

test('the server sentence is used word for word', () => {
  assert.ok(src.includes(`const DELETING_PAY = '${SENTENCE}';`));
});

test('status checks the deleting reason before read_only', () => {
  const s = planCard.slice(planCard.indexOf('const status ='));
  assert.ok(s.indexOf("p.reason === 'deleting'") !== -1);
  assert.ok(s.indexOf("p.reason === 'deleting'") < s.indexOf('p.read_only'));
  assert.match(s, /'alert alert--error' \}, DELETING_PAY\)/);
});

test('payOnline and the plain-contact block are not reached while deleting', () => {
  assert.match(planCard, /p\.reason === 'deleting' \? null\s*:\s*bill\.online \? payOnline\(/);
});

test('both payOnline catches redraw on DELETION_SCHEDULED', () => {
  const hits = payOnline.match(/err\.code === 'DELETION_SCHEDULED'\) \{ await refreshUser\(\); rerender\(\); return; \}/g) || [];
  assert.equal(hits.length, 2);
});
