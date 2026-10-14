'use strict';

// QA round 3, lane C25 (reports view). Frontend source scan only: the view imports the app shell, which does not load in Node.
// 1. Every table header cell on /reports has a name (phone#24). The By month bars column is named for what it shows.
// 2. A Custom range with both dates empty (a backwards pair is cleared by filters.js) asks for both dates and runs no report,
//    instead of silently reporting from the start of this month to today.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'reports.js'), 'utf8');
const loadFn = src.slice(src.indexOf('async function load()'), src.indexOf('renderBar();\n  el.replaceChildren'));
// Everything in load() that runs before the report is requested.
const beforeFetch = loadFn.slice(0, loadFn.indexOf('await get(`/reports'));

test('no table header cell on /reports is empty', () => {
  assert.doesNotMatch(src, /h\('th',\s*(?:null|\{[^}]*\}),\s*''\)/);
  assert.doesNotMatch(src, /h\('th',\s*(?:null|\{[^}]*\})\)/);
});

test('the By month bars column names what it holds for screen readers', () => {
  assert.match(src, /h\('th', null, h\('span', \{ class: 'sr-only' \}, 'Collected and expenses'\)\)/);
});

test('a Custom range with both dates empty asks for both dates and runs no report', () => {
  assert.match(beforeFetch, /filters\.period === 'custom' && !filters\.from && !filters\.to/);
  assert.match(beforeFetch, /'Pick both dates to see this range\.'/);
  assert.match(beforeFetch, /return;/);
});

test('that empty custom state also clears the export link, so it cannot export a period the page does not show', () => {
  assert.match(beforeFetch, /exportLink\.removeAttribute\('href'\)/);
});
