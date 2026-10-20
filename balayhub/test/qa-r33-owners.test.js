'use strict';
require('./helpers');

// QA round 33, lane OWNERS (public/js/views/owners.js). Frontend only: source scan.
// The void requests run inside the reason dialog (contract C1), so a refusal is said there and the typed reason stays.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'owners.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const fn = (name) => {
  const i = src.indexOf(`const ${name} = async`);
  assert.ok(i > -1, `${name} exists`);
  return src.slice(i, src.indexOf('\n  };', i));
};

for (const [name, url, toastText] of [
  ['voidPayout', '/owner-payouts/${p.payout_id}/void', 'Payout voided.'],
  ['voidEntry', '/reserve-entries/${e.entry_id}/void', 'Withdrawal voided.'],
]) {
  test(`${name}: the post runs in onConfirm, not after the dialog closes`, () => {
    const body = fn(name);
    assert.match(body, /reason: true/);
    assert.ok(body.includes(`onConfirm: (why) => post(\`${url}\`, { reason: why })`), 'onConfirm posts the same URL');
    const after = body.slice(body.indexOf('if (!reason) return;'));
    assert.ok(body.includes('if (!reason) return;'));
    assert.ok(!after.includes('post('), 'no post after the dialog closes');
    assert.ok(!body.includes('try {'), 'no try/catch left around the post');
    assert.ok(after.includes(`toast('${toastText}'); rerender();`), 'toast unchanged');
  });
}
