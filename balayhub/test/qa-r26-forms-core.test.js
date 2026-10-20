'use strict';

// QA r26 FORMS-CORE (LT-1): formModal passes the view's false on, so makeForm keeps the draft. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/ui.js'), 'utf8');
const fnText = SRC.slice(SRC.indexOf('export function formModal'), SRC.indexOf('// Debounced search input.')).replace('export function', 'function');
const makeFormText = SRC.slice(SRC.indexOf('export function makeForm'), SRC.indexOf('export function formModal'));

// Run the real formModal against stand-ins; return what makeForm was given and the modal.
function open(onSubmit) {
  const seen = { closed: 0 };
  const factory = new Function('makeForm', 'openModal', `${fnText}; return formModal;`);
  const formModal = factory((opts) => { seen.opts = opts; return {}; }, () => ({ close: () => { seen.closed += 1; } }));
  formModal({ title: 't', draftKey: 'x', onSubmit });
  return seen;
}

test('onSubmit returning false: the dialog stays open and false reaches makeForm (draft kept)', async () => {
  const seen = open(async () => false);
  assert.equal(await seen.opts.onSubmit({}, {}), false);
  assert.equal(seen.closed, 0);
});

test('onSubmit returning undefined: the dialog closes and makeForm sees a non-false result (draft cleared)', async () => {
  const seen = open(async () => undefined);
  assert.notEqual(await seen.opts.onSubmit({}, {}), false);
  assert.equal(seen.closed, 1);
});

test('onSubmit throwing: the error reaches makeForm, the dialog stays open', async () => {
  const seen = open(async () => { throw new Error('boom'); });
  await assert.rejects(() => seen.opts.onSubmit({}, {}), /boom/);
  assert.equal(seen.closed, 0);
});

test('source: formModal returns the result and makeForm only clears the draft for a non-false result', () => {
  assert.match(SRC, /if \(result !== false\) modal\.close\(\); return result; \}/);
  assert.match(makeFormText, /if \(result !== false\) clearDraft\(\);/);
});
