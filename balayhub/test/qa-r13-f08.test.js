'use strict';
// QA round 13, lane F08 (long-term rent, reports, tenants, maintenance; frontend only, no database).
// #24: with "Voided only" the payments and expenses line says the rows are not in the totals (voidedOnlyLine).
// #25: the Reports export hint names an inverted range ("Fix the dates to export.") and keeps the missing-date wording.
// #22, #23: the tenant Archive and Restore buttons and every maintenance status button carry their focus keys.
// node --test --test-concurrency=1 test/qa-r13-f08.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..', 'public', 'js');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const rentSrc = read('views', 'rent.js');
const reportsSrc = read('views', 'reports.js');
const tenantsSrc = read('views', 'tenants.js');
const maintSrc = read('views', 'maintenance.js');

// rent.js and reports.js load from temp copies (the real modules import the app shell, which does not load in Node).
let dir; let rent; let reports;
test.before(async () => {
  globalThis.Element = class { };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r13-f08-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner', business_type: 'long_term' } };\nexport const navigate = () => {};\n");
  for (const f of ['rent.js', 'reports.js']) fs.copyFileSync(path.join(root, 'views', f), path.join(dir, 'views', f));
  rent = await import(pathToFileURL(path.join(dir, 'views', 'rent.js')).href);
  reports = await import(pathToFileURL(path.join(dir, 'views', 'reports.js')).href);
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('#24 the Voided only line says the entries are not in the totals, singular and plural', () => {
  assert.equal(rent.voidedOnlyLine(3), 'Voided only: 3 entries, not counted in totals.');
  assert.equal(rent.voidedOnlyLine(1), 'Voided only: 1 entry, not counted in totals.');
});

test('#24 the payments and expenses lines use it while Voided only is chosen', () => {
  assert.equal((rentSrc.match(/include_voided === 'only'/g) || []).length, 2, 'one check each for payments and expenses');
  assert.match(rentSrc, /voidedOnlyLine\(payments\.length\)/);
  assert.match(rentSrc, /voidedOnlyLine\(expenses\.length\)/);
});

test('#25 the export hint names an inverted range and keeps the missing-date wording', () => {
  assert.equal(reports.exportHint({ from: '2026-10-10', to: '2026-10-01' }), 'Fix the dates to export.');
  assert.equal(reports.exportHint({ from: '2026-10-01', to: '' }), 'Pick both dates to export.');
  assert.equal(reports.exportHint({ from: '', to: '2026-10-01' }), 'Pick both dates to export.');
  assert.equal(reports.exportHint({}), 'Pick both dates to export.');
});

test('#25 the hint reads the Custom dates boxes, because a backwards pair is cleared in the filter values', () => {
  assert.match(reportsSrc, /boxByLabel\(barBox, 'Custom dates, from'\)/);
  assert.match(reportsSrc, /boxByLabel\(barBox, 'Custom dates, to'\)/);
  assert.doesNotMatch(reportsSrc, /querySelector/);
  assert.match(reportsSrc, /exportNote\.textContent = exportHint\(boxDates\(\)\)/);
});

test('#22 the tenant Archive and Restore buttons carry the tenant-archive focus key', () => {
  assert.ok((tenantsSrc.match(/'data-focus-key': 'tenant-archive'/g) || []).length >= 2, 'Archive and Restore');
});

test('#23 every maintenance status button carries the mt-status focus key', () => {
  const block = maintSrc.slice(maintSrc.indexOf('const statusButtons'), maintSrc.indexOf('const edit = '));
  assert.ok(block.length > 0, 'statusButtons block found');
  assert.ok(block.includes("'data-focus-key': 'mt-status'"));
});

test('none of the four views moves focus after its own redraw, or imports a removed focus helper', () => {
  for (const src of [rentSrc, reportsSrc, tenantsSrc, maintSrc]) {
    assert.doesNotMatch(src, /\b(rerender|load\w*)\(\)\s*;?\s*[^;\n]*\.focus\(/);
    assert.doesNotMatch(src, /\b(keepFocus|snapshotControl|findReplacement|sameControl|restoreTabFocus|FOCUS_CHECKS)\b/);
  }
});
