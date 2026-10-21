'use strict';
require('./helpers');

// Round 35 CHARGES (D-117): Add charge closes its dialog first, then redraws, so the pay-link question opens from Add charge
// and its answer returns focus there (not to the page heading).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'charges.js'), 'utf8');
const start = src.indexOf('function addCharge(');
const body = src.slice(start, src.indexOf('async function askToSendPayLink'));
const code = body.replace(/\/\/[^\n]*/g, '');

test('onSubmit closes the dialog before the redraw', () => {
  const close = code.indexOf('modal.close();', code.indexOf('onSubmit'));
  const redraw = code.indexOf('rerender();', code.indexOf('onSubmit'));
  assert.ok(close > 0 && redraw > 0, 'both calls present');
  assert.ok(close < redraw, 'modal.close() before rerender()');
});

test('added flag and toast are kept, and the question asks only when added', () => {
  assert.match(code, /added = true;\s*toast\('Charge added\.'\);/);
  assert.match(code, /onClose: \(\) => \{ if \(added\) askToSendPayLink\(reservationId\); \}/);
});
