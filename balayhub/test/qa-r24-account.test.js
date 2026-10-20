'use strict';

// QA round 24 (ACCOUNT, CARRY-N1): a monthly-rental owner has no alert types yet (every type is a stay type),
// so My account > Preferences shows no "Turn on" link, only "Not available yet for monthly rentals".
// DECISIONS line 596 / APP-FLOW line 833. "On · manage" stays when a device is already on.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/account.js'), 'utf8');
const row = src.slice(src.indexOf("'Notifications on this device'"), src.indexOf("'Notifications on this device'") + 900);

test('the Preferences row has a long-term branch with the muted note', () => {
  assert.match(row, /business_type === 'long_term'/);
  assert.match(row, /Not available yet for monthly rentals/);
  assert.match(row, /class: 'muted'/);
});

test('the muted note shows only for a long-term workspace with no device on; a device already on keeps On · manage', () => {
  assert.match(row, /business_type === 'long_term' && !u\.notifications_on/);
  const note = row.slice(row.indexOf('Not available yet'));
  assert.match(note, /u\.notifications_on \? 'On · manage'/);
});

test('other workspaces still get Turn on or On · manage', () => {
  assert.match(row, /u\.notifications_on \? 'On · manage' : 'Turn on'/);
});
