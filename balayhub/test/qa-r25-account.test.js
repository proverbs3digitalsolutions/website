'use strict';

// QA round 25 (ACCOUNT, CARD-1): while the card check is due (APP-FLOW 5.10) My account's Plan line reads
// "Waiting for your card check" and the only plan button is Confirm your card; no Choose a plan, no Manage team.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/account.js'), 'utf8');

// planLine is a pure function: pull it out of the source and run it.
const start = src.indexOf('function planLine');
const body = src.slice(start, src.indexOf('\n}\n', start) + 3);
const planLine = new Function('fmtDate', `${body}; return planLine;`)((d) => d);

test('the card-due plan line says the card check is pending, not a trial', () => {
  assert.equal(planLine({ plan: 'trial', name: 'Free trial', trial_days_left: 14, read_only: true, reason: 'card_check', card_check_due: true }), 'Waiting for your card check');
});

test('other plan lines are unchanged', () => {
  assert.equal(planLine({ plan: 'trial', trial_days_left: 14 }), 'Free trial · 14 days left');
  assert.equal(planLine({ is_demo: true }), 'Demo workspace (view only)');
});

test('Choose a plan and Manage team are not drawn while card-due; Confirm your card is, linking to #/confirm-card', () => {
  const btns = src.slice(src.indexOf('isOwner && cardDue'), src.indexOf("!isOwner && h('p'"));
  assert.match(src, /const cardDue = Boolean\(w\?\.plan\?\.card_check_due\)/);
  assert.match(btns, /cardDue/);
  assert.match(btns, /Confirm your card/);
  assert.match(btns, /#\/confirm-card/);
  assert.match(btns, /isOwner && !cardDue && h\('a'[^]*Choose a plan/);
  assert.match(btns, /isOwner && !cardDue && h\('a'[^]*Manage team/);
});
