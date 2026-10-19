'use strict';
// SEV2 (DESIGN-BRIEF s22, D-95): standalone links on phones are 44px tall via .link-tap.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('group detail room-listing link carries link-tap', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/groups.js'), 'utf8');
  assert.match(src, /h\('a', \{ class: 'link-tap', href: `#\/reservations\/\$\{r\.booking_id\}`/);
});
