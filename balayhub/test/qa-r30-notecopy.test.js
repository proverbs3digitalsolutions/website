'use strict';

// QA round 30, fix lane NOTECOPY (INB-2, wording only). An empty internal note says "Write a note first.";
// an empty guest message keeps "Write a message first."; the box still takes focus and the send stops before any save.
// The composer is built with h() and needs a browser, so these checks read the source (as qa-r14-i1 does). No database.
require('./helpers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const INBOX_SRC = read('public/js/views/inbox.js');
const HELP_SRC = read('public/js/views/help.js');

// The composer's empty-box check, one line in the send handler.
const EMPTY_CHECK = INBOX_SRC.split('\n').find((l) => l.includes('if (!body.value.trim())') && l.includes('err.textContent'));
// The send handler, from the form's submit to the busy flag that follows the confirm dialogs.
const SEND = INBOX_SRC.slice(INBOX_SRC.indexOf('onsubmit: async (e) => {'), INBOX_SRC.indexOf('busy = true;', INBOX_SRC.indexOf('onsubmit: async (e) => {')));

test('an empty internal note says "Write a note first."; a guest message keeps "Write a message first."', () => {
  assert.ok(EMPTY_CHECK, 'the empty-box check is on one line');
  assert.match(
    EMPTY_CHECK,
    /err\.textContent = mode === 'note' \? 'Write a note first\.' : 'Write a message first\.';/,
  );
});

test('the empty-box check still focuses the box and stops before anything is saved', () => {
  assert.match(EMPTY_CHECK, /body\.focus\(\); return; \}$/);
  assert.ok(SEND.includes(EMPTY_CHECK), 'the check is inside the send handler');
  assert.ok(SEND.indexOf(EMPTY_CHECK) < SEND.indexOf('mode === \'message\' && /@'), 'the check runs before the mention and template checks');
});

test('the support-queue reply keeps "Write a message first." (it is a message)', () => {
  assert.match(HELP_SRC, /toast\('Write a message first\.', 'error'\)/);
});
