'use strict';

// QA round 12, lane C09 (stayreports-pnl-addons):
// #23: choosing a period drops the other periods' keys, so a reload cannot bring back a stale year.
// #25: a link with a from or to date and no period is a custom range; a date that is not a real day says so.
// #27: P&L and Performance each say what they count.
// #28: the All add-ons tab lists active add-ons only and says how many archived ones are hidden.
// Frontend only, no database. The pure exports are loaded from copies next to stub modules (as qa-r10-c09 does);
// the rest is a source scan, because the views import the app shell, which can't load in Node.
// node --test --test-concurrency=1 test/qa-r12-c09.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', rel), 'utf8');

// ui.js patches Element.prototype when it loads, and filters.js and ui.js read the rest only when a function runs.
// The copies are loaded in Node, so the browser globals they touch are stubbed here.
globalThis.Element = class Element { replaceChildren() {} append() {} };
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
globalThis.location = { hash: '' };
globalThis.history = { replaceState: (s, t, url) => { globalThis.location.hash = url; } };

let dir; let sr;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r12-c09-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.copyFileSync(path.join(__dirname, '../public/js/views/stayreports.js'), path.join(dir, 'views', 'stayreports.js'));
  fs.writeFileSync(path.join(dir, 'views', 'deposits.js'), 'export const depositsPanel = () => null;\n');
  fs.writeFileSync(path.join(dir, 'views', 'reports.js'), 'export const exportHint = () => \'\'; export const dateFieldError = () => null;\n');
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), 'export const CHANNEL_LABEL = {}; export const SOURCE_LABEL = {};\n');
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { user_id: 1 } };\nexport function navigate() {}\n');
  sr = await import(pathToFileURL(path.join(dir, 'views', 'stayreports.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// #23
test('#23: choosing a period drops the other periods\' keys, so a reload cannot bring back a stale year', () => {
  assert.equal(typeof sr.periodPatch, 'function', 'stayreports.js should export periodPatch');
  assert.deepEqual(sr.periodPatch(''), { period: '', year: '', from: '', to: '' }, 'Month clears year, from and to');
  assert.deepEqual(sr.periodPatch('year'), { period: 'year', month: '', from: '', to: '' }, 'Whole year clears month, from and to');
  assert.deepEqual(sr.periodPatch('range'), { period: 'range', month: '', year: '' }, 'Custom dates clears month and year');
});

test('#23: the period select applies that patch, and no other period key is left in the link', () => {
  const src = read('stayreports.js');
  assert.match(src, /onchange: \(e\) => setPeriod\(periodPatch\(e\.target\.value\)\)/);
  assert.doesNotMatch(src, /onchange: \(e\) => setPeriod\(\{ period: e\.target\.value \}\)/, 'the old select patch kept the other keys');
});

// #25
test('#25: a link with a from or to date and no period reads as a custom range; a link with a period keeps its own', () => {
  assert.equal(typeof sr.periodFromLink, 'function', 'stayreports.js should export periodFromLink');
  assert.equal(sr.periodFromLink({ from: '2026-09-01', to: '2026-09-30' }), 'range');
  assert.equal(sr.periodFromLink({ to: '2026-09-30' }), 'range');
  assert.equal(sr.periodFromLink({ period: 'range', from: '2026-09-01', to: '2026-09-30' }), 'range');
  assert.equal(sr.periodFromLink({ period: 'year', year: '2025' }), 'year');
  assert.equal(sr.periodFromLink({ month: '2026-09' }), '', 'a bare month link has no period');
  assert.equal(sr.periodFromLink({}), '');
});

test('#25: the view reads a dated link with no period as a custom range before it draws the bar', () => {
  const src = read('stayreports.js');
  assert.match(src, /if \(!filters\.period\) filters\.period = periodFromLink\(query\);/);
  assert.ok(src.indexOf('filters.period = periodFromLink(query)') < src.indexOf("let windowLink = "), 'the link period is read before the window check');
});

test('#25: a link date that is not a real day shows its own status line, and both link dates are dropped from the address', () => {
  const src = read('stayreports.js');
  assert.match(src, /let linkInvalid = periodFromLink\(query\) === 'range' && \[query\.from, query\.to\]\.some\(\(v\) => v && !isDay\(v\)\);/);
  assert.match(src, /if \(linkInvalid\) Object\.assign\(filters, \{ period: '', from: '', to: '' \}\);/);
  assert.match(src, /status\.textContent = linkInvalid \? 'The dates in this link aren\\'t valid\. Showing this month for now\.'/);
  assert.match(src, /const setPeriod = \(patch\) => \{ windowLink = false; linkInvalid = false;/, 'a period change clears the status line');
});

// #27
test('#27: the P&L basis note says what the month counts, and points to the Reports figure', () => {
  const src = read('pnl.js');
  assert.match(src, /basis\.textContent = `Counts stays that checked out in \$\{fmtMonth\(month\)\}\. Upcoming stays are not in this total\. Reports counts nights in the month, including upcoming stays\.`/);
  assert.doesNotMatch(src, /\(finished stays only\)/);
});

test('#27: the Performance note says what the period counts, and what Profit and loss counts', () => {
  const src = read('stayreports.js');
  assert.match(src, /const when = periodQ\.year \? String\(periodQ\.year\) : periodQ\.from \? 'the dates you chose' : monthName\(r\.period\);/);
  assert.match(src, /`Counts nights in \$\{when\}, including upcoming confirmed stays\. Profit and loss counts only stays that have checked out\.`/);
});

// #28
test('#28: the All tab lists active add-ons only; the Archived tab lists the archived ones', () => {
  const src = read('addons.js');
  assert.match(src, /const archivedTab = filters\.status === 'archived';/);
  assert.match(src, /const shown = addons\.filter\(\(a\) => matches\(a\) && Boolean\(a\.active\) !== archivedTab\);/);
  assert.doesNotMatch(src, /\(!filters\.status \|\| \(filters\.status === 'active'\) === a\.active\)/, 'the old All tab showed archived copies');
});

test('#28: the All tab says how many archived add-ons are not shown, with a link to the Archived tab', () => {
  const src = read('addons.js');
  assert.match(src, /const hidden = filters\.status \? 0 : addons\.filter\(\(a\) => matches\(a\) && !a\.active\)\.length;/);
  assert.match(src, /`\$\{hidden\} archived add-on\$\{hidden === 1 \? '' : 's'\} not shown\. `/);
  assert.match(src, /h\('a', \{ href: '#\/addons\?status=archived', class: 'link-tap' \}, 'See Archived'\)/);
  assert.match(src, /box\.replaceChildren\(\.\.\.\[content, note\]\.filter\(Boolean\)\);/, 'a zero count adds no line');
});
