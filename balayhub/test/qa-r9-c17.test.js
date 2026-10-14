// QA round 9, lane C17 (reports-pnl-view): the stay report and P&L views. Frontend source scan:
// both views import app.js, which can't load in Node, so the checks read the source.
// #24 the P&L names the month and says what it counts; #27 the stay report uses the form's
// expense wording; #28 the Direct bookings card says what its total counts; K14 the Period
// controls keep focus when they are drawn again; #45 the stay-report tablist has a name, so
// the focus fallback in app.js can find it after a redraw.
// node --test --test-concurrency=1 test/qa-r9-c17.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', rel), 'utf8');
// The text of one function: from its declaration up to the next declaration after it.
const bodyOf = (src, start, end) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));

test('#27: the stay report uses the form wording for expense categories, not its own short names', () => {
  const src = read('stayreports.js');
  assert.doesNotMatch(src, /const CATEGORY = /);
  assert.match(src, /import \{[^}]*\blabel\b[^}]*\} from '\.\.\/ui\.js';/);
  assert.match(src, /h\('dt', null, label\(e\.category\)\)/);
});

test('#28: a note under "Direct bookings by source" says what the booked total counts', () => {
  const src = read('stayreports.js');
  const heading = src.indexOf("'Direct bookings by source'");
  const note = src.indexOf("'Booked total counts the whole booking from its check-in date. Revenue by channel counts only the nights in this month.'");
  assert.notEqual(heading, -1, 'the Direct bookings card is missing');
  assert.notEqual(note, -1, 'the basis note is missing');
  assert.ok(note > heading, 'the note comes after the card heading');
  assert.ok(note < src.indexOf("h('table'", heading), 'the note sits above the table, under the heading');
});

test('K14: the Period controls keep focus when they are drawn again', () => {
  const src = read('stayreports.js');
  const fn = bodyOf(src, 'function drawPeriod()', 'async function load()');
  const redraw = fn.indexOf('periodBox.replaceChildren(sel, inputs)');
  assert.notEqual(redraw, -1, 'drawPeriod should still draw its controls into periodBox');
  assert.match(fn, /document\.activeElement/, 'drawPeriod should check which control had focus');
  assert.match(fn, /periodBox\.querySelector\(/, 'focus goes back on the control with the same name');
  assert.match(fn.slice(redraw), /\.focus\(\)/, 'focus is put back after the redraw, not before');
});

test('#45: the stay-report tablist has a name, so the focus fallback can find it after a redraw', () => {
  const src = read('stayreports.js');
  assert.match(src, /const tabs = h\('div', \{ class: 'tabs', role: 'tablist', 'aria-label': '[^']+' \}/);
});

test('#24: the P&L caption names the month the way the form does, not the raw YYYY-MM code', () => {
  const src = read('pnl.js');
  assert.match(src, /import \{[^}]*\bfmtMonth\b[^}]*\} from '\.\.\/ui\.js';/);
  assert.match(src, /Profit and loss per unit for \$\{fmtMonth\(month\)\}/);
  assert.doesNotMatch(src, /Profit and loss per unit for \$\{month\}/);
});

test('#24: a line under the P&L title says what it counts and where the check-in counts are', () => {
  const src = read('pnl.js');
  assert.match(src, /basis\.textContent = `Counts stays that checked out in \$\{fmtMonth\(month\)\} \(finished stays only\)\. Reports counts stays by check-in date\.`/);
  // The line sits right under the title, before the filter bar.
  assert.match(src, /pageHead\(\{ title: 'Profit and loss'[^}]*\}\), basis, notice, bar, box\)/);
});
