'use strict';
require('./helpers');

// QA round 49, ICSGUARD (LST49-S1, D-131). Connect calendar is its own form, not makeForm: its submit button
// installs guardPress so a double press cannot close the "Check the calendar link" question the answer draws.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const s = fs.readFileSync(path.join(__dirname, '../public/js/views/listings.js'), 'utf8');
const LINE = "addForm.querySelector('button[type=submit]').addEventListener('click', (e) => guardPress(e, e.currentTarget));";

test('guardPress is imported from ui.js and installed on Connect calendar\'s submit button', () => {
  const imp = s.match(/import \{([^}]*)\} from '\.\.\/ui\.js'/);
  assert.ok(imp && /\bguardPress\b/.test(imp[1]), 'guardPress imported');
  const form = s.indexOf("'Connect calendar')));");
  assert.ok(form > 0);
  const at = s.indexOf(LINE);
  assert.ok(at > form, 'installed after the form is built');
  assert.ok(at < s.indexOf("addForm.addEventListener('submit'"), 'installed before the submit handler');
});

test('the installed line calls guardPress with the click and the button', () => {
  const calls = [];
  const guardPress = (e, el) => calls.push([e, el]);
  let handler;
  const btn = { addEventListener: (_t, fn) => { handler = fn; } };
  const addForm = { querySelector: (sel) => (sel === 'button[type=submit]' ? btn : null) };
  new Function('addForm', 'guardPress', LINE)(addForm, guardPress);
  const ev = { currentTarget: btn };
  handler(ev);
  assert.deepEqual(calls, [[ev, btn]]);
});
