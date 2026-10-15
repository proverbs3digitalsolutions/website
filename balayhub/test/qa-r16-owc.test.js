'use strict';
// QA round 16, lane OWC (frontend only): a management fee over 50% asks first (#23); a repeated owner name asks (#24, client).
// node --test --test-concurrency=1 test/qa-r16-owc.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const owners = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/owners.js'), 'utf8');
const grab = (name) => {
  const m = owners.match(new RegExp(`export const ${name} = [^\\n]*\\n`));
  assert.ok(m, `export const ${name} not found`);
  return m[0].replace('export ', '');
};
const { feeNeedsAsk, feeChanged } = new Function(`${grab('feeNeedsAsk')}${grab('feeChanged')}; return { feeNeedsAsk, feeChanged };`)();

test('#23 feeNeedsAsk: only a percentage over 50 asks', () => {
  assert.equal(feeNeedsAsk('net_pct', 51), true);
  assert.equal(feeNeedsAsk('gross_pct', '100'), true);
  assert.equal(feeNeedsAsk('net_pct', 50), false);
  assert.equal(feeNeedsAsk('net_pct', 0), false);
  assert.equal(feeNeedsAsk('flat', 80), false);
});

test('#23 edit asks only when the model or fee changed', () => {
  const o = { fee_model: 'net_pct', management_fee_pct: '60.00' };
  assert.equal(feeChanged({ fee_model: 'net_pct', management_fee_pct: 60 }, o), false);
  assert.equal(feeChanged({ fee_model: 'net_pct', management_fee_pct: 70 }, o), true);
  assert.equal(feeChanged({ fee_model: 'gross_pct', management_fee_pct: 60 }, o), true);
  assert.equal(feeChanged({ fee_model: 'net_pct', management_fee_pct: 90 }), true);
  assert.match(owners, /feeConfirmed\(d, o\)/);
});

test('#23 the question is asked in add and edit, after the field checks and before the request', () => {
  assert.match(owners, /title: 'Check the management fee'/);
  assert.match(owners, /`This is a \$\{[^}]+\}% management fee\. Save anyway\?`/);
  assert.equal(owners.split(/feeConfirmed\(d[,)]/).length - 1, 2);
  for (const call of ["post('/unit-owners'", "patch(`/unit-owners/${o.owner_id}`"]) {
    assert.ok(owners.search(/feeConfirmed\(d[,)]/) < owners.indexOf(call));
  }
});

test('#24 NAME_IN_USE asks, then resends with confirm_duplicate_name', () => {
  assert.match(owners, /title: 'Name already used'/);
  assert.match(owners, /`An owner named \$\{err\.data\.owner_name\} already exists\. Save anyway\?`/);
  assert.equal(owners.split("err.code === 'NAME_IN_USE'").length - 1, 2);
  assert.equal(owners.split('confirm_duplicate_name: true').length - 1, 2);
  assert.match(owners, /dialog\.modal \[name="full_name"\]/);
});
