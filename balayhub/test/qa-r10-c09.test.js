'use strict';

// QA round 10, lane C09 (reports-filters). #18: the Performance Revenue and Income summary Revenue earned tiles say what they count.
// #20: a P&L month must be YYYY-MM with a year from 2000 to 2100, and its notice sits above the month picker.
// K9: a custom From or To box on the stay report outside 2000 to 2100 says so at the box and sends nothing.
// K10: a backwards range from a link never restores an out-of-window date, and the status names the real problem.
// K11: a date range applies its valid end when the other end is outside 2000 to 2100; the bad end is flagged.
// The search box takes its screen-reader name from search.label, and keeps the short placeholder.
// Frontend only, no database: filters.js and views/pnl.js are copied next to a stub app.js, as qa-r9-c14 does.
// The stay report view imports app.js and other views, so its checks read the source.
// node --test --test-concurrency=1 test/qa-r10-c09.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', rel), 'utf8');

class Node { }
class Text extends Node { constructor(data) { super(); this.data = data; } }
const toNode = (n) => (n instanceof Node ? n : new Text(String(n)));
class Element extends Node {
  constructor(tag) { super(); Object.assign(this, { tagName: tag, attrs: {}, children: [], listeners: {}, style: {}, dataset: {}, className: '' }); }
  get hidden() { return 'hidden' in this.attrs; }
  set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type) { for (const fn of this.listeners[type] || []) fn({ target: this, type }); }
  append(...nodes) { this.children.push(...nodes.map(toNode)); }
  replaceChildren(...nodes) { this.children = nodes.map(toNode); }
}
globalThis.Node = Node;
globalThis.Element = Element;
globalThis.document = { createElement: (tag) => new Element(tag), createTextNode: (data) => new Text(data) };
const walk = (node, pred, out = []) => {
  if (node instanceof Element) { if (pred(node)) out.push(node); node.children.forEach((c) => walk(c, pred, out)); }
  return out;
};
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
globalThis.location = { hash: '' };
globalThis.history = { replaceState: (s, t, url) => { globalThis.location.hash = url; } };

let dir; let filters; let pnl;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r10-c09-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.copyFileSync(path.join(__dirname, '../public/js/views/pnl.js'), path.join(dir, 'views', 'pnl.js'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { user_id: 1 } };\n');
  filters = await import(pathToFileURL(path.join(dir, 'filters.js')));
  pnl = await import(pathToFileURL(path.join(dir, 'views', 'pnl.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => { store.clear(); });

const find = (bar, label) => walk(bar, (el) => el.tagName === 'input' && el.getAttribute('aria-label') === label)[0];
const alertTexts = (bar) => walk(bar, (el) => el.getAttribute('role') === 'alert').map((el) => el.children.map((c) => c.data).join(''));

// #20: P&L month

test('#20: a P&L month is YYYY-MM with a month 01 to 12 and a year 2000 to 2100', () => {
  const { MONTH_RE } = pnl;
  assert.ok(MONTH_RE instanceof RegExp, 'pnl.js should export MONTH_RE for the check');
  for (const ok of ['2026-10', '2000-01', '2100-12']) assert.equal(MONTH_RE.test(ok), true, ok);
  for (const bad of ['2026-13', '2026-00', '2026-1', '1999-12', '2101-01', '0202-01', 'abc']) assert.equal(MONTH_RE.test(bad), false, bad);
});

test('#20: the bad-month notice sits above the month picker, keeps its wording, and the address takes the month shown', () => {
  const src = read('views/pnl.js');
  assert.match(src, /if \(bad\) filters\.month = thisMonth;/);
  assert.match(src, /basis, notice, bar, box\)/, 'the notice is drawn above the filter bar that holds the month picker');
  assert.match(src, /That month isn't valid\. Showing \$\{monthName\(month\)\}\./);
});

// K11: date range

test('K11: rangeCheck applies the valid end and flags the end outside 2000 to 2100', () => {
  assert.equal(filters.OUT_OF_WINDOW, 'Enter a year from 2000 to 2100.');
  const r = filters.rangeCheck('2026-10-01', '0202-01-01');
  assert.equal(r.keepFrom, true, 'the valid start is kept');
  assert.equal(r.keepTo, false, 'the year 0202 is not kept');
  assert.equal(r.message, filters.OUT_OF_WINDOW);
  assert.deepEqual(r.flags, { from: false, to: true });
  assert.equal(filters.rangeCheck('2026-10-01', '2026-10-05').message, '', 'a valid range has no message');
  const back = filters.rangeCheck('2026-10-05', '2026-10-01');
  assert.equal(back.keepFrom, false, 'a backwards pair applies neither end');
  assert.equal(back.keepTo, false);
});

test('K11: the date-range bar applies 2026-10-01, leaves 0202-01-01 out, and flags that box without a reload', () => {
  const values = { from: '', to: '' };
  let n = 0;
  const bar = filters.filterBar({ key: 'r10c09-range', values, defaults: { from: '', to: '' },
    more: [{ name: 'from', keys: ['from', 'to'], label: 'Between', type: 'daterange' }], onChange: () => { n += 1; } });
  const fromBox = find(bar, 'Between, from');
  const toBox = find(bar, 'Between, to');
  fromBox.value = '2026-10-01'; fromBox.dispatch('change');
  assert.equal(values.from, '2026-10-01', 'the valid start is applied');
  assert.equal(n, 1);
  toBox.value = '0202-01-01'; toBox.dispatch('change');
  assert.equal(values.from, '2026-10-01', 'the valid start stays applied');
  assert.equal(values.to, '', 'the year 0202 is not applied');
  assert.equal(n, 1, 'nothing changed, so the list is not reloaded');
  assert.equal(toBox.getAttribute('aria-invalid'), 'true');
  assert.equal(fromBox.getAttribute('aria-invalid'), null);
  assert.ok(alertTexts(bar).some((t) => t === 'Enter a year from 2000 to 2100.'), 'the window message is shown in the range alert');
});

// Search box name

test('the search box takes its screen-reader name from search.label and keeps the short placeholder', () => {
  const bar = filters.filterBar({ key: 'r10c09-search', values: { q: '' }, defaults: { q: '' },
    search: { placeholder: 'Guest, code or listing', label: 'Search guest, code or listing' }, onChange() {} });
  const box = walk(bar, (el) => el.tagName === 'input' && el.getAttribute('type') === 'search')[0];
  assert.equal(box.getAttribute('aria-label'), 'Search guest, code or listing');
  assert.equal(box.getAttribute('placeholder'), 'Guest, code or listing');
});

test('the search box name comes from search.label, with the placeholder and "Search" as fallbacks (source)', () => {
  assert.match(read('filters.js'), /'aria-label': search\.label \|\| search\.placeholder \|\| 'Search'/);
});

test('the search box falls back to its placeholder as the name when no label is given', () => {
  const bar = filters.filterBar({ key: 'r10c09-search2', values: { q: '' }, defaults: { q: '' },
    search: { placeholder: 'Find a stay' }, onChange() {} });
  const box = walk(bar, (el) => el.tagName === 'input' && el.getAttribute('type') === 'search')[0];
  assert.equal(box.getAttribute('aria-label'), 'Find a stay');
});

// #18, K9, K10: stay reports (source checks)

const stay = read('views/stayreports.js');

test('#18: the Performance Revenue tile and the Income summary Revenue earned tile say what they count', () => {
  assert.match(stay, /'Rooms counted by night; cleaning and extras by check-in\.'/);
  assert.match(stay, /stat\('Revenue earned', peso\(t\.totals\.revenue\), 'Nights counted in their month; cleaning and extras at check-in\.'\)/);
});

test('K9: the custom From and To boxes check the 2000 to 2100 window before anything is sent', () => {
  assert.match(stay, /import \{[^}]*\boutOfWindow\b[^}]*\} from '\.\.\/filters\.js';/);
  assert.match(stay, /import \{[^}]*\bOUT_OF_WINDOW\b[^}]*\} from '\.\.\/filters\.js';/);
  assert.doesNotMatch(stay, /onchange: \(e\) => setPeriod\(\{ from: e\.target\.value \}\)/, 'the From box no longer sends its raw value');
  assert.doesNotMatch(stay, /onchange: \(e\) => setPeriod\(\{ to: e\.target\.value \}\)/, 'the To box no longer sends its raw value');
  assert.match(stay, /if \(outOfWindow\(e\.target\.value\)\) \{[^}]*return; \}\s*setPeriod\(\{ \[key\]: e\.target\.value \}\)/,
    'an out-of-window date returns before setPeriod, so nothing is sent');
});

test('K10: a backwards link range restores only dates inside the window, and the status names the window problem', () => {
  assert.match(stay, /query\.to < query\.from && !outOfWindow\(query\.from\) && !outOfWindow\(query\.to\)/,
    'the restore never puts back an out-of-window date');
  assert.match(stay, /let windowLink = /, 'the view remembers that the link had an out-of-window date');
  assert.match(stay, /windowLink \? `\$\{OUT_OF_WINDOW\} Showing this month for now\.`/, 'the status line names the window problem first');
  assert.match(stay, /'The end date must be after the start date\. Showing this month for now\.'/, 'the backwards wording stays for dates inside the window');
});
