'use strict';

// QA round 23, lane GROUPS (bookings.json #2). Frontend only: a source scan of public/js/views/groups.js.
// New group booking: the "These rooms are taken" list (and the banner line that came with it) goes as soon as any room row
// changes, because the next save checks again. A change outside the room rows (the group name) leaves it alone.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'groups.js'), 'utf8');
const modal = src.slice(src.indexOf('export async function newGroupModal'), src.indexOf('async function addRoomModal'));

test('a change inside the room rows clears the taken list', () => {
  assert.match(modal, /for \(const ev of \['input', 'change'\]\) rowsBox\.addEventListener\(ev, /);
  assert.match(modal, /conflicts\.children\.length/);
  assert.match(modal, /conflicts\.replaceChildren\(\)/);
});

test('the banner goes only when it was the ROOMS_TAKEN line', () => {
  assert.match(modal, /let takenBanner = false/);
  assert.match(modal, /takenBanner = err\.code === 'ROOMS_TAKEN'/);
  assert.match(modal, /if \(takenBanner\) form\.querySelector\('\.form-error'\)\?\.replaceChildren\(\)/);
});

test('the listener is on the room rows, not the whole form', () => {
  assert.doesNotMatch(modal, /form\.addEventListener\(['"](input|change)/);
});
