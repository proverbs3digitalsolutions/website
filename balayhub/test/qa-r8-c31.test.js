'use strict';

// QA round 8, lane C31 (supplies and launchpad). #33: a unit ending in "ss" is already singular, so one
// "glass" reads "1 glass", not "1 glas". N1 (D-81, repeated per-row controls): every per-row button or link
// names its row, so two rows never give two controls the same name: the supply Edit, Add stock and Count
// buttons, and the launchpad Open, Skip for now and Show again controls.
// Pure helper loaded from a temp copy of the browser modules, with their browser-only imports stubbed (the same
// approach as test/qa-r2-supplies.test.js). No database is needed.
// node --test --test-concurrency=1 test/qa-r8-c31.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const supplies = fs.readFileSync(path.join(ROOT, 'public/js/views/supplies.js'), 'utf8');
const launchpadSrc = fs.readFileSync(path.join(ROOT, 'public/js/views/launchpad.js'), 'utf8');

let unitWord; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r8-c31-'));
  fs.cpSync(path.join(ROOT, 'public/js'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner' } };\n");
  globalThis.Element = class { };
  ({ unitWord } = await import(pathToFileURL(path.join(dir, 'views/supplies.js')).href));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// ---------------------------------------------------------------- singular of a unit (#33)

test('a unit ending in "ss" is not made singular: one glass, not one glas', () => {
  assert.equal(unitWord(1, 'glass'), 'glass');
  assert.equal(unitWord(1, 'Glass'), 'Glass', 'a capital letter does not change that');
  assert.equal(unitWord(1, 'glasses'), 'glass', 'a plural still becomes singular');
});

test('the other singulars and the plain-count cases are unchanged', () => {
  assert.equal(unitWord(1, 'towels'), 'towel');
  assert.equal(unitWord(1, 'boxes'), 'box');
  assert.equal(unitWord(1, 'batteries'), 'battery');
  assert.equal(unitWord(1, 'bottles'), 'bottle');
  assert.equal(unitWord(1, 'pcs'), 'pcs', 'an abbreviation stays');
  assert.equal(unitWord(2, 'glass'), 'glass', 'two or more keeps the unit as typed');
  assert.equal(unitWord(0, 'towels'), 'towels');
});

// ---------------------------------------------------------------- supply row controls (N1, D-81)

test('the supply Edit button names its row', () => {
  assert.match(supplies, /onclick: \(\) => addOrEdit\(s\), 'aria-label': `Edit \$\{s\.name\}` \}, 'Edit'\)/);
});

test('the supply Add stock and Count buttons name their row', () => {
  assert.match(supplies, /onclick: \(\) => move\(s, 'restocked'\), 'aria-label': `Add stock to \$\{s\.name\}` \}, 'Add stock'\)/);
  assert.match(supplies, /onclick: \(\) => move\(s, 'count'\), 'aria-label': `Count \$\{s\.name\}` \}, 'Count'\)/);
});

// ---------------------------------------------------------------- launchpad row controls (N1, D-81)

test('the launchpad Open link on a finished step names its step', () => {
  assert.match(launchpadSrc, /href: st\.href, 'aria-label': `Open \$\{st\.title\}` \}, 'Open'\)/);
});

test('the launchpad Skip for now and Show again buttons name their step', () => {
  assert.match(launchpadSrc, /onclick: \(\) => skip\(false\), 'aria-label': `Skip for now, \$\{st\.title\}` \}, 'Skip for now'\)/);
  assert.match(launchpadSrc, /onclick: \(\) => skip\(true\), 'aria-label': `Show again, \$\{st\.title\}` \}, 'Show again'\)/);
});
