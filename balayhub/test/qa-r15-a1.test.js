'use strict';

// QA round 15, lane A1: account h1, dashboard count link size, verify toast in Tagalog (source scans).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public/js/views', f), 'utf8');

test('#19 My account page: h1 is "My account", the name is the profile card h2', () => {
  const s = read('account.js');
  assert.match(s, /h\('h1', null, 'My account'\)/);
  assert.match(s, /h\('h2', \{ class: 'acct-hero__name' \}, u\.full_name\)/);
  assert.doesNotMatch(s, /h\('h1', null, u\.full_name\)/);
});

test('K4 dashboard Open repairs count link is a standalone link-tap', () => {
  assert.ok(read('dashboard.js').includes("h('a', { class: 'link-tap', href: '#/maintenance' }, String(d.open_maintenance_count))"));
});

test('#31 verify toast always goes through t()', () => {
  const s = read('auth.js');
  assert.ok(s.includes("toast(t('Email verified.'));"));
  assert.doesNotMatch(s, /toast\(state\.user \?/);
});
