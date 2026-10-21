'use strict';

// QA round 34, lane HELPFILE (GST-1 audit). The ticket reply file box is named by its visible label "Attach a file" (D-116),
// never an aria-label. Frontend-only: source scan.

require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'help.js'), 'utf8');
const line = src.split('\n').find((l) => l.includes('const attach = h(')) || '';

test('reply file box: id, no aria-label, a linked visible label, error link kept', () => {
  assert.match(line, /id: 'reply-attach'/);
  assert.doesNotMatch(line, /aria-label/);
  assert.match(line, /'aria-describedby': 'reply-attach-err'/);
  assert.match(src, /h\('label', \{ for: 'reply-attach' \}, 'Attach a file'\), attach, attachError\)/);
});
