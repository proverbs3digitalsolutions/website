'use strict';

// QA round 4, C09 cleaner pay (ops#21). Adding a rate for a cleaner who already has one asks
// before it is replaced; editing a rate does not ask, and Cancel keeps the rate dialog open.
// Frontend-only: no database.
// node --test --test-concurrency=1 test/qa-r4-c09.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/cleanerpay.js'), 'utf8');

let view; let dir;
test.before(async () => {
  globalThis.Element = class { }; // ui.js names the DOM Element class at load time; a stub is enough here
  // The view imports app.js for the signed-in user, so load it from a temp copy with a stub app.js.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-cleanerpay-r4-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'i18n.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: null, requireEmailVerification: true };\n');
  fs.copyFileSync(path.join(__dirname, '../public/js/views/cleanerpay.js'), path.join(dir, 'views', 'cleanerpay.js'));
  view = await import(pathToFileURL(path.join(dir, 'views', 'cleanerpay.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// Shaped like GET /cleaner-rates: a team member's rate has no assignee_name; an outside cleaner's has no user_id.
const rates = [
  { rate_id: 'r1', user_id: 'u-nena', assignee_name: null, name: 'Nena Reyes', rate_type: 'per_hour', amount: '75.00' },
  { rate_id: 'r2', user_id: null, assignee_name: 'Jun', name: 'Jun', rate_type: 'per_clean', amount: '400.00' },
];

test('a new rate for a team member who already has one finds that rate', () => {
  assert.equal(view.existingRate(rates, { user_id: 'u-nena', rate_type: 'per_clean', amount: '95' }), rates[0]);
});

test('a new rate for an outside cleaner matches the name whatever the case and spaces', () => {
  assert.equal(view.existingRate(rates, { assignee_name: '  jun ', rate_type: 'per_clean', amount: '450' }), rates[1]);
  assert.equal(view.existingRate(rates, { assignee_name: 'JUN' }), rates[1]);
});

test('a first rate for someone with no rate finds nothing', () => {
  assert.equal(view.existingRate(rates, { user_id: 'u-other' }), undefined);
  assert.equal(view.existingRate(rates, { assignee_name: 'Ana' }), undefined);
});

test('an outside name does not match a team member rate, because the server keeps them apart', () => {
  assert.equal(view.existingRate(rates, { assignee_name: 'Nena Reyes' }), undefined);
});

test('a blank outside name matches nothing, even a rate with no name', () => {
  assert.equal(view.existingRate([{ rate_id: 'r3', user_id: null, assignee_name: null, name: 'Cleaner' }], { assignee_name: '' }), undefined);
});

test('the Add rate save asks before it replaces a rate, and only a new rate is checked', () => {
  const prior = src.indexOf('const prior = !r && existingRate(rates, body)');
  const ask = src.indexOf('confirmDialog({', prior);
  const save = src.indexOf("await api('PUT', '/cleaner-rates', body)");
  assert.ok(prior > 0, 'the add path looks for an existing rate, and not when editing');
  assert.ok(ask > prior && ask < save, 'the question comes after the lookup and before the save');
  assert.match(src, /already has/);
  assert.match(src, /Change it to/);
  assert.match(src, /confirmText: 'Change rate'/);
});

test('while the question waits the Save button reads Save rate; Saving… is set only once the change is confirmed', () => {
  const prior = src.indexOf('const prior = !r && existingRate(rates, body)');
  const ask = src.indexOf('confirmDialog({', prior);
  const save = src.indexOf("await api('PUT', '/cleaner-rates', body)");
  const reset = src.lastIndexOf("submit.textContent = 'Save rate'", ask);
  const saving = src.indexOf("submit.textContent = 'Saving…'", ask);
  assert.ok(reset > prior && reset < ask, 'the label is put back to Save rate before the question opens');
  assert.ok(saving > ask && saving < save, 'Saving… is set after the answer, just before the save');
});

test('Cancel keeps the rate dialog open: it closes only after the save goes through', () => {
  const save = src.indexOf("await api('PUT', '/cleaner-rates', body)");
  const close = src.indexOf('modal.close();', save);
  assert.ok(close > save, 'the dialog closes after the save, not before');
  assert.doesNotMatch(src, /formModal\(\{\s*title: r \?/);
});

test('no window alert, confirm or prompt is used', () => {
  assert.doesNotMatch(src, /\b(alert|confirm|prompt)\(/);
});
