'use strict';

// QA round 14, lane OP1 (maintenance, cleaner pay, account; frontend only, no database).
// #40: the "From cleaning task" badge link is a standalone link with the .link-tap class (maintenance.js).
// #42: Pause and Resume carry the focus key mt-pause-<schedule id>, so focus stays on the toggle (maintenance.js).
// #41: cleaner pay names a month that is not this one: "Paid in January 2099" (cleanerpay.js monthWords).
// #15, #22: the Account "On · manage" and "Turn on" link is a standalone link with .link-tap (account.js).
//   notifications.js has no such link, so it is unchanged.
// node --test --test-concurrency=1 test/qa-r14-op1.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', ...p), 'utf8');
const maintSrc = read('views', 'maintenance.js');
const cleanerSrc = read('views', 'cleanerpay.js');
const accountSrc = read('views', 'account.js');

// The cleaner pay view loads app.js for the signed-in user, so load it from a temp copy with a stub app.js (as qa-r4-c09 does).
let view; let dir;
test.before(async () => {
  globalThis.Element = class { }; // ui.js names the DOM Element class at load time; a stub is enough here
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-op1-r14-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'i18n.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: null, requireEmailVerification: true };\n');
  fs.copyFileSync(path.join(__dirname, '../public/js/views/cleanerpay.js'), path.join(dir, 'views', 'cleanerpay.js'));
  view = await import(pathToFileURL(path.join(dir, 'views', 'cleanerpay.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// ---------------------------------------------------------------- #41 cleaner pay month words

test('the current month keeps "Paid this month" and "No finished cleans this month" (#41)', () => {
  assert.deepEqual(view.monthWords('2026-10', '2026-10-15'), { paid: 'Paid this month', empty: 'No finished cleans this month' });
});

test('any other month names itself in both words (#41)', () => {
  assert.deepEqual(view.monthWords('2099-01', '2026-10-15'), { paid: 'Paid in January 2099', empty: 'No finished cleans in January 2099' });
});

test('the Pay card and the empty list read their words from monthWords (#41)', () => {
  assert.match(cleanerSrc, /const words = monthWords\(month\(\)\)/);
  assert.match(cleanerSrc, /stat\(words\.paid, /);
  assert.match(cleanerSrc, /title: data\.tasks\.length \? 'No cleans match these filters' : words\.empty/);
  assert.doesNotMatch(cleanerSrc, /stat\('Paid this month'/);
});

// ---------------------------------------------------------------- #40 From cleaning task link

test('the From cleaning task badge link is a standalone link with .link-tap (#40)', () => {
  const badge = maintSrc.slice(maintSrc.indexOf('const taskBadge'), maintSrc.indexOf('export async function newMaintenanceModal'));
  assert.match(badge, /class: 'badge badge--ops link-tap'/);
});

// ---------------------------------------------------------------- #42 Pause and Resume focus key

test('each recurring job keeps one focus key on its Pause or Resume button (#42)', () => {
  const list = maintSrc.slice(maintSrc.indexOf("schedules.length ? h('ul'"), maintSrc.indexOf("h('p', { class: 'muted' }, 'No recurring jobs yet.')"));
  assert.match(list, /'data-focus-key': `mt-pause-\$\{x\.schedule_id\}`/);
  assert.match(list, /'aria-label': `\$\{x\.active \? 'Pause' : 'Resume'\} \$\{x\.title\}`/, 'the Pause or Resume name is unchanged');
});

// ---------------------------------------------------------------- #15, #22 Account notifications link

test('the Notifications link on this device is a standalone link with .link-tap (#15, #22)', () => {
  assert.match(accountSrc, /h\('a', \{ class: 'link-tap', href: '#\/settings' \}, u\.notifications_on \? 'On · manage' : 'Turn on'\)/);
});
