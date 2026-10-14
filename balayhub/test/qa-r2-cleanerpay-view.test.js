'use strict';

// QA round 2, A14 cleaner pay (ops#4 and C4). A cleaner with a clean whose pay is not set is never
// shown as "All paid"; the top stat and the row point to Set pay. Frontend-only: no database.
// node --test --test-concurrency=1 test/qa-r2-cleanerpay-view.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/cleanerpay.js'), 'utf8');

let view; let ui; let dir;
test.before(async () => {
  globalThis.Element = class { }; // ui.js names the DOM Element class at load time; a stub is enough here
  // The view imports app.js for the signed-in user, so load it from a temp copy with a stub app.js.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-cleanerpay-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'i18n.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: null, requireEmailVerification: true };\n');
  fs.copyFileSync(path.join(__dirname, '../public/js/views/cleanerpay.js'), path.join(dir, 'views', 'cleanerpay.js'));
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
  view = await import(pathToFileURL(path.join(dir, 'views', 'cleanerpay.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const cleaner = (over) => ({ unpaid: '0', paid: '0', unpriced: 0, ...over });

test('a cleaner with a clean whose pay is not set is never All paid', () => {
  assert.equal(view.cleanerStatus(cleaner({ unpriced: 1 })), '1 with pay not set');
  assert.equal(view.cleanerStatus(cleaner({ unpriced: 2, paid: '450.00' })), '2 with pay not set');
});

test('money still owed and clean(s) with no pay set are both shown', () => {
  assert.equal(view.cleanerStatus(cleaner({ unpaid: '450.00', unpriced: 1 })), `${ui.peso(450)} to pay · 1 with pay not set`);
});

test('all priced and paid reads All paid; owed only shows the amount', () => {
  assert.equal(view.cleanerStatus(cleaner({ paid: '450.00' })), 'All paid');
  assert.equal(view.cleanerStatus(cleaner({ unpaid: '450.00' })), `${ui.peso(450)} to pay`);
});

test('the By cleaner card reads its status from cleanerStatus, not an inline All paid', () => {
  assert.match(src, /cleanerStatus\(c\)/);
  assert.doesNotMatch(src, /to pay` : 'All paid'/);
});

test('the top stat says no pay set yet and points to Set pay, not no rate set', () => {
  assert.doesNotMatch(src, /no rate set/);
  assert.match(src, /with no pay set yet\. Use Set pay\./);
});

test('the row points to Set pay; the add-the-hours copy is gone', () => {
  assert.doesNotMatch(src, /add the hours/);
  assert.match(src, /'Pay not set\. Use Set pay\.'/);
});
