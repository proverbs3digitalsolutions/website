// R24 LISTINGS: ONB-1 (Edit never invents a maximum of 2) and ONB-4 (Channels checks the link on the device first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/listings.js'), 'utf8');

test('ONB-1: Edit keeps a blank maximum blank; Add still starts at 2', () => {
  const line = src.split('\n').find((l) => l.includes("name: 'max_guests'")) || '';
  assert.match(line, /u\.unit_id \? \(u\.max_guests \?\? ''\) : \(u\.max_guests \?\? 2\)/);
  assert.doesNotMatch(line, /u\.max_guests \|\| 2/);
  assert.match(line, /Leave blank for no limit\./);
});

test('ONB-4: Channels submit checks channel and link before any request', () => {
  const i = src.indexOf("addForm.addEventListener('submit'");
  const body = src.slice(i, src.indexOf("post('/ical-feeds', body)", i));
  assert.match(body, /Calendar link is required\./);
  assert.match(body, /Paste the full https:\/\/ calendar \(iCal\) link from the channel\./);
  assert.match(body, /new URL\(/);
  assert.match(body, /protocol === 'https:'/);
  assert.match(body, /Choose which site this calendar link is from\./);
  assert.match(body, /showErrors\(addForm, problems\)/);
});
