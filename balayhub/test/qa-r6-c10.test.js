'use strict';

// QA round 6, lane C10 (money wording).
// - "Fees" meant channel commission in Stay reports and P&L, but cleaning and extras in Home and in the revenue
//   total. One meaning per word: "Channel fees" is commission; "cleaning and extras" is the fees part of revenue.
// - The Add charge total shows no figure for a negative price, the same as it does for an unreadable one.
// Frontend-only: source scans of the four views (no database).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const VIEWS = path.join(__dirname, '../public/js/views');
const read = (name) => fs.readFileSync(path.join(VIEWS, name), 'utf8');
// The source text from one marker up to the next marker (the rest of the file when there is none).
const between = (src, start, end) => {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `missing ${start}`);
  const b = src.indexOf(end, a + start.length);
  return src.slice(a, b > a ? b : undefined);
};

test('Stay reports: no header or summary uses "fees" on its own for channel commission', () => {
  const src = read('stayreports.js');
  assert.doesNotMatch(src, /'Fees'/, 'no bare "Fees" column header');
  assert.doesNotMatch(src, /\)\} fees\b/, 'no "₱X fees" summary line');
});

test('Stay reports: commission is "Channel fees" in the channel table and the summary line', () => {
  const src = read('stayreports.js');
  assert.match(src, /\['Channel', 'Stays', 'Nights', 'Avg rate', 'Channel fees'\]/);
  assert.match(src, /\$\{peso\(t\.channel_fees\)\} channel fees · \$\{peso\(t\.expenses\)\} expenses/);
  assert.match(src, /\$\{peso\(t\.channel_fees\)\} channel fees · expenses not split by channel/);
});

test('Stay reports: the Revenue tile splits rooms from cleaning and extras', () => {
  const src = read('stayreports.js');
  assert.match(src, /`Rooms \$\{peso\(t\.accommodation\)\}`/); // QA r24: split into short lines.
  assert.match(src, /`Cleaning and extras \$\{peso\(t\.fees\)\}`/);
});

test('Stay reports: the By listing table has an Of which cleaning & extras column and its building row still lines up', () => {
  const src = read('stayreports.js');
  const headers = src.match(/\['Listing', ([^\]]*)\]/);
  assert.ok(headers, 'By listing headers found');
  assert.match(headers[1], /'Of which cleaning & extras'/); // QA r7 C17 (K9): the header says the cleaning part is inside Revenue.
  assert.match(headers[1], /'Channel fees'/);
  const columns = headers[1].split(',').length + 1;
  const building = src.match(/colspan: (\d+) \}, 'Whole-property expenses/);
  assert.ok(building, 'building-level row found');
  assert.equal(Number(building[1]), columns - 2, 'building row spans every column before its expenses cell');
  assert.match(src, /peso\(u\.fees\)/, 'listing row prints cleaning and extras from u.fees');
});

test('Home: the stays line says "cleaning and extras", not "fees"', () => {
  const src = read('home.js');
  assert.match(src, /Stays \$\{pesoWhole\(r\.current\.accommodation\)\} \+ cleaning and extras \$\{pesoWhole\(r\.current\.fees\)\}/);
  assert.doesNotMatch(src, /\+ fees /);
});

test('P&L: channel commission is "channel fees" in the tile and the net formula', () => {
  const src = read('pnl.js');
  assert.match(src, /\$\{peso\(t\.channel_fees\)\} channel fees · \$\{peso\(t\.refunds\)\} refunds/);
  assert.match(src, /gross − channel fees − refunds − expenses/);
  assert.doesNotMatch(src, /\)\} fees\b/);
  assert.doesNotMatch(src, /gross − fees/);
});

test('Add charge: a negative price shows no charge total, like an unreadable one', () => {
  const src = read('charges.js');
  const body = between(src, 'const showTotal', 'catIn.addEventListener');
  assert.match(body, /const unit = typed < 0 \? NaN : typed;/, 'a negative price reads as unreadable');
  assert.match(body, /Number\.isNaN\(unit\) \? '' : `Charge total:/, 'an unreadable price gives an empty total');
});
