'use strict';

// QA round 5, lane C16 (calendar and daily close). Frontend-only: no database.
// #2: a blank Set nightly price save says how many nights were cleared.
// #3: a large nightly price is shortened inside its calendar cell; the full amount stays in the title and aria-label.
// #5: the Payments recorded count is a neutral badge; open work keeps the amber one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const CALENDAR_JS = path.join(__dirname, '..', 'public', 'js', 'views', 'calendar.js');
const DAILYCLOSE_JS = path.join(__dirname, '..', 'public', 'js', 'views', 'dailyclose.js');
const calendarSource = fs.readFileSync(CALENDAR_JS, 'utf8');

// The text of a one-line top-level `const name = ...;` in calendar.js.
function declared(name) {
  const m = calendarSource.match(new RegExp(`^const ${name} = (.+);$`, 'm'));
  assert.ok(m, `${name} is a one-line const in calendar.js`);
  return m[1];
}

test('a blank Set nightly price save says how many nights were cleared: one night and more than one read differently', () => {
  // The toast argument on the blank-save line, evaluated with the server's cleared count.
  const toastArg = calendarSource.match(/^\s*if \(d\.price\.trim\(\) === ''\) toast\((res\.cleared > 0 \?.*)\);$/m);
  assert.ok(toastArg, 'the blank save toasts a message chosen by the cleared count');
  const message = (cleared) => new Function('res', `return ${toastArg[1]};`)({ cleared });
  assert.equal(message(0), 'No set prices to clear. These nights already use your usual rates.');
  assert.equal(message(1), 'Set prices cleared for 1 night. This night uses your usual rates again.');
  assert.equal(message(2), 'Set prices cleared for 2 nights. These nights use your usual rates again.');
  assert.equal(message(3), 'Set prices cleared for 3 nights. These nights use your usual rates again.');
  assert.doesNotMatch(calendarSource, /Set prices cleared\. These nights/, 'the message without a count is gone');
});

test('a large nightly price is shortened in its cell; the full amount stays in the title and aria-label', () => {
  const cellPeso = new Function(`const shortPeso = ${declared('shortPeso')};\nconst compactPeso = ${declared('compactPeso')};\nreturn ${declared('cellPeso')};`)();
  assert.equal(cellPeso(2800), '₱2,800', 'an ordinary price is unchanged');
  assert.equal(cellPeso(99999), '₱99,999', 'just under ₱100,000 is unchanged');
  assert.equal(cellPeso(100000), '₱100K', 'from ₱100,000 up the cell shows the short form');
  assert.equal(cellPeso(1000000), '₱1M');
  assert.equal(cellPeso('1234567.00'), '₱1.2M', 'a price read as text from the API is shortened too');
  assert.equal(cellPeso(null), '', 'a night with no price shows nothing');
  assert.match(calendarSource, /\}, cellPeso\(price\)\);/, 'the cell text is cellPeso(price)');
  assert.match(calendarSource, /'aria-label': `\$\{l\.unit_name\}, \$\{fmtDate\(d\)\}, \$\{shortPeso\(price\) \|\| 'no rate'\}\$\{why\}`/, 'the aria-label keeps the full amount');
  assert.match(calendarSource, /title: [^\n]*shortPeso\(price\)/, 'the title carries the full amount');
});

// The daily close view is run from a temp copy with stub UI modules, so the test reads the real section markup.
let dailyclose; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c16-dailyclose-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'api.js'), [
    'export const get = async (p) => (p.startsWith("/daily-closes") ? { closes: [] } : globalThis.__c16Day);',
    'export const post = async () => ({});',
    'export const qs = () => "";',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'ui.js'), [
    'export const h = (tag, attrs, ...kids) => ({ tag, attrs: attrs || {}, kids: kids.flat(Infinity).filter((k) => k !== false && k !== null && k !== undefined), addEventListener() {} });',
    'export const peso = (v) => `₱${v}`;',
    'export const fmtDate = (d) => String(d);',
    'export const fmtDateTime = (d) => String(d);',
    'export const field = () => ({});',
    'export const formModal = () => {};',
    'export const emptyState = () => ({});',
    'export const toast = () => {};',
    "export const todayManila = () => '2026-10-14';",
  ].join('\n'));
  // The real addDays, copied from reservations.js so the test cannot drift from it.
  const reservations = fs.readFileSync(path.join(__dirname, '../public/js/views/reservations.js'), 'utf8');
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), reservations.match(/export function addDays[\s\S]*?\n}\n/)[0]);
  fs.copyFileSync(DAILYCLOSE_JS, path.join(dir, 'views', 'dailyclose.js'));
  dailyclose = await import(pathToFileURL(path.join(dir, 'views', 'dailyclose.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const k of node.kids || []) walk(k, visit);
}

test('the Payments recorded count is a neutral badge; open work keeps the amber badge', async () => {
  globalThis.__c16Day = { closed: null, sections: [
    { key: 'payments_today', title: 'Payments recorded', count: 10, items: [], by_method: [], total: 46235 },
    { key: 'cleanings_open', title: 'Cleanings open', count: 4, items: [{ text: 'Unit 1', link: '#/housekeeping' }], by_method: [], total: null },
  ] };
  const el = { nodes: [], replaceChildren(...nodes) { this.nodes = nodes; } };
  await dailyclose.dailyCloseView(el, { query: {}, rerender() {} });
  const sectionFor = (key) => {
    let found = null;
    for (const n of el.nodes) walk(n, (x) => { if (!found && x.tag === 'section' && x.attrs['aria-labelledby'] === `dc-${key}`) found = x; });
    assert.ok(found, `the ${key} section is on the page`);
    return found;
  };
  const countBadge = (key) => {
    let found = null;
    walk(sectionFor(key), (x) => { if (!found && x.tag === 'span' && /\bbadge\b/.test(x.attrs.class || '')) found = x; });
    assert.ok(found, `the ${key} section has a count badge`);
    return found;
  };
  assert.equal(countBadge('payments_today').attrs.class, 'badge', 'a record uses the neutral badge, not the amber one');
  assert.equal(countBadge('cleanings_open').attrs.class, 'badge badge--partial', 'open work keeps the amber badge');
});
