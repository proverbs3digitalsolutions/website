'use strict';

// QA round 11, lane C15 (deposits and owners views, frontend only, no database).
// #22 a deposit returned before the stay checks out asks first; the server still allows it (settle is unchanged).
// #23 the Publish dialog promises the owner's portal only when the portal is on; otherwise it says to send the statement by email.
// N3 the Unpublish dialog says when a sent statement was emailed, and that the owner keeps that copy.
// The views import the app shell, which does not load in Node, so the pure helpers are pulled out of the source and evaluated.
// node --test --test-concurrency=1 test/qa-r11-c15.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const depSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'deposits.js'), 'utf8');
const ownSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'owners.js'), 'utf8');

const grab = (src, name) => {
  const m = src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `export function ${name} not found`);
  return m[0].replace('export ', '');
};
const askEarlyReturn = new Function(`${grab(depSrc, 'askEarlyReturn')}\nreturn askEarlyReturn;`)();
const publishText = new Function(`${grab(ownSrc, 'publishText')}\nreturn publishText;`)();
const unpublishText = new Function(`${grab(ownSrc, 'unpublishText')}\nreturn unpublishText;`)();

const TODAY = '2026-10-14';

test('#22 a stay that has not checked out asks before its deposit is returned', () => {
  assert.equal(askEarlyReturn({ status: 'confirmed', check_out: '2026-10-22', checked_out_at: null }, TODAY), true);
});

test('#22 no question for a cancelled stay, a stay already checked out, or one whose check-out is today or earlier', () => {
  assert.equal(askEarlyReturn({ status: 'cancelled', check_out: '2026-10-22', checked_out_at: null }, TODAY), false);
  assert.equal(askEarlyReturn({ status: 'confirmed', check_out: '2026-10-22', checked_out_at: '2026-10-20T04:00:00Z' }, TODAY), false);
  assert.equal(askEarlyReturn({ status: 'confirmed', check_out: TODAY, checked_out_at: null }, TODAY), false);
  assert.equal(askEarlyReturn({ status: 'confirmed', check_out: '2026-10-13', checked_out_at: null }, TODAY), false);
});

test('#22 the settle form asks in its submit before posting, and Cancel leaves the form open with nothing posted', () => {
  const settle = depSrc.slice(depSrc.indexOf('const settle = () => {'), depSrc.indexOf('const reopen = async'));
  const submit = settle.slice(settle.indexOf('onSubmit:'));
  assert.ok(submit.includes('askEarlyReturn(r, todayManila())'), 'the submit asks the question');
  assert.match(submit, /confirmDialog\(\{ title: 'Return the deposit before check-out\?', text: `The stay ends \$\{fmtDate\(r\.check_out\)\}\. Damage is usually checked after check-out\.`, confirmText: 'Return deposit' \}\)/);
  assert.ok(submit.indexOf('return false') < submit.indexOf('/deposit/settle'), 'a Cancel returns false before the post');
});

test('#23 the Publish text promises the portal only when the owner\'s portal is on', () => {
  assert.equal(
    publishText('October 2026', true),
    "The October 2026 numbers are frozen and the owner can see them in their portal. Later changes won't show until you unpublish and publish again.");
  const off = publishText('October 2026', false);
  assert.match(off, /The October 2026 numbers are frozen\. The owner's portal is off, so send the statement by email\./);
  assert.doesNotMatch(off, /can see them in their portal/);
});

test('#23 the statement view reads the portal flag from the owner list, because the statement payload does not carry it', () => {
  assert.match(ownSrc, /get\('\/unit-owners'\)\.catch\(\(\) => null\)/);
  assert.match(ownSrc, /const portalOn = Boolean\(ownersRes\?\.owners\?\.find\(\(o\) => o\.owner_id === id\)\?\.portal_enabled\);/);
  assert.match(ownSrc, /text: publishText\(s\.month_label, portalOn\)/);
});

test('N3 the Unpublish text names the date a sent statement was emailed, and that the owner keeps that copy', () => {
  assert.equal(
    unpublishText('Oct 1, 2026'),
    'The owner can no longer see this statement. It was emailed on Oct 1, 2026. The owner keeps that copy. Make your corrections, then publish it again.');
  assert.equal(unpublishText(null), 'The owner can no longer see this statement. Make your corrections, then publish it again.');
  assert.match(ownSrc, /text: unpublishText\(record\.sent_at \? fmtDate\(manilaDay\(record\.sent_at\)\) : null\)/, 'the date reads Oct 1, 2026, not 2026-10-01');
});
