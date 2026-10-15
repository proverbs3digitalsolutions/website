'use strict';
// QA round 15, lane R1: #2 Channel column folds at medium widths, #3 gate pass link is tap-sized.
// node --test test/qa-r15-r1.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('Channel th/td carry col-md-hide', () => {
  const res = read('public/js/views/reservations.js');
  assert.match(res, /h\('th', \{ class: 'col-sm-hide col-md-hide' \}, 'Channel'\)/);
  assert.match(res, /h\('td', \{ class: 'col-sm-hide col-md-hide' \}, channelBadge\(r\.channel\)\)/);
});

test('listing cell has res-listing and a col-md-show channel line', () => {
  const res = read('public/js/views/reservations.js');
  assert.match(res, /h\('td', \{ class: 'res-listing' \}, h\('div', \{ class: 'res-listing__name' \}, r\.unit_name/);
  // the channel line is a sibling after the clamped name block, not inside it
  assert.ok(res.indexOf("'res-listing__name'") < res.indexOf("'muted small col-md-show'"));
  assert.match(res, /class: 'muted small col-md-show'/);
});

test('gate pass admin-email link has link-tap', () => {
  assert.match(read('public/js/views/gatepass.js'), /h\('a', \{ class: 'link-tap', href: '#\/gatepass-settings' \}, 'Set up the admin email'\)/);
});
