'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/settings.js'), 'utf8');

test('both Pay handlers treat PAYMENT_IN_PROGRESS like PAYMENT_RECEIVED: refresh and redraw', () => {
  assert.equal((src.match(/err\.code === 'PAYMENT_IN_PROGRESS'\) \{ carriedNotice = err\.message; carriedUnlessWaiting = true; carriedSentPaidUntil = bill\.paid_until \?\? null; await refreshUser\(\); rerender\(\); return; \}/g) || []).length, 2);
  assert.equal((src.match(/err\.code === 'PAYMENT_RECEIVED'\) \{ carriedNotice/g) || []).length, 2);
});

test('the carried notice is dropped when the redrawn billing has a waiting payment', () => {
  assert.match(src, /billWaiting = !!bill\.pending_payment/);
  assert.match(src, /if \(unlessWaiting && billingNotice === carriedEl\) \{\s*(?:\/\/[^\n]*\s*)?if \(billWaiting\) billingNotice = null;/);
  // the drop happens before the notice is placed on the page
  assert.ok(src.indexOf('else billingNotice = null;\n  }\n  el.replaceChildren') > 0);
});

test('Direct booking card: None yet text with a Go to Listings link', () => {
  assert.match(src, /None yet: on Listings, press Edit and tick "Show this listing on my booking page"\./);
  assert.match(src, /href: '#\/listings' \}, 'Go to Listings'/);
});
