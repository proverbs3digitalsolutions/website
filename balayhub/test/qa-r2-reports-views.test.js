// QA round 2, lane B31 (reports-views): the stay report and P&L wording and states in
// public/js/views/stayreports.js and public/js/views/pnl.js. Frontend source scan only: both views
// import app.js, which can't load in Node, so the checks read the source.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', rel), 'utf8');

test('money#6: the stay report net is labelled before refunds, with a note that points to P&L', () => {
  const src = read('stayreports.js');
  assert.match(src, /'Net \(before refunds\)'/);
  assert.doesNotMatch(src, /Net after (channel )?fees|Net after fees & expenses/);
  assert.match(src, /Refunds aren\\?'t deducted here\. Profit and loss shows the net after refunds\./);
});

test('owners#4: the direct-bookings revenue column says it is the booked stay total', () => {
  const src = read('stayreports.js');
  assert.match(src, /\['Source', 'Stays', 'Nights', 'Booked total \(check-in basis\)'\]/);
  assert.doesNotMatch(src, /\['Source', 'Stays', 'Nights', 'Revenue'\]/);
});

test('owners#1: an invalid month in /#/pnl says so, and does not silently show this month', () => {
  const src = read('pnl.js');
  // The bad value is detected before the fallback to this month, and it gets an alert.
  assert.match(src, /const bad = filters\.month && !MONTH_RE\.test\(filters\.month\)/);
  assert.match(src, /role: 'alert'/);
  assert.match(src, /That month isn't valid\. Showing \$\{monthName\(month\)\}\./);
});

test('owners#2: the P&L empty state checks for activity, not for unit rows', () => {
  const src = read('pnl.js');
  assert.doesNotMatch(src, /!r\.rows\.length/);
  // No stays, no expenses and no refunds (a refund on a cancelled stay still moves money).
  assert.match(src, /if \(!t\.stays && !Number\(t\.expenses\) && !Number\(t\.refunds\)\)/);
  assert.match(src, /'Nothing for this month'/);
  assert.match(src, /Choose another month\./);
});
