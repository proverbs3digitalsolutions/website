'use strict';

// QA round 14, fix lane I1 (inbox and help). Frontend-only: no database.
// #12 the automatic message Turn on and Turn off button keeps one focus key across its label change.
// #13 switching the composer tab clears an old "Write a message first." error, and every send, save or draft attempt clears it first.
// #14 the help Resolved tab says "No resolved tickets."; Open and All keep their wording.
// #17 the guest-reply line is one muted line under the title, and the Property and Listing filters show only with 2 or more to pick from.
// The screens are built with h() and need a browser, so these checks read the source (as qa-r9-c11 does).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const INBOX_SRC = read('public/js/views/inbox.js');
const HELP_SRC = read('public/js/views/help.js');

// The automatic message button that reads Turn on or Turn off (one line in the source).
const TOGGLE_LINE = INBOX_SRC.split('\n').find((l) => l.includes("a.enabled ? 'Turn off' : 'Turn on'") && l.includes('onclick'));
// The composer's mode switch, from its definition to the note line that follows it.
const SET_MODE = INBOX_SRC.slice(INBOX_SRC.indexOf('const setMode = (k) => {'), INBOX_SRC.indexOf('const noEmail = '));
// The AI draft button, from its definition to the picker that follows it.
const AI_DRAFT = INBOX_SRC.slice(INBOX_SRC.indexOf('const aiBtn = '), INBOX_SRC.indexOf('const picker = mentionPicker('));
// The send handler, from the form's submit to the payload it builds.
const SEND = INBOX_SRC.slice(INBOX_SRC.indexOf('onsubmit: async (e) => {'), INBOX_SRC.indexOf('const payload = { body: body.value'));

test('#12 the automatic message Turn on and Turn off button keeps one focus key across its label change', () => {
  assert.ok(TOGGLE_LINE, 'the toggle button is on one line');
  assert.match(TOGGLE_LINE, /'data-focus-key': `auto-toggle-\$\{a\.automation_id\}`/);
});

test('#13 switching the composer tab clears an old error', () => {
  assert.match(SET_MODE, /err\.textContent = '';/);
});

test('#13 every send, save and draft attempt clears the error first, before the empty-message check', () => {
  assert.match(AI_DRAFT, /err\.textContent = '';/);
  const clear = SEND.indexOf("err.textContent = '';");
  const check = SEND.indexOf("'Write a message first.'");
  assert.ok(clear > 0 && check > clear, 'the clear comes before the check');
});

test('#14 the Resolved tab says "No resolved tickets."; Open and All keep their wording', () => {
  assert.match(HELP_SRC, /ticketFilters\.view === 'resolved' \? 'No resolved tickets\.' : 'No tickets yet\.'/);
  assert.match(HELP_SRC, /ticketFilters\.view === 'open' \? 'No open tickets\. If something is wrong, contact support and we’ll help\.'/);
});

test('#17 the guest-reply line is one muted line under the title, not a blue alert', () => {
  assert.match(INBOX_SRC, /h\('p', \{ class: 'muted small' \}, 'Guest replies arrive in your email for now\.'\)/);
  assert.doesNotMatch(INBOX_SRC, /Guest replies go to your email inbox/);
  assert.doesNotMatch(INBOX_SRC, /alert--info[^\n]*Guest replies/);
});

test('#17 the Property filter shows with 2 or more properties, and Listing with 2 or more listings', () => {
  assert.match(INBOX_SRC, /properties\.length > 1 && \{ name: 'property_id'/);
  assert.match(INBOX_SRC, /stUnits\.length > 1 && \{ name: 'unit_id'/);
});
