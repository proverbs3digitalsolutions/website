'use strict';

// QA round 8, lane C24 (listings-view). Fixes on the Listings page:
// #13: the Type list and the Type filter offer the same seven unit types as Properties, labelled the same way.
// #15, #43, K11, K20: each listing card's Bookings link and each sync alert's Open channels button name their listing.
// #16: each channel row's Sync now and Disconnect buttons name the channel (and its host).
// #18: the photos dialog keeps focus inside the dialog after Make cover, Delete and Upload.
// #19: an unreadable base rate gets its own message; zero and negative rates keep the greater-than-zero message.
// #21: the share link box starts on Other.
// D-81 sweep: every per-row button on the file names its row.
// Frontend-only: no database. Source scans, plus the rate helper and the channel name helper run on their own.
// node --test --test-concurrency=1 test/qa-r8-c24.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const views = path.join(__dirname, '..', 'public', 'js', 'views');
const src = fs.readFileSync(path.join(views, 'listings.js'), 'utf8');
const props = fs.readFileSync(path.join(views, 'properties.js'), 'utf8');
const reservations = fs.readFileSync(path.join(views, 'reservations.js'), 'utf8');

// The real ui.js in a temp folder, for the real parseAmount and options (ui.js names the DOM Element class at load time).
let ui; let dir;
test.before(async () => {
  globalThis.Element = class { };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c24-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '..', 'public', 'js', f), path.join(dir, f));
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// Text from a start marker up to the first end marker after it.
function between(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, `found: ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `found the end after: ${startMarker}`);
  return src.slice(start, end);
}

const photos = () => between('async function photosModal(', '// A failed sync');
const feedRows = () => between('const channelName = ', "const status = h('div');");
const unitTypes = (text) => text.match(/^const UNIT_TYPES = (\[.*\]);$/m)?.[1];

test('the Type list and the Type filter offer the same seven unit types as Properties, labelled as Properties labels them (#13)', () => {
  assert.ok(unitTypes(src), 'listings.js keeps one UNIT_TYPES list on one line');
  assert.equal(unitTypes(src), unitTypes(props), 'the same list, in the same order, as properties.js');
  const types = JSON.parse(unitTypes(src).replace(/'/g, '"'));
  assert.deepEqual(types, ['room', 'studio', 'apartment', 'bedspace', 'house', 'commercial_space', 'other']);
  assert.match(src, /\{ name: 'unit_type', label: 'Type', all: 'Any type', options: options\(UNIT_TYPES\) \}/, 'the filter takes its labels from ui.js options()');
  assert.doesNotMatch(src, /toUpperCase\(\) \+ t\.slice\(1\)/, 'no hand-made labels that leave out "Commercial space"');
  const labels = ui.options(types);
  assert.deepEqual(labels.find(([k]) => k === 'bedspace'), ['bedspace', 'Bedspace']);
  assert.deepEqual(labels.find(([k]) => k === 'commercial_space'), ['commercial_space', 'Commercial space']);
});

test('each listing card\'s Bookings link and each sync alert\'s Open channels button name their listing (#15, #43, K11, K20)', () => {
  const bookings = src.split('\n').find((l) => l.includes("view=all`"));
  assert.ok(bookings, 'the Bookings link is on one line');
  assert.match(bookings, /'aria-label': `Bookings for \$\{l\.unit_name\}`/, 'Bookings names the listing');
  assert.match(bookings, /'Bookings'\)/, 'the visible word stays Bookings');
  const open = src.split('\n').find((l) => l.includes("'Open channels')"));
  assert.ok(open, 'the Open channels button is on one line');
  assert.match(open, /'aria-label': `Open channels for \$\{l\.unit_name\}`/, 'Open channels names the listing');
});

test('each channel row\'s Sync now and Disconnect buttons name the channel, with its host when there is one (#16)', () => {
  // The name is one helper, so the title, Sync now and Disconnect all read the same way.
  const helper = src.match(/^ {2}const channelName = \(f\) => .*;$/m)?.[0];
  assert.ok(helper, 'one channelName helper inside channelsModal');
  const channelName = new Function('CHANNEL_LABEL', `${helper.trim()}\nreturn channelName;`)({ airbnb: 'Airbnb', booking: 'Booking.com' });
  assert.equal(channelName({ channel: 'airbnb', host: 'Maria Santos' }), 'Airbnb (Maria Santos)');
  assert.equal(channelName({ channel: 'booking', host: null }), 'Booking.com');
  const rows = feedRows();
  assert.match(rows, /'aria-label': `Sync now, \$\{channelName\(f\)\}`/, 'Sync now names the channel');
  assert.match(rows, /'aria-label': `Disconnect \$\{channelName\(f\)\}`/, 'Disconnect names the channel');
  assert.match(rows, /h\('span', \{ class: 'row__title' \}, channelName\(f\)\)/, 'the row title uses the same name');
  assert.ok(src.includes("title: `Disconnect ${CHANNEL_LABEL[f.channel]}?`"), 'the confirmation question is unchanged');
});

test('an unreadable base rate gets its own message; zero and negative rates keep the greater-than-zero message (#19)', () => {
  assert.match(src, /^export function baseRateError\(text\) \{/m, 'the rule is exported so it can be checked on its own');
  const baseRateError = new Function('parseAmount', `${between('function baseRateError(', 'function checkBaseRate(')}\nreturn baseRateError;`)(ui.parseAmount);
  const valid = 'Nightly rate must be a valid amount (e.g. 8500 or 8500.50).';
  const positive = 'Nightly rate must be greater than zero.';
  for (const text of ['abc', '1,5', '2e3', '12.345']) assert.equal(baseRateError(text), valid, `"${text}" is unreadable`);
  for (const text of ['-100', '0', '0.00', '-0.01']) assert.equal(baseRateError(text), positive, `"${text}" is a zero or negative rate`);
  for (const text of ['2500', '2,500', '₱2,500.50', ' 2500 ']) assert.equal(baseRateError(text), null, `"${text}" is fine`);
});

test('the share link box starts on Other, so an unchosen link is not counted as Facebook (#21)', () => {
  assert.ok(reservations.includes("other: 'Other'"), 'Other is one of the share sources');
  const lines = src.split('\n');
  const at = lines.findIndex((l) => l.trim().startsWith("const src = h('select', { class: 'input', id: 'share-src' }"));
  assert.notEqual(at, -1, 'the share-source select is declared');
  assert.match(lines[at + 1].trim(), /^src\.value = 'other';/, 'the box starts on Other, right after its options are added');
});

test('the photos dialog puts focus back inside the dialog after Make cover, Delete and Upload (#18)', () => {
  const text = photos();
  assert.match(text, /h\('figure', \{ class: 'ph-item', tabindex: '-1' \}/, 'a photo can take focus from script');
  assert.match(text, /async function draw\(focus\) \{/, 'draw takes where focus goes after the redraw');
  assert.match(text, /focus\?\.\(box, upload\);/, 'the redraw runs the focus step last');
  assert.match(text, /await post\(`\/listing-photos\/\$\{p\.file_id\}\/cover`\); draw\(\(root\) => root\.querySelector\('\.ph-item'\)\?\.focus\(\)\);/,
    'Make cover focuses the new cover');
  assert.match(text, /await post\(`\/listing-photos\/\$\{p\.file_id\}\/remove`\); draw\(\(root, btn\) => \(root\.querySelectorAll\('\.ph-item'\)\[i\]\?\.querySelector\('button\[aria-label\^="Delete,"\]'\) \?\? btn\)\.focus\(\)\);/,
    'Delete focuses the Delete of the photo now in that place, else Upload');
  assert.match(text, /\} catch \(err\) \{ toast\(err\.message, 'error'\); \}\s*draw\(\(root, btn\) => btn\.focus\(\)\);/, 'Upload keeps focus on Upload');
});

test('every per-row button on the page names its row (D-81 sweep)', () => {
  // Card buttons, archived cards, photos and channel rows: each repeats once per listing, photo or channel.
  assert.match(src, /'aria-label': `Restore \$\{u\.unit_name\}`/, 'Restore on an archived card');
  assert.match(src, /'aria-label': `Edit, \$\{l\.unit_name\}`/, 'Edit');
  assert.match(src, /'aria-label': `Archive \$\{l\.unit_name\}`/, 'Archive');
  assert.match(src, /'aria-label': `Channels, \$\{l\.unit_name\}`/, 'Channels');
  assert.match(src, /'aria-label': `Photos, \$\{l\.unit_name\}`/, 'Photos');
  assert.match(src, /'aria-label': `Guest pages, \$\{l\.unit_name\}`/, 'Guest pages');
  assert.match(src, /'aria-label': `Make cover, photo \$\{i \+ 1\}`/, 'Make cover');
  assert.match(src, /'aria-label': `Delete, photo \$\{i \+ 1\}`/, 'Delete');
  assert.match(src, /'aria-label': `\$\{l\.cleaning_status === 'dirty' \? 'Mark clean' : 'Mark dirty'\}, \$\{l\.unit_name\}`/, 'Mark clean or Mark dirty');
});
