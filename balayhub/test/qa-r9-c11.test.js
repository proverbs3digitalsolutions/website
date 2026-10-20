'use strict';

// QA round 9, fix lane C11 (inbox, help and assistant views). Frontend-only: no database.
// #12: a new automatic message starts turned off, with a hint to turn it on once the wording is right.
// #11: each automatic message row button names its trigger too (D-81), so two rows with one name are told apart.
// #14: Insert template is hidden in Internal note mode and shown again in Message guest mode.
// #10: "Type a question first." clears on the next input, on a help or ticket search, on a new chat and when the panel opens again.
// The screens are built with h() and need a browser, so these checks read the source (as qa-r8-c32 does).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const INBOX_SRC = read('public/js/views/inbox.js');
const HELP_SRC = read('public/js/views/help.js');
const ASSIST_SRC = read('public/js/assistant.js');

// The automatic message form, from its start to the list of rows that follows it.
const AUTO_FORM = INBOX_SRC.slice(INBOX_SRC.indexOf('const editAutomation = (a) => {'), INBOX_SRC.indexOf('const toggle = async (a, enabled) => {'));
// The composer's mode switch, from its definition to the note line that follows it.
const SET_MODE = INBOX_SRC.slice(INBOX_SRC.indexOf('const setMode = (k) => {'), INBOX_SRC.indexOf('const noEmail = '));

test('#12 a new automatic message starts turned off, with a hint to turn it on once the wording is right', () => {
  assert.match(AUTO_FORM, /field\(\{ name: 'enabled', label: 'Turned on', type: 'checkbox', value: a \? a\.enabled : false \}\),\s*h\('div', \{ class: 'hint' \}, 'Turn it on when the wording is right\.'\),/);
  assert.doesNotMatch(INBOX_SRC, /value: a \? a\.enabled : true/);
});

test('#11 every automatic message row button names its trigger as well as its name (D-81, source scan)', () => {
  assert.match(INBOX_SRC, /'aria-label': `\$\{a\.enabled \? 'Turn off' : 'Turn on'\} automatic message: \$\{a\.name\}, \$\{describeAutomation\(a\)\}`/);
  assert.match(INBOX_SRC, /'aria-label': `Edit automatic message: \$\{a\.name\}, \$\{describeAutomation\(a\)\}`/);
  assert.match(INBOX_SRC, /'aria-label': `Delete automatic message: \$\{a\.name\}, \$\{describeAutomation\(a\)\}`/);
});

test('#14 Insert template is hidden in Internal note mode and shown again in Message guest mode', () => {
  assert.match(SET_MODE, /tplSelect\.hidden = mode === 'note';/);
  // The template select is still the one the composer builds (its own aria-label is unchanged).
  assert.match(INBOX_SRC, /class: 'input input--sm', 'aria-label': 'Insert template',/);
});

test('#10 the help page clears "Type a question first." on the next question input, a help search and a ticket search', () => {
  assert.match(HELP_SRC, /askInput\.addEventListener\('input', \(\) => \{ askError\.textContent = ''; \}\);/);
  assert.match(HELP_SRC, /onSearch: \(q\) => \{ askError\.textContent = ''; filters\.q = q; sync\(\); drawArticles\(\); \} \}\);/);
  assert.match(HELP_SRC, /onChange: \(\) => \{ askError\.textContent = ''; drawTickets\(\); \}/);
});

test('#10 the assistant panel clears "Type a question first." on input, when it opens again and on New chat', () => {
  assert.match(ASSIST_SRC, /input\.addEventListener\('input', \(\) => \{ askError\.textContent = ''; \}\);/);
  assert.match(ASSIST_SRC, /let clearAskError = \(\) => \{\};/);
  assert.match(ASSIST_SRC, /clearAskError = \(\) => \{ askError\.textContent = ''; \};/);
  assert.match(ASSIST_SRC, /export function openAssistant\(question\) \{\s*if \(!panel\) panel = buildPanel\(\);\s*clearAskError\(\);/);
  assert.match(ASSIST_SRC, /onclick: \(\) => \{ msgs = \[\]; save\(msgs\); said\.textContent = ''; clearAskError\(\); draw\(\); input\.focus\(\); \}/);
});

test('#10 an empty question still says what to do, and nothing is sent (existing behaviour kept)', () => {
  assert.match(HELP_SRC, /if \(!question\) \{ askError\.textContent = 'Type a question first\.'; askInput\.focus\(\); return; \}/);
  assert.match(ASSIST_SRC, /if \(busy\) return;\n\s*if \(!q\) \{ askError\.textContent = 'Type a question first\.'; input\.focus\(\); return; \}/);
});
