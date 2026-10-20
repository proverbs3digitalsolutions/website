'use strict';
require('./helpers');

// QA r30 OPS-1: an emptied day box on Daily close never navigates. The warning (about the address's date) goes, and a box left
// empty shows the page's day again. Frontend-only: the view runs from a temp copy with stub UI modules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'dailyclose.js'), 'utf8');

test('source: the warning is built once as msgBox and rendered; the two picker listeners are as designed', () => {
  assert.match(SRC, /const msgBox = message && h\('div', \{ class: 'alert alert--warn', id: 'dc-date-msg', role: 'alert' \}, message\);/);
  assert.match(SRC, /\n    msgBox,\n/, 'the rendered warning is msgBox');
  assert.match(SRC, /picker\.addEventListener\('change', \(\) => \{\n    if \(isRealDate\(picker\.value\)\) go\(\);\n    else if \(!picker\.value && msgBox\) \{ msgBox\.remove\(\); picker\.removeAttribute\('aria-describedby'\); \}\n  \}\);/);
  assert.match(SRC, /picker\.addEventListener\('blur', \(\) => \{ if \(!picker\.value\) picker\.value = date; else settle\(\); \}\);/);
});

let dailyclose; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r30-dailyclose-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'api.js'), [
    'export const get = async (p) => (p.startsWith("/daily-closes") ? { closes: [] } : { closed: null, sections: [] });',
    'export const post = async () => ({});',
    'export const qs = (o) => { const e = Object.entries(o).filter(([, v]) => v); return e.length ? "?" + e.map(([k, v]) => k + "=" + v).join("&") : ""; };',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'ui.js'), [
    'export const h = (tag, attrs, ...kids) => { const n = { tag, attrs: { ...(attrs || {}) }, kids: kids.flat(Infinity).filter((k) => k !== false && k !== null && k !== undefined), on: {}, value: attrs && attrs.value,',
    '  addEventListener(t, f) { this.on[t] = f; }, removeAttribute(k) { delete this.attrs[k]; }, removed: false, remove() { this.removed = true; } }; return n; };',
    'export const peso = (v) => `P${v}`;',
    'export const fmtDate = (d) => String(d);',
    'export const fmtDateTime = (d) => String(d);',
    'export const field = () => ({});',
    'export const formModal = () => {};',
    'export const emptyState = () => ({});',
    'export const toast = () => {};',
    'export const confirmDialog = () => {};',
    "export const todayManila = () => '2026-10-14';",
  ].join('\n'));
  const reservations = fs.readFileSync(path.join(__dirname, '../public/js/views/reservations.js'), 'utf8');
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), reservations.match(/export function addDays[\s\S]*?\n}\n/)[0]);
  fs.copyFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'dailyclose.js'), path.join(dir, 'views', 'dailyclose.js'));
  dailyclose = await import(pathToFileURL(path.join(dir, 'views', 'dailyclose.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function find(nodes, pred) {
  let found = null;
  const walk = (n) => { if (!n || typeof n !== 'object' || found) return; if (pred(n)) { found = n; return; } (n.kids || []).forEach(walk); };
  nodes.forEach(walk);
  return found;
}

test('an emptied box removes the warning and does not navigate; a blur while empty shows the page day again', async () => {
  globalThis.location = { hash: '#/daily-close?date=1900-01-01' };
  const el = { nodes: [], replaceChildren(...nodes) { this.nodes = nodes; } };
  await dailyclose.dailyCloseView(el, { query: { date: '1900-01-01' }, rerender() {} });
  const picker = find(el.nodes, (n) => n.tag === 'input' && n.attrs.type === 'date');
  const msg = find(el.nodes, (n) => n.attrs && n.attrs.id === 'dc-date-msg');
  assert.ok(picker && msg, 'the box and the warning are on the page');
  assert.equal(picker.value, '2026-10-14', 'the box shows today');
  assert.equal(picker.attrs['aria-describedby'], 'dc-date-msg');

  picker.value = '';
  picker.on.change();
  assert.equal(msg.removed, true, 'the warning is gone');
  assert.equal(picker.attrs['aria-describedby'], undefined, 'and the box no longer points at it');
  assert.equal(location.hash, '#/daily-close?date=1900-01-01', 'nothing navigates');

  picker.on.blur();
  assert.equal(picker.value, '2026-10-14', 'left empty, the box reads the page day again');

  picker.value = '2026-10-10';
  picker.on.blur();
  assert.equal(picker.value, '2026-10-10', 'a filled box is left alone');
  picker.on.change();
  assert.equal(location.hash, '#/daily-close?date=2026-10-10', 'a filled box still navigates');
});
