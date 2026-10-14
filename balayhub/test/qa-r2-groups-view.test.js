'use strict';

// QA round 2, lane A18 (groups view). Frontend source scan only: the view imports the app shell, which does not load in Node.
// 1. Adding rooms is one request with a rooms array (the server adds all of them or none), never a loop of single-room posts.
// 2. A failed add keeps the dialog open with the server's message, which ends "Nothing was saved." Re-rendering the page removes open dialogs,
//    so the table is not re-read on failure; it is re-read when the dialog closes after a failure, and on success.
// 3. The list's Rooms column counts active rooms (as the detail page does) and shows a dash for cancelled groups.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'groups.js'), 'utf8');
const between = (from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
const addRoom = between('async function addRoomModal', '// ---------------------------------------------------------------- list');
const listView = between('export async function groupsView', '// ---------------------------------------------------------------- detail');
// The failure path of the add: from the catch after the post to the success toast.
const addFailure = addRoom.slice(addRoom.indexOf('} catch (err) {', addRoom.indexOf('await post(')), addRoom.indexOf("toast('Room added.')"));

test('adding rooms sends one request with a rooms array, never one post per room', () => {
  assert.doesNotMatch(src, /for\s*\([^)]*\)\s*await\s+post\(/);
  assert.match(addRoom, /await post\(`\/booking-groups\/\$\{g\.group_id\}\/rooms`, \{ rooms: list \}\)/);
});

test('a failed add says nothing was saved and keeps the dialog open: the error is rethrown into the form, with no page re-render first', () => {
  assert.match(addRoom, /Nothing was saved/);
  assert.match(addFailure, /throw err/);
  // A re-render removes the open dialog, and with it the message the form is about to show.
  assert.doesNotMatch(addFailure, /onDone\(\)/);
});

test('a failed add re-reads the table when its dialog closes, so a save hidden by a dropped connection still shows', () => {
  assert.match(addRoom, /onClose:[^\n]*onDone\(\)/);
  assert.match(addRoom, /toast\('Room added\.'\); modal\.close\(\); onDone\(\);/);
});

test('the taken-rooms box repeats no message: it lists the taken rooms under a lead-in, and is left out when none are named', () => {
  const box = between('function conflictList', 'async function loadChoices');
  // The form's error line already shows the server's message, so the box must not repeat it.
  assert.doesNotMatch(box, /err\.message/);
  assert.match(box, /These rooms are taken:/);
  assert.match(box, /if \(!items\.length\) return \[\];/);
  // Callers spread the result, so an empty result adds nothing to the dialog.
  assert.equal((src.match(/conflicts\.replaceChildren\(\.\.\.conflictList\(err\)\)/g) || []).length, 2);
  assert.doesNotMatch(src, /replaceChildren\(conflictList\(err\)\)/);
});

test('the list Rooms column counts active rooms, and a cancelled group shows a dash', () => {
  assert.match(listView, /isCancelled\(g\) \? '—' : String\(g\.rooms\)/);
  assert.doesNotMatch(listView, /h\('td', null, String\(g\.rooms\)\)/);
});
