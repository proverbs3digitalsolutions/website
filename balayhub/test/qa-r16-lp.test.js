'use strict';

// QA round 16, lane LP (launchpad). Frontend only: no database.
// #34 (O5, S2): the current phase stays open, later phases fold under "Later".
// node --test --test-concurrency=1 test/qa-r16-lp.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const file = path.join(__dirname, '..', 'public', 'js', 'views', 'launchpad.js');
const src = fs.readFileSync(file, 'utf8');
let lp; let dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r16-lp-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'api.js'), 'export const get = async () => ({}); export const post = async () => ({});\n');
  fs.writeFileSync(path.join(dir, 'ui.js'), 'export const h = () => null; export const icon = () => null; export const toast = () => {};\n');
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { role: "owner", full_name: "A B" } };\n');
  fs.copyFileSync(file, path.join(dir, 'views', 'launchpad.js'));
  lp = await import(pathToFileURL(path.join(dir, 'views', 'launchpad.js')).href);
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const phases = ['a', 'b', 'c', 'd', 'e'].map((key) => ({ key }));
const mk = (doneUpTo) => phases.flatMap((ph, i) => [1, 2].map((n) => ({ key: `${ph.key}${n}`, phase: ph.key, done: i < doneUpTo, skipped: false }))).slice(0, 11);

describe('#34 splitPhases', () => {
  it('11 open steps in 5 phases: first phase shown, the rest counted under Later', () => {
    const r = lp.splitPhases(phases, mk(0));
    assert.deepEqual(r.shown.map((p) => p.key), ['a']);
    assert.deepEqual(r.later.map((p) => p.key), ['b', 'c', 'd', 'e']);
    assert.equal(r.laterCount, 8);
  });
  it('phase 1 settled: phases 1 and 2 are shown', () => {
    const r = lp.splitPhases(phases, mk(1));
    assert.deepEqual(r.shown.map((p) => p.key), ['a', 'b']);
    assert.equal(r.laterCount, 6);
  });
  it('a skipped step counts as settled', () => {
    const steps = mk(0).map((x) => (x.phase === 'a' ? { ...x, skipped: true } : x));
    assert.deepEqual(lp.splitPhases(phases, steps).shown.map((p) => p.key), ['a', 'b']);
  });
  it('all settled: nothing folds', () => {
    const r = lp.splitPhases(phases, mk(5));
    assert.deepEqual(r.later, []);
    assert.equal(r.shown.length, 5);
  });
});

describe('#34 view wiring', () => {
  it('the fold, its summary, its sticky open state and the full-count hero line', () => {
    assert.match(src, /class: 'lpad-later card'/);
    assert.match(src, /`Later \(\$\{laterCount\} more step\$\{laterCount === 1 \? '' : 's'\}\)`/);
    assert.match(src, /laterFold\.addEventListener\('toggle'/);
    assert.match(src, /progressLine\(o\)/);
  });
});
