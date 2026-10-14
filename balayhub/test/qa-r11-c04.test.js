'use strict';

// QA round 11, fix lane C04 (inbox view). Frontend-only: no database.
// #14: a template replaces the subject an earlier template filled in; a subject the host typed stays.
// #15: "Draft reply with AI" is hidden in Internal note mode, as the template picker is.
// #16: the "1 week" snooze wakes at 9 AM Manila, seven days after today's Manila date.
// #17: the template form says how many characters each field takes.
// inbox.js is loaded from a temp copy of public/js with app.js replaced by a stub (as qa-r2-inbox-view does).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js'), 'utf8');

let inbox;
let dir;
test.before(async () => {
  globalThis.Element = class { }; // ui.js patches Element.prototype when it loads
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-inbox-c04-'));
  fs.cpSync(path.join(__dirname, '..', 'public', 'js'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'app.js'), [
    'export const state = { user: null, requireEmailVerification: true };',
    'export const navigate = () => {};',
    'export const refreshUser = async () => {};',
    'export const logout = async () => {};',
    'export const afterLogin = async () => {};',
    "export const homeRoute = () => '#/home';",
  ].join('\n'));
  inbox = await import(pathToFileURL(path.join(dir, 'views', 'inbox.js')));
});
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

test('#14 a template fills an empty subject, replaces the subject an earlier template filled, and keeps a typed subject', () => {
  assert.equal(inbox.nextSubject('', null, 'Booking confirmation'), 'Booking confirmation');
  assert.equal(inbox.nextSubject('   ', null, 'Booking confirmation'), 'Booking confirmation');
  assert.equal(inbox.nextSubject('', 'Booking confirmation', 'Payment reminder'), 'Payment reminder');
  assert.equal(inbox.nextSubject('Booking confirmation', 'Booking confirmation', 'Payment reminder'), 'Payment reminder');
  assert.equal(inbox.nextSubject('Our own subject', 'Booking confirmation', 'Payment reminder'), 'Our own subject');
  assert.equal(inbox.nextSubject('Typed by the host', null, 'Booking confirmation'), 'Typed by the host');
});

test('#14 the subject a template filled is remembered per conversation, cleared with the draft, and no longer read as "empty"', () => {
  assert.match(src, /const subjTplKey = `bh-draft:subjtpl:\$\{c\.conversation_id\}`;/);
  assert.match(src, /let filledSubject = null;\s*try \{ filledSubject = sessionStorage\.getItem\(subjTplKey\); \} catch/);
  assert.match(src, /const subjectNext = nextSubject\(subject\.value, filledSubject, r\.subject\);\s*if \(subjectNext !== subject\.value\) \{\s*subject\.value = subjectNext;\s*filledSubject = subjectNext;/);
  assert.match(src, /sessionStorage\.removeItem\(subjKey\); sessionStorage\.removeItem\(subjTplKey\);/);
  assert.doesNotMatch(src, /if \(!subject\.value\.trim\(\)\) subject\.value = r\.subject;/);
});

test('#15 Draft reply with AI is hidden in Internal note mode, as the template picker is', () => {
  assert.match(src, /tplSelect\.hidden = mode === 'note';\s*if \(aiBtn\) aiBtn\.hidden = mode === 'note';/);
});

test('#16 "1 week" wakes at 9 AM Manila, seven days after the Manila date (not the current clock time)', () => {
  const at = (iso) => inbox.weekLater(new Date(iso)).toISOString();
  // 19:59 UTC on Oct 14 is 3:59 AM on Oct 15 in Manila, so seven days on is Oct 22.
  assert.equal(at('2026-10-14T19:59:00Z'), '2026-10-22T01:00:00.000Z');
  assert.equal(at('2026-10-14T03:00:00Z'), '2026-10-21T01:00:00.000Z');
  assert.equal(at('2026-10-15T15:30:00Z'), '2026-10-22T01:00:00.000Z', 'late evening in Manila still counts as that day');
  assert.match(src, /\['1 week', weekLater\(\)\],/);
});

test('#17 the template form says how many characters each field takes', () => {
  assert.match(src, /name: 'name', label: 'Template name', required: true, value: t\?\.name, maxlength: 80, hint: 'Up to 80 characters\.' \}\)/);
  assert.match(src, /name: 'subject', label: 'Email subject', required: true, value: t\?\.subject, maxlength: 200, hint: 'Up to 200 characters\.' \}\)/);
  assert.match(src, /name: 'body', label: 'Message', type: 'textarea', required: true, value: t\?\.body, maxlength: 5000, hint: 'Up to 5,000 characters\.' \}\)/);
});
