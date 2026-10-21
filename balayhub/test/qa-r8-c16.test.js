'use strict';
const { startServer, ownerAccount } = require('./helpers');

// QA round 8, lane C16 (validate-dates), finding #23. A payment or expense dated 1900-01-01 was accepted.
// Every `date` field now has to fall between 2000-01-01 and 2100-12-31. Text that is not a real date keeps
// its own message ("must be a valid date."). The pure checks need no database. The route check uses the
// test database named by TEST_DATABASE_URL:
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_15 node --test --test-concurrency=1 test/qa-r8-c16.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../src/lib/validate');

const spec = { payment_date: { type: 'date', required: true, label: 'Payment date' } };

// Returns the field message for a refused date; fails the test if the date is accepted.
function refusal(raw) {
  try {
    validate({ payment_date: raw }, spec);
  } catch (err) {
    assert.equal(err.status, 400);
    return err.extra.fields.payment_date;
  }
  assert.fail(`expected ${JSON.stringify(raw)} to be refused`);
}

test('a date before 2000 or after 2100 is refused with the range message', () => {
  assert.equal(refusal('1900-01-01'), 'Payment date must be between 2000 and 2100.');
  assert.equal(refusal('1999-12-31'), 'Payment date must be between 2000 and 2100.');
  assert.equal(refusal('2101-01-01'), 'Payment date must be between 2000 and 2100.');
  assert.equal(refusal('2200-01-01'), 'Payment date must be between 2000 and 2100.');
});

test('the first and last days of the range are accepted', () => {
  assert.deepEqual(validate({ payment_date: '2000-01-01' }, spec), { payment_date: '2000-01-01' });
  assert.deepEqual(validate({ payment_date: '2100-12-31' }, spec), { payment_date: '2100-12-31' });
});

test('text that is not a real date keeps the "valid date" message, in range or not', () => {
  assert.equal(refusal('abc'), 'Payment date must be a valid date.');
  assert.equal(refusal('2026-02-30'), 'Payment date must be a valid date.');
  assert.equal(refusal('2026-1-5'), 'Payment date must be a valid date.');
});

test('an optional date field gets the same range rule', () => {
  const optional = { end_date: { type: 'date', label: 'Lease end' } };
  assert.throws(() => validate({ end_date: '1900-01-01' }, optional), (err) => {
    assert.equal(err.extra.fields.end_date, 'Lease end must be between 2000 and 2100.');
    return true;
  });
  assert.deepEqual(validate({}, optional), { end_date: null });
});

test('POST /api/payments refuses a payment dated 1900-01-01 at payment_date, before the lease is looked up', async () => {
  const srv = await startServer();
  try {
    const owner = await ownerAccount(srv.base);
    const r = await owner.post('/api/payments', {
      lease_id: '00000000-0000-0000-0000-000000000000',
      amount_paid: '1000.00',
      payment_date: '1900-01-01',
      payment_method: 'cash',
    });
    assert.equal(r.status, 400);
    assert.deepEqual(r.data.fields, { payment_date: 'Payment date must be between 2000 and 2100.' });
  } finally {
    await srv.close();
  }
});
