'use strict';

// QA round 24, lane PRICING: MNY-1 (Edit pricing rule must not leave focus on a disabled control) and
// MNY-2 (a negative bulk price says "cannot be negative"). Pure: no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/views/pricing.js'), 'utf8');
let view; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-pricing-r24-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'rates.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { role: \'owner\' } };\n');
  const reservations = fs.readFileSync(path.join(__dirname, '../public/js/views/reservations.js'), 'utf8');
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), reservations.match(/export function addDays[\s\S]*?\n}\n/)[0]);
  fs.copyFileSync(path.join(__dirname, '../public/js/views/pricing.js'), path.join(dir, 'views', 'pricing.js'));
  globalThis.Element = class { };
  view = await import(pathToFileURL(path.join(dir, 'views', 'pricing.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const ok = { from: '2031-06-01', to: '2031-06-05', action: 'set', price: '2500', unit_ids: ['u1'] };

test('MNY-2: a negative bulk price says cannot be negative; zero keeps greater than zero', () => {
  assert.equal(view.bulkProblems({ ...ok, price: '-100' }).price, 'New price per night cannot be negative.');
  assert.equal(view.bulkProblems({ ...ok, price: '0' }).price, 'New price per night must be greater than zero.');
  assert.equal(view.bulkProblems({ ...ok, price: '2500' }).price, undefined);
});

test('MNY-1: editRule disables Rule and Applies to before the dialog opens, not after', () => {
  const body = SRC.slice(SRC.indexOf('const editRule'), SRC.indexOf('const removeRule'));
  const open = body.indexOf('formModal(');
  assert.ok(open > 0);
  const before = body.slice(0, open);
  assert.match(before, /if \(r\)[^;\n]*kindSel[^;\n]*disabled = true/);
  assert.match(before, /scopeField[^;\n]*disabled = true/);
  assert.doesNotMatch(body.slice(open), /elements\.kind\.disabled = true/);
  assert.doesNotMatch(body.slice(open), /elements\.unit_id\.disabled = true/);
});
