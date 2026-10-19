'use strict';
// QA round 17, lane LT (rent view; frontend only, no database).
// #17 short sort label, #19 voided banner hidden in print, #21 expense above 50,000 asks first.
// node --test --test-concurrency=1 test/qa-r17-lt.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..', 'public', 'js');
const src = fs.readFileSync(path.join(root, 'views', 'rent.js'), 'utf8');

let dir; let rent;
test.before(async () => {
  globalThis.Element = class { };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r17-lt-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner', business_type: 'long_term' } };\nexport const navigate = () => {};\n");
  fs.copyFileSync(path.join(root, 'views', 'rent.js'), path.join(dir, 'views', 'rent.js'));
  rent = await import(pathToFileURL(path.join(dir, 'views', 'rent.js')).href);
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('#21 expenseNeedsAsk: ceiling is 50,000, unchanged correction is not asked', () => {
  assert.equal(rent.expenseNeedsAsk(50000), false);
  assert.equal(rent.expenseNeedsAsk('50,000.00'), false);
  assert.equal(rent.expenseNeedsAsk(50000.01), true);
  assert.equal(rent.expenseNeedsAsk('50,000.01'), true);
  assert.equal(rent.expenseNeedsAsk(99999999, 99999999), false);
  assert.equal(rent.expenseNeedsAsk('99999999.00', '99999999.00'), false);
  assert.equal(rent.expenseNeedsAsk(60000, '1000.00'), true);
  assert.equal(rent.expenseNeedsAsk(''), false);
});

test('#21 the form asks with Save anyway / Change it before saving, focus back on amount', () => {
  assert.match(src, /expenseNeedsAsk\(data\.amount, expense\?\.amount\)/);
  assert.match(src, /confirmText: 'Save anyway', cancelText: 'Change it'[^\n]*form\.elements\.amount\.focus\(\); return false;/);
});

test('#17 sort default label is short', () => {
  assert.match(src, /all: 'Overdue first',/);
  assert.doesNotMatch(src, /Overdue first, newest/);
});

test('#19 the voided banner is hidden in print; the receipt keeps its own VOID line', () => {
  assert.match(src, /class: 'alert alert--error no-print'[^\n]*`Voided /);
  assert.match(src, /VOID: this payment was voided on/);
});
