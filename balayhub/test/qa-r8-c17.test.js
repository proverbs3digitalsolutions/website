'use strict';

// QA round 8, lane C17 (stay-reports-api): a from or to that is given but isn't a real date is
// refused at its field, not quietly replaced by this month (#26). The month rules are unchanged.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount } = require('./helpers');

let srv; let host;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'QA R8 Stay Reports');
});
test.after(async () => { await srv.close(); });

test('#26: a from or to that is not a real date answers 400 at that field', async () => {
  const cases = [
    ['from=abc&to=2026-03-01', 'from'],
    ['from=2026-02-30&to=2026-03-01', 'from'],
    ['from=2026-03-01&to=2026-13-01', 'to'],
    ['from=2026-03-01&to=xyz', 'to'],
    ['from=abc', 'from'],
  ];
  for (const [qs, field] of cases) {
    const res = await host.get(`/api/stay-reports?${qs}`);
    assert.equal(res.status, 400, `${qs} should be refused`);
    assert.deepEqual(Object.keys(res.data.fields), [field], `${qs} should name only ${field}`);
    assert.equal(res.data.fields[field], 'Enter a real date.');
    assert.equal(res.data.period, undefined, `${qs} should not return a report`);
  }
});

test('#26: the export refuses a bad from or to the same way', async () => {
  const res = await host.get('/api/stay-reports/export?from=abc&to=2026-03-01');
  assert.equal(res.status, 400);
  assert.equal(res.data.fields.from, 'Enter a real date.');
});

test('#26: a bad from is refused even when a month or year is also sent', async () => {
  const res = await host.get('/api/stay-reports?month=2026-09&from=abc&to=2026-09-30');
  assert.equal(res.status, 400);
  assert.equal(res.data.fields.from, 'Enter a real date.');
});

test('#26: a good range still answers, and a bad month is still flagged, not refused', async () => {
  const range = await host.get('/api/stay-reports?from=2026-09-01&to=2026-09-30');
  assert.equal(range.status, 200);
  assert.equal(range.data.period, '2026-09-01 to 2026-09-30');
  assert.equal(range.data.month_invalid, false);
  const bad = await host.get('/api/stay-reports?month=2026-13');
  assert.equal(bad.status, 200);
  assert.equal(bad.data.month_invalid, true);
});
