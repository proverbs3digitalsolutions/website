'use strict';

// QA round 18, inbox lane (IN): the composer box is named for its mode. Frontend-only source scan.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js'), 'utf8');

test('composer box name follows the mode (Internal note / Message to guest)', () => {
  assert.doesNotMatch(src, /placeholder: `Write to \$\{c\.guest_name\}…`, 'aria-label': 'Message' \}/);
  assert.match(src, /body\.setAttribute\('aria-label', mode === 'note' \? 'Internal note' : `Message to \$\{c\.guest_name\}`\)/);
});
