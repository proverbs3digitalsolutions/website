'use strict';

// QA r25 TENANTS (LT-1): End lease asks a question that names the tenant, unit and date before it posts. Frontend-only: source scan.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/tenants.js'), 'utf8');
const start = src.indexOf('const endLease = (lease) =>');
const end = src.indexOf('const cancelLease');
const endLease = src.slice(start, end);

test('End lease confirms before the post, naming tenant, property, unit and move-out date', () => {
  assert.ok(start > 0 && end > start);
  const confirmAt = endLease.indexOf('confirmDialog(');
  const postAt = endLease.indexOf("post(`/leases/");
  assert.ok(confirmAt > 0 && postAt > confirmAt, 'confirm must come before the post');
  const ask = endLease.slice(confirmAt, postAt);
  assert.match(ask, /tenant\.full_name/);
  assert.match(ask, /lease\.property_name/);
  assert.match(ask, /unitLabel\(lease\.unit_name\)/);
  assert.match(ask, /fmtDate\(data\.end_date\)/);
  assert.match(ask, /Rent after that date is removed/);
  assert.match(ask, /confirmText:\s*'End lease'/);
  assert.match(ask, /cancelText:\s*'Keep lease'/);
  assert.match(ask, /danger:\s*true/);
});

test('Keep lease returns false so the dialog stays open', () => {
  assert.match(endLease, /if\s*\(!await confirmDialog\([\s\S]*?\)\)\s*return false;/);
});
