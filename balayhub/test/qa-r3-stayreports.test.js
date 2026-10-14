'use strict';

// QA round 3, lane C10 (stayreports): an invalid month in a stay report link is flagged, not
// silently replaced by this month (owners#18), and an untagged direct source reads "Not tagged"
// with a note (O-a). The server part runs against the database; the view part is a source scan
// because public/js/views/stayreports.js imports app.js, which can't load in Node.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ownerAccount } = require('./helpers');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
// The same Manila "this month" the server uses.
const manilaThisMonth = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);

let srv; let host;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'QA R3 Stay Reports');
});
test.after(async () => { await srv.close(); });

test('owners#18: a month that is not a real YYYY-MM is flagged, and the answer shows the month used', async () => {
  for (const bad of ['2026-13', 'abc', '2026-00']) {
    const res = await host.get(`/api/stay-reports?month=${bad}`);
    assert.equal(res.status, 200, `month=${bad} should still answer 200`);
    assert.equal(res.data.month_invalid, true, `month=${bad} should be flagged`);
    assert.equal(res.data.period, manilaThisMonth(), `month=${bad} should show this month, the month used`);
  }
});

test('owners#18: a real month is not flagged, and a request with no month is not flagged either', async () => {
  const valid = await host.get('/api/stay-reports?month=2026-09');
  assert.equal(valid.status, 200);
  assert.equal(valid.data.month_invalid, false);
  assert.equal(valid.data.period, '2026-09');
  const none = await host.get('/api/stay-reports');
  assert.equal(none.status, 200);
  assert.equal(none.data.month_invalid, false);
  assert.equal(none.data.period, manilaThisMonth());
});

test('owners#18: the page warns about an invalid month and puts the month used in the month box', () => {
  const src = read('public/js/views/stayreports.js');
  assert.match(src, /r\.month_invalid/);
  assert.match(src, /role: 'alert'/);
  assert.match(src, /That month isn't valid\. Showing \$\{monthName\(r\.period\)\}\./);
  // The month box follows the month used, not the bad value from the link.
  assert.match(src, /filters\.month = r\.period;/);
});

test('O-a: an untagged direct source is labelled "Not tagged", with a note under the table', () => {
  const src = read('public/js/views/stayreports.js');
  assert.doesNotMatch(src, /'No source'/);
  assert.match(src, /'Not tagged'/);
  assert.match(src, /Booked without a \?src= link, or entered by hand\./);
});
