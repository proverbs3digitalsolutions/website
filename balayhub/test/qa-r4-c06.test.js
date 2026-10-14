'use strict';

// QA round 4, inbox view lane (C06). Frontend-only: no database. inbox.js is loaded from a temp copy of
// public/js with app.js replaced by a stub, the same way test/qa-r2-inbox-view.test.js loads it.
// Covers: Insert template adds below what was typed and keeps a typed subject (#5); the subject draft
// survives switching conversations and is cleared after a send (#6); opening a thread clears its unread
// look, the header count, the view counts and the menu badge (#4); automatic messages read "On check-in
// day" for 0 days and send a blank day count as blank so the server can refuse it, with a blank send
// time meaning 10:00 (#8, client part).

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r4-c06-'));
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

test('an automatic message with 0 days reads as the day itself, not "0 days before"', () => {
  assert.equal(inbox.describeAutomation({ trigger_event: 'before_check_in', offset_days: 0, send_time: '10:00' }), 'On check-in day at 10:00');
  assert.equal(inbox.describeAutomation({ trigger_event: 'before_check_out', offset_days: 0, send_time: '10:00' }), 'On check-out day at 10:00');
  assert.equal(inbox.describeAutomation({ trigger_event: 'after_check_out', offset_days: 0, send_time: '10:00' }), 'On check-out day at 10:00');
  assert.equal(inbox.describeAutomation({ trigger_event: 'check_in_day', offset_days: 0, send_time: '08:30' }), 'On check-in day at 08:30');
});

test('other day counts keep the day phrase, with the unit singular for 1', () => {
  assert.equal(inbox.describeAutomation({ trigger_event: 'before_check_in', offset_days: 1, send_time: '10:00' }), '1 day before check-in at 10:00');
  assert.equal(inbox.describeAutomation({ trigger_event: 'before_check_out', offset_days: 2, send_time: '10:00' }), '2 days before check-out at 10:00');
  assert.equal(inbox.describeAutomation({ trigger_event: 'after_check_out', offset_days: 3, send_time: '09:30' }), '3 days after check-out at 09:30');
  assert.equal(inbox.describeAutomation({ trigger_event: 'booking_created', offset_days: 0, send_time: '10:00' }), 'Right after a reservation is added (manually or from a channel)');
});

test('Insert template adds the template below what the host typed, and keeps a typed subject', () => {
  // Only the empty-body and empty-subject cases overwrite; typed text is never replaced.
  assert.doesNotMatch(src, /^\s*body\.value = r\.body;$/m, 'the body is no longer overwritten');
  assert.doesNotMatch(src, /^\s*subject\.value = r\.subject;$/m, 'the subject is no longer overwritten');
  assert.match(src, /const next = insertBelow\(body\.value, r\.body\);/);
  assert.match(src, /const subjectNext = nextSubject\(subject\.value, filledSubject, r\.subject\);/);
  assert.match(src, /toast\('Template added below your message\.'\)/);
});

test('Insert template adds nothing when the result would pass the 10,000-character message limit', () => {
  assert.equal(inbox.insertBelow('Hi', 'Body'), 'Hi\n\nBody');
  assert.equal(inbox.insertBelow('   ', 'Body'), 'Body', 'an empty message takes the template as it is');
  assert.equal(inbox.insertBelow('Hi  \n', 'Body'), 'Hi\n\nBody', 'trailing spaces above the template are dropped');
  // Exactly 10,000 characters fits; one more does not, and nothing is added part way.
  assert.equal(inbox.insertBelow('x'.repeat(9990), 'y'.repeat(8)).length, 10000);
  assert.equal(inbox.insertBelow('x'.repeat(9990), 'y'.repeat(9)), null);
  assert.equal(inbox.insertBelow('x'.repeat(9000), 'y'.repeat(5000)), null);
  // The check runs before the message or the subject is written, and the picker is reset before the request.
  assert.match(src, /const tid = e\.target\.value;\s*e\.target\.value = '';/);
  assert.match(src, /if \(next === null\) \{ toast\('Adding this template would go over the 10,000-character limit\.', 'error'\); return; \}/);
  assert.ok(src.indexOf('if (next === null)') < src.indexOf('body.value = next;'), 'the limit check comes before any write');
});

test('the subject draft is kept per conversation, restored on open, and cleared with the body after a send', () => {
  assert.match(src, /const subjKey = `bh-draft:subj:\$\{c\.conversation_id\}`;/);
  assert.match(src, /try \{ subject\.value = sessionStorage\.getItem\(subjKey\) \|\| ''; \} catch \{ \/\* ignore \*\/ \}/);
  assert.match(src, /subject\.addEventListener\('input', \(\) => \{ try \{ sessionStorage\.setItem\(subjKey, subject\.value\); \} catch \{ \/\* ignore \*\/ \} \}\);/);
  assert.match(src, /try \{ sessionStorage\.removeItem\(draftKey\); sessionStorage\.removeItem\(modeKey\); sessionStorage\.removeItem\(subjKey\); sessionStorage\.removeItem\(subjTplKey\); \} catch \{ \/\* ignore \*\/ \}/);
});

test('opening a thread clears its unread look, the header count, the view counts and the menu badge', () => {
  // Runs only after the thread has rendered, so a failed thread load leaves the counts as they were.
  assert.match(src, /await renderThread\(threadPane, selected, \{ status, back: href\(null\), rerender \}\);\s*await refreshCounts\(\);/);
  assert.match(src, /items\.querySelector\('\.inbox__item\.is-active'\)\?\.classList\.remove\('is-unread'\);/);
  assert.match(src, /const counts = await get\('\/inbox\/counts'\)\.then\(\(r\) => r\.counts, \(\) => null\);/);
  assert.match(src, /unreadLine\.textContent = unreadText\(counts\.unread\);/);
  assert.match(src, /VIEWS\.forEach\(\(\[k, t\], i\) => \{ viewSelect\.options\[i\]\.textContent = viewLabel\(\[k, t\], counts\); \}\);/);
  assert.match(src, /document\.querySelectorAll\('a\[href="#\/inbox"\] \.navbadge'\)/);
  assert.match(src, /if \(n\) \{ b\.textContent = n > 99 \? '99\+' : String\(n\); b\.setAttribute\('aria-label', `\$\{n\} unread`\); \} else b\.remove\(\);/);
  // The header line reads "Guest messages by email" once nothing is unread, as it did before.
  assert.match(src, /const unreadText = \(n\) => \(Number\(n\) \? `\$\{n\} unread` : 'Guest messages by email'\);/);
  assert.match(src, /const unreadLine = h\('p', null, unreadText\(counts\.counts\.unread\)\);/);
});

test('a blank day count goes as null on the before and after triggers, so the server refuses it', () => {
  assert.equal(inbox.daysToSend('before_check_in', ''), null);
  assert.equal(inbox.daysToSend('before_check_out', ''), null);
  assert.equal(inbox.daysToSend('after_check_out', ''), null);
  // The other two triggers don't use a count, so a blank one stays 0 as before.
  assert.equal(inbox.daysToSend('check_in_day', ''), 0);
  assert.equal(inbox.daysToSend('booking_created', ''), 0);
  // A typed count is passed through for the server to check.
  assert.equal(inbox.daysToSend('before_check_in', '3'), '3');
  assert.equal(inbox.daysToSend('after_check_out', '0'), '0');
  assert.match(src, /d\.offset_days = daysToSend\(d\.trigger_event, d\.offset_days\);/);
  assert.doesNotMatch(src, /offset_days === '' \? 0 : Number\(d\.offset_days\)/, 'the old blank-to-0 line is gone');
});

test('the hidden day box is ignored on the check-in-day and booking-created triggers, which always store 0', () => {
  // The day box is hidden for these two triggers but still holds its default (1) or an old value, so it must not be stored.
  assert.equal(inbox.daysToSend('check_in_day', '1'), 0);
  assert.equal(inbox.daysToSend('booking_created', '1'), 0);
  assert.equal(inbox.daysToSend('check_in_day', '7'), 0);
  assert.equal(inbox.daysToSend('booking_created', ''), 0);
  // The day triggers still pass a typed count through.
  assert.equal(inbox.daysToSend('before_check_in', '1'), '1');
});

test('the automatic message form says a blank send time means 10:00, and a blank time is sent as 10:00', () => {
  assert.match(src, /field\(\{ name: 'send_time', label: 'Send at \(Philippine time\)', type: 'time', value: a\?\.send_time \|\| '10:00', hint: 'Leave blank for 10:00\.' \}\)/);
  assert.match(src, /d\.send_time = d\.send_time \|\| '10:00';/);
});

test('the server message for a day count shows under that box, and a duplicate template name shows under the name box', () => {
  // The field's wrapper carries its name, and the form puts each server field message under the wrapper with that name.
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ui.js'), 'utf8');
  assert.match(ui, /return h\('div', \{ class: 'field', dataset: \{ field: f\.name \} \},/);
  assert.match(ui, /const wrap = form\.querySelector\(`\[data-field="\$\{CSS\.escape\(name\)\}"\]`\);/);
  assert.match(ui, /const unplaced = showErrors\(form, err\.fields\);/);
  // The automatic message form has an offset_days box, and the template form has a name box; neither catches the save error.
  assert.match(src, /field\(\{ name: 'offset_days', label: 'Number of days'/);
  assert.match(src, /field\(\{ name: 'name', label: 'Template name', required: true/);
  assert.match(src, /onSubmit: async \(d\) => \{\s*if \(t\) await patch\(`\/message-templates\/\$\{t\.template_id\}`, d\); else await post\('\/message-templates', d\);\s*toast\('Template saved\.'\);/);
});
