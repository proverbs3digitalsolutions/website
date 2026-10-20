'use strict';

// QA r24 TOPBAR (CARD-1): while the card is due the top bar shows only Help and the account menu; "/" does nothing; the
// profile menu has no Bookmarks. topbarButtons and isSlashShortcut run in node from a temp copy; the rest are source scans.
// Frontend-only: no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'public/js');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
const src = strip(fs.readFileSync(path.join(JS, 'topbar.js'), 'utf8'));

let m;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r24tb-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'themeswitch.js', 'topbar.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  m = await import(pathToFileURL(path.join(dir, 'topbar.js')));
});

const user = (o = {}) => ({ role: 'owner', business_type: 'short_term', plan: {}, ...o });

test('topbarButtons: a card-due owner gets only Help and the account menu', () => {
  assert.deepEqual(m.topbarButtons(user({ plan: { card_check_due: true, read_only: true } })), ['help', 'profile']);
  assert.deepEqual(m.topbarButtons(user({ business_type: 'long_term', plan: { card_check_due: true } })), ['help', 'profile']);
});

test('topbarButtons: a normal owner is unchanged', () => {
  assert.deepEqual(m.topbarButtons(user()), ['search', 'bookmarks', 'add', 'bell', 'help', 'profile']);
  assert.deepEqual(m.topbarButtons(user({ plan: { card_check_due: false } })), ['search', 'bookmarks', 'add', 'bell', 'help', 'profile']);
});

const doc = (o = {}) => ({ querySelector: (sel) => ({ 'dialog[open]': null, '.topbar': {}, '.topbar [data-tb="search"]': o.searchHidden ? { hidden: true } : { hidden: false } })[sel] ?? null });
const ev = () => ({ key: '/', ctrlKey: false, metaKey: false, altKey: false, target: { tagName: 'BODY', isContentEditable: false, closest: () => null } });

test('isSlashShortcut: "/" does nothing while the search control is hidden', () => {
  assert.equal(m.isSlashShortcut(ev(), doc()), true);
  assert.equal(m.isSlashShortcut(ev(), doc({ searchHidden: true })), false);
});

test('updateTopbar hides and shows the desktop search slot with the search control', () => {
  const upd = src.slice(src.indexOf('export function updateTopbar'));
  assert.match(upd, /\.tb__search/);
  assert.match(upd, /want\.includes\('search'\)/);
});

test('buildProfile leaves Bookmarks out while the card is due', () => {
  const prof = src.slice(src.indexOf('function buildProfile'), src.indexOf('// Add new has nothing'));
  assert.match(prof, /card_check_due/);
  assert.match(prof, /'Bookmarks'/);
});
