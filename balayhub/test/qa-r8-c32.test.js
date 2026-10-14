'use strict';

// QA round 8, fix lane C32 (help-assistant). Frontend-only: no database.
// #65: an empty "Send rating", an empty "Send reply" and an empty assistant "Send" each say what to do at the control
// and send nothing. The screens are built with h() and need a browser, so these checks read the source in order:
// the message is set, the function returns, and only then is anything posted.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const HELP_SRC = read('public/js/views/help.js');
const ASSIST_SRC = read('public/js/assistant.js');

// The customer ticket view: from the reply box to the rating card's end (the page layout that follows).
const TICKET_START = HELP_SRC.indexOf('export async function helpTicketView');
const TICKET_END = HELP_SRC.indexOf('// ---------------------------------------------------------------- BalayHub support queue');
const TICKET_SRC = HELP_SRC.slice(TICKET_START, TICKET_END);

test('Send rating with no star picked says so at the stars and sends nothing (#65)', () => {
  const rate = TICKET_SRC.slice(TICKET_SRC.indexOf('let rating = 0;'), TICKET_SRC.indexOf('el.replaceChildren('));
  assert.match(rate, /const ratingError = h\('div', \{ class: 'error', role: 'alert' \}\);/);
  assert.match(rate, /stars\(\(n\) => \{ rating = n; ratingError\.textContent = ''; \}\)/);
  assert.match(rate, /if \(!rating\) \{ ratingError\.textContent = 'Pick a star rating first\.'; return; \}/);
  const check = rate.indexOf("'Pick a star rating first.'");
  assert.ok(check > 0 && check < rate.indexOf('/rate`'), 'the check comes before the request');
  assert.doesNotMatch(HELP_SRC, /Choose 1 to 5 stars/);
});

test('Send reply with an empty box and no file says so at the box and sends nothing (#65)', () => {
  const reply = TICKET_SRC.slice(TICKET_SRC.indexOf('const reply = h('), TICKET_SRC.indexOf('let rating = 0;'));
  assert.match(reply, /const replyError = h\('div', \{ class: 'error', role: 'alert' \}\);/);
  assert.match(reply, /if \(!reply\.value\.trim\(\) && !attach\.files\[0\]\) \{[^}]*'Write a reply first\.'[^}]*return; \}/);
  const check = reply.indexOf("'Write a reply first.'");
  assert.ok(check > 0 && check < reply.indexOf('uploadFile('), 'the check comes before any upload');
  assert.ok(check < reply.indexOf('/reply`'), 'the check comes before the request');
  assert.doesNotMatch(HELP_SRC, /Write a message or attach a file first/);
});

test('a reply message clears when the person types or attaches a file (#65)', () => {
  const reply = TICKET_SRC.slice(TICKET_SRC.indexOf('const reply = h('), TICKET_SRC.indexOf('const send = async'));
  assert.match(reply, /reply\.addEventListener\('input', clearReplyError\);/);
  assert.match(reply, /attach\.addEventListener\('change', clearReplyError\);/);
});

test('the assistant Send with an empty box says so above the box and sends nothing (#65)', () => {
  assert.match(ASSIST_SRC, /const askError = h\('div', \{ class: 'error', role: 'alert' \}\);/);
  assert.match(ASSIST_SRC, /if \(busy\) return;\n\s*if \(!q\) \{ askError\.textContent = 'Type a question first\.'; input\.focus\(\); return; \}/);
  assert.doesNotMatch(ASSIST_SRC, /if \(!q \|\| busy\) return;/);
  const check = ASSIST_SRC.indexOf("'Type a question first.'");
  assert.ok(check > 0 && check < ASSIST_SRC.indexOf('msgs.push(asked)'), 'the check comes before the question is added');
  assert.ok(check < ASSIST_SRC.indexOf("post('/assistant/chat'"), 'the check comes before the request');
});

test('the assistant message clears on typing and on a valid question (#65)', () => {
  assert.match(ASSIST_SRC, /input\.addEventListener\('input', \(\) => \{ askError\.textContent = ''; \}\);/);
  assert.match(ASSIST_SRC, /askError\.textContent = '';\n\s*const asked = \{ role: 'user', content: q \};/);
});

test('the assistant message sits between the chat list and the form, in the panel (#65)', () => {
  assert.match(ASSIST_SRC, /\n    list,\n    askNote,\n    form,\n/);
  assert.match(ASSIST_SRC, /const askNote = h\('div', \{ class: 'field', style: \{ padding: '0 12px' \} \}, askError\);/);
});
