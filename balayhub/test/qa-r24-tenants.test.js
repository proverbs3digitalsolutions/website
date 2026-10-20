'use strict';

// QA r24 TENANTS (LT-1): lease end before start shows on the first Save, together with other problems. Frontend-only: source scan plus the check function itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/tenants.js'), 'utf8');
const MSG = 'Lease end must be on or after the start date.';

test('Assign lease and Change terms both carry the lease-order check', () => {
  assert.match(src, /check: \(d\) => leaseOrderCheck\(d\.end_date, d\.start_date\)/);
  assert.match(src, /check: \(d\) => leaseOrderCheck\(d\.end_date, manilaDay\(lease\.start_date\)\)/);
});

test('leaseOrderCheck: end before start names the end box; equal, later or blank pass', () => {
  const m = src.match(/const leaseOrderCheck = ([^\n]+);\n/);
  assert.ok(m, 'leaseOrderCheck defined');
  const fn = new Function(`return ${m[1]};`)();
  assert.deepEqual(fn('2026-10-01', '2026-10-20'), { end_date: MSG });
  assert.equal(fn('2026-10-20', '2026-10-20'), null);
  assert.equal(fn('', '2026-10-20'), null);
  assert.equal(fn('2026-10-01', ''), null);
});

test('Assign lease monthly rent is positive (the server says positive)', () => {
  assert.match(src, /name: 'monthly_rent', label: 'Monthly rent', type: 'money', required: true, positive: true, value: unit/);
});

test('Change terms monthly rent is positive too (same server rule)', () => {
  assert.match(src, /name: 'monthly_rent', label: 'Monthly rent', type: 'money', required: true, positive: true, value: lease\.monthly_rent/);
});
