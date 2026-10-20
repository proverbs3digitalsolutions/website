'use strict';

// QA round 2, lane A08 (money-rent).
// longterm#3: a rent payment above what the tenant owes needs confirm_over.
// longterm#5: the receipt file inputs have accessible names.
// money#10: % and _ in search are literal.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_08 node --test --test-concurrency=1 test/qa-r2-money-rent.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ownerAccount, manilaToday, addMonths } = require('./helpers');

let srv; let owner; let lease; let property;
const today = manilaToday();

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base);
  property = (await owner.post('/api/properties', { property_name: 'Pay Check Flats', property_type: 'apartment', address: '1 Rizal St', city: 'Bacoor', province: 'Cavite' })).data.property;
  const unit = (await owner.post(`/api/properties/${property.property_id}/units`, { unit_name: '201', unit_type: 'studio', monthly_rent: '5000' })).data.unit;
  const tenant = (await owner.post('/api/tenants', { full_name: 'Ana Reyes', phone: '0917 555 0101' })).data.tenant;
  const l = await owner.post('/api/leases', { tenant_id: tenant.tenant_id, unit_id: unit.unit_id, start_date: addMonths(today, -1), monthly_rent: '5000', due_day: 5 });
  assert.equal(l.status, 201, JSON.stringify(l.data));
  lease = l.data.lease;
});
test.after(async () => { await srv.close(); });

const owed = async () => Number((await owner.get('/api/rent/leases')).data.leases.find((x) => x.lease_id === lease.lease_id).outstanding);
const pay = (amount, extra = {}) => owner.post('/api/payments', { lease_id: lease.lease_id, amount_paid: String(amount), payment_date: today, payment_method: 'cash', ...extra });

test('a payment above what is owed is refused until confirm_over (longterm#3)', async () => {
  const due = await owed();
  assert.ok(due > 0);
  const over = due + 1000;
  const r = await pay(over);
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'PAYMENT_OVER_BALANCE');
  assert.equal(Number(r.data.owed), due);
  assert.equal(Number(r.data.credit_after), 1000);
  const list = await owner.get('/api/payments');
  assert.equal(list.data.payments.length, 0, 'nothing was saved');

  // Paying exactly what is owed needs no confirmation.
  const exact = await pay(due);
  assert.equal(exact.status, 201, JSON.stringify(exact.data));
  // Anything more now is advance credit and asks first.
  const more = await pay(500);
  assert.equal(more.status, 409);
  assert.equal(Number(more.data.owed), 0);
  assert.equal(Number(more.data.credit_after), 500);
  const ok = await pay(500, { confirm_over: true });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(Number(ok.data.balance.credit), 500);
});

test('% and _ in search are literal (money#10)', async () => {
  const hit = await owner.get('/api/payments?q=%25');
  assert.equal(hit.data.payments.length, 0);
  const hit2 = await owner.get('/api/rent?q=_');
  assert.equal(hit2.data.charges?.length ?? hit2.data.rent?.length ?? 0, 0, JSON.stringify(hit2.data).slice(0, 200));
  const e = await owner.get('/api/expenses?q=%25');
  assert.equal(e.data.expenses.length, 0);
  const v = await owner.get('/api/expenses?vendor=_');
  assert.equal(v.data.expenses.length, 0);
});

test('receipt file inputs have an accessible name (longterm#5)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/rent.js'), 'utf8');
  const inputs = src.match(/h\('input',\s*\{[^}]*type: 'file'[^}]*\}/g) || [];
  assert.equal(inputs.length, 3);
  for (const i of inputs) assert.match(i, /'aria-label'|\bid:/, i);
  assert.match(src, /h\('label', \{ for: 'receipt-input' \}/);
});

// Cancelling the "Record more than is owed?" prompt closes it quietly (D-84): onSubmit returns false, so makeForm keeps the form open with no message.
test('cancelling the over-balance prompt returns false with no error (rent cancel, D-84)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/rent.js'), 'utf8');
  const submit = src.slice(src.indexOf('export async function recordPaymentModal'), src.indexOf('// ---------------------------------------------------------------- add expense'));
  assert.doesNotMatch(submit, /throw new Error\(/);
  assert.doesNotMatch(submit, /throw new ApiError\(/);
  assert.match(submit, /title: 'Record more than is owed\?'[^\n]*\)\) return false;/);
  assert.match(src, /import \{ get, post, patch, qs, uploadFile, fileContentError \} from '\.\.\/api\.js';/);
});
