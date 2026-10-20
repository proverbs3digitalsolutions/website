'use strict';

// QA round 22, lane RENT (public/js/views/rent.js). Frontend only: no database, no server.
// Redrawing the filter bar from inside its own redraw (a blur-time change on the removed Amount box) must queue, not re-enter.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '..', 'public', 'js');
const rentSrc = fs.readFileSync(path.join(SRC, 'views', 'rent.js'), 'utf8');

let rent;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-rent-r22-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner' } };\nexport const navigate = () => {};\n");
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'views', 'rent.js'), rentSrc);
  globalThis.Node ||= class {};
  globalThis.Element ||= class extends globalThis.Node {};
  globalThis.document ||= { createElement: () => ({}), createTextNode: () => ({}) };
  rent = await import(pathToFileURL(path.join(dir, 'views', 'rent.js')));
});

test('a redraw requested during a redraw runs once, after it, never inside it', async () => {
  const log = [];
  let inside = false;
  let run;
  let n = 0;
  run = rent.noReentry(async () => {
    assert.equal(inside, false, 'redraw re-entered');
    inside = true;
    log.push(`start${++n}`);
    if (n === 1) { run(); run(); } // the blur-time change fires twice while the first draw is replacing children
    await Promise.resolve();
    log.push(`end${n}`);
    inside = false;
  });
  await run();
  assert.deepEqual(log, ['start1', 'end1', 'start2', 'end2']);
});

test('a draw that throws still frees the guard for the next one', async () => {
  let calls = 0;
  const run = rent.noReentry(async () => { calls++; if (calls === 1) throw new Error('boom'); });
  await assert.rejects(run(), /boom/);
  await run();
  assert.equal(calls, 2);
});

test('source: onChange commits lastProperty and the vendor source before redrawing', () => {
  const i = rentSrc.indexOf('onChange: () => {');
  const body = rentSrc.slice(i, rentSrc.indexOf('load();', i));
  assert.ok(body.indexOf('lastProperty = f.property_id') > -1 && body.indexOf('lastProperty = f.property_id') < body.indexOf('renderBar()'));
  assert.match(rentSrc, /const renderBar = noReentry\(/);
});
