'use strict';

// QA round 10, fix lane C04 (inbox and help views). Frontend-only: no database.
// #9: the composer mode is saved with the draft, so a reload never turns an internal note into a guest message.
// #37: banner wording. #13: "Waiting for you" is ticked only when the ticket really waited.
// The views need a browser, so pure helpers are pulled out of the source and the rest is read as text.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const INBOX = read('public/js/views/inbox.js');
const HELP = read('public/js/views/help.js');

// Evaluate a self-contained exported function from source text.
function pick(src, name, extra = '') {
  const m = src.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n}\\n`));
  assert.ok(m, `${name} exported`);
  return new Function(`${extra}\n${m[0].replace('export ', '')}\nreturn ${name};`)();
}

test('restoredMode: saved mode wins; an old draft opens as a note', () => {
  const restoredMode = pick(INBOX, 'restoredMode');
  assert.equal(restoredMode('note', 'x'), 'note');
  assert.equal(restoredMode('message', 'x'), 'message');
  assert.equal(restoredMode(null, 'x'), 'note');
  assert.equal(restoredMode(null, ''), 'message');
});

test('mode is written on change and on input, read on load, removed with the draft', () => {
  assert.match(INBOX, /sessionStorage\.getItem\(modeKey\)/);
  assert.match(INBOX, /composerModes\.set\([^)]*\);\s*try \{ sessionStorage\.setItem\(modeKey, k\)/);
  assert.match(INBOX, /setItem\(draftKey, mode === 'note' \? encodeMentions\(body\.value, picked\) : body\.value\); sessionStorage\.setItem\(modeKey, mode\)/);
  assert.match(INBOX, /removeItem\(draftKey\); sessionStorage\.removeItem\(modeKey\)/);
  assert.match(INBOX, /bh-draft:mode:/);
});

test('#10: the redrawn composer still has a Save note button', () => {
  assert.match(INBOX, /'Save note' : 'Send'/);
});

test('#37: banner has no developer wording', () => {
  assert.doesNotMatch(INBOX, /whoever set up BalayHub/);
  assert.match(INBOX, /Guest replies arrive in your email for now\./);
});

test('#13: tracker steps', () => {
  const trackerSteps = pick(HELP, 'trackerSteps', "const STEPS = [['new', 'Received'], ['in_progress', 'In progress'], ['waiting_on_customer', 'Waiting for you'], ['resolved', 'Resolved']];");
  const solved = trackerSteps('resolved', false);
  assert.equal(solved[2].done, false);
  assert.equal(solved[2].skipped, true);
  assert.equal(solved[3].done, true);
  assert.equal(solved[3].current, true);
  assert.equal(trackerSteps('resolved', true)[2].done, true);
  assert.equal(trackerSteps('closed', false)[3].done, true);
  const w = trackerSteps('waiting_on_customer', true);
  assert.equal(w[2].current, true);
  assert.equal(w[2].done, false);
  assert.equal(w[1].done, true);
});
