'use strict';

// QA round 2, lane A15 (listings-view): the Listings page. Frontend source scan only. listings.js
// imports app.js (the signed-in user), so the file is read as text rather than imported.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'listings.js'), 'utf8');

test('the listing photo file input has an accessible name', () => {
  const inputs = src.split('\n').filter((line) => /type: 'file'/.test(line));
  assert.equal(inputs.length, 1, 'one file input on this page');
  // The input's props run over several lines (click guard, busy guard), so read its whole block to the closing "} });".
  assert.match(src.slice(src.indexOf(inputs[0]), src.indexOf('} });', src.indexOf(inputs[0]))), /id: 'listing-photos-file'/);
  assert.match(src, /h\('label', \{ for: 'listing-photos-file' \}, 'Listing photos'\)/);
});

test('Connect calendar and Sync now toasts use the plain problem message, not the raw sync text', () => {
  assert.doesNotMatch(src, /r\.sync\.message/, 'no toast reads the raw sync message');
  assert.match(src, /syncToastText\(/, 'both toasts go through the helper');
  assert.match(src, /problem_message/, 'the helper reads the plain sentence from the channel list');
});

test('Disconnect says future channel stays are cancelled, not removed', () => {
  assert.match(src, /Future stays from this channel are cancelled/);
  assert.doesNotMatch(src, /Future stays and blocks imported from this calendar are removed/);
});

test('Disconnect reports a failed request in a toast, like Sync now does', () => {
  const start = src.indexOf('title: `Disconnect ${CHANNEL_LABEL[f.channel]}?`');
  assert.notEqual(start, -1, 'the Disconnect confirmation is in the feed row');
  const handler = src.slice(start, src.indexOf("}, 'Disconnect')", start));
  assert.match(handler, /try \{ await post\(`\/ical-feeds\/\$\{f\.feed_id\}\/remove`\)/, 'the request is inside a try');
  assert.match(handler, /\} catch \(err\) \{ toast\(err\.message, 'error'\); \}/, 'a failure shows the ApiError message');
});

test('Edit listing reports "Listing updated." only after the save succeeds (a refused save shows the field messages)', () => {
  assert.match(src, /await patch\(`\/units\/\$\{l\.unit_id\}`, prepUnit\(d\)\);\s*toast\('Listing updated\.'\)/);
});

test('owners get Archive on each listing card, and Restore on archived ones, through the existing unit endpoints', () => {
  assert.match(src, /const isOwner = state\.user\.role === 'owner'/);
  assert.match(src, /post\(`\/units\/\$\{listing\.unit_id\}\/\$\{action\}`\)/);
  assert.match(src, /isOwner && h\('button'[^\n]*'aria-label': `Archive \$\{l\.unit_name\}`/);
  assert.match(src, /changeArchive\(l, 'archive', load\)/);
  assert.match(src, /'aria-label': `Restore \$\{u\.unit_name\}`/);
  assert.match(src, /changeArchive\(u, 'restore', load\)/);
});

test('an Archived filter lists the archived units, read per building (GET /listings is active only)', () => {
  assert.match(src, /status: ''/, 'status is a filter with a default');
  assert.match(src, /name: 'status'[^\n]*\['archived', 'Archived listings'\]/);
  assert.match(src, /get\(`\/properties\/\$\{p\.property_id\}`\)/);
  assert.match(src, /u\.status === 'archived'/);
  assert.match(src, /if \(!isOwner \|\| !\['', 'archived'\]\.includes\(filters\.status\)\) filters\.status = '';/, 'only owners can open it');
});

test('confirmations use the in-app dialog, never the browser dialogs', () => {
  assert.doesNotMatch(src, /\bwindow\.(alert|confirm|prompt)\b/);
  assert.match(src, /confirmDialog\(\{ title: `Archive \$\{listing\.unit_name\}\?`/);
});

test('the Channels dialog names each feed with its host, the same way calendar.js problemLine does', () => {
  // QA round 8 (#16): the name is one helper, which the row title and the Sync now and Disconnect labels all use.
  assert.match(src, /const channelName = \(f\) => `\$\{CHANNEL_LABEL\[f\.channel\]\}\$\{f\.host \? ` \(\$\{f\.host\}\)` : ''\}`;/);
  assert.match(src, /h\('span', \{ class: 'row__title' \}, channelName\(f\)\)/);
});

test('each listing card sync alert names the host of the link with the problem', () => {
  assert.match(src, /`\$\{CHANNEL_LABEL\[p\.channel\]\}\$\{p\.host \? ` \(\$\{p\.host\}\)` : ''\}: \$\{p\.message\}/);
});
