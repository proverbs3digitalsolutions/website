'use strict';
// QA round 18, lane LT (frontend only): Tenants "Owes at least" uses Rent's amount rule; short search placeholders.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const v = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', f), 'utf8');

test('tenants Owes at least has the Rent amount pattern and message', () => {
  const line = v('tenants.js').split('\n').find((l) => l.includes("name: 'min_balance', label"));
  const m = line.match(/pattern: (\/.*?\/),/);
  assert.ok(m, 'pattern present');
  const re = eval(m[1]); // eslint-disable-line no-eval
  for (const ok of ['0', '5000', '12.5', '1234567890.99']) assert.ok(re.test(ok), ok);
  for (const bad of ['-5', 'abc', '12345678901', '1.234', '']) assert.ok(!re.test(bad), bad);
  assert.ok(line.includes("patternText: 'Enter an amount of 0 or more (up to 10 digits).'"));
});

test('search placeholders are short enough for 1280px', () => {
  assert.ok(v('rent.js').includes("placeholder: 'Tenant, unit, reference, notes'"));
  assert.ok(v('tenants.js').includes("'Name, phone, unit, property'"));
  assert.ok(!/Search tenant, unit, reference or notes|Search name, phone, unit or property/.test(v('rent.js') + v('tenants.js')));
});
