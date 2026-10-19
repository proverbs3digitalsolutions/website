'use strict';

// QA round 17, inbox lane (IN): scans of the view source. Frontend-only.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js'), 'utf8');

test('a mode tab press closes the mention list first (#12)', () => {
  assert.match(src, /onmousedown: \(\) => picker\.close\(\),\s*\n\s*onclick: \(\) => \{ setMode\(k\)/);
});

test('a manager is not told to turn automations on (#14)', () => {
  assert.match(src, /canEdit\s*\n?\s*\? "These automatic messages are ready but off/);
  assert.ok(src.includes("'These automatic messages are off until the workspace owner turns them on.'"));
});

test('skip button only when a conversation is selected (#15)', () => {
  assert.match(src, /selected && h\('button', \{ type: 'button', class: 'skip-link'[^\n]*'Skip to conversation'\)/);
});
