'use strict';

// QA round 6, C17 (booking page). Frontend only, so these are source checks on book.js and i18n.js.
// #34: an over-limit guest count is said once, in the Guests box; the price summary doesn't repeat it.
// #35: the "Booking not found" card says the problem once, in its own words, and links back to the places list.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8');
const src = read('views/book.js');

// updateQuote(), from its start up to the cancellation policy block that follows it.
const quoteFn = () => src.slice(src.indexOf('async function updateQuote() {'), src.indexOf('// The cancellation policy'));

test('#34: a new quote clears an old guest-count message before it asks again', () => {
  const body = quoteFn();
  const beforeTry = body.slice(0, body.indexOf('try {'));
  assert.match(beforeTry, /setGuestsError\(''\)/);
});

test('#34: the quote refusal for the guest limit goes to the Guests box and the summary stays quiet', () => {
  const body = quoteFn();
  const at = body.indexOf('if (err.fields?.guests)');
  assert.ok(at > 0, 'the guest-limit refusal has its own branch in the catch');
  const branch = body.slice(at, body.indexOf('const reason', at));
  assert.match(branch, /setGuestsError\(cap \? t\('Guests must be at most \{n\}\.', \{ n: cap\[1\] \}\) : tServer\(err\.fields\.guests\)\)/, 'the message goes to the Guests box');
  assert.match(branch, /\^Guests must be at most \(\\d\+\)\\\.\$/, 'the cap is read from the server message');
  assert.match(branch, /tServer\(err\.fields\.guests\)/, 'other messages still go through tServer');
  assert.doesNotMatch(branch, /alert/, 'the branch draws no alert');
  assert.match(branch, /summary\.replaceChildren\(\)/, 'the summary is cleared, not left showing a stale price');
  assert.match(body.slice(body.indexOf('const reason')), /tServer\(reason\)/, 'other refusals still show the summary alert');
});

test('#34: the Guests box message is set in place, without moving focus', () => {
  const at = src.indexOf('const setGuestsError');
  assert.ok(at > 0, 'the helper exists');
  const helper = src.slice(at, src.indexOf('};', at) + 2);
  assert.match(helper, /form\.querySelector\('\[data-field="num_guests"\]'\)/, 'it writes into the guests field wrapper');
  assert.match(helper, /setAttribute\('aria-invalid', 'true'\)/);
  assert.match(helper, /\.error'\)\.textContent = msg/, 'the message goes in the field error line');
  assert.doesNotMatch(helper, /focus\(/, 'a quote refresh must not pull focus back to the guest field');
});

test('#34: the submit check still names the problem at the Guests field', () => {
  assert.match(src, /errors\.num_guests = t\('This place allows up to \{n\} guests\.', \{ n: l\.max_guests \|\| 50 \}\)/);
});

test('#35: the booking-not-found card does not print the server sentence under its heading', () => {
  const done = src.slice(src.indexOf('export async function bookDoneView'));
  const at = done.search(/\} catch(?: \(err\))? \{/);
  assert.ok(at > 0, 'the status request has its catch');
  const card = done.slice(at, done.indexOf('return;', at));
  assert.match(card, /t\('Booking not found'\)/);
  assert.doesNotMatch(card, /err\.message/, 'the server sentence is not repeated under the heading');
  assert.match(card, /t\("This booking link isn't valid\. Check the link, or ask your host\."\)/);
  assert.match(card, /t\('See all places'\)/);
  assert.match(card, /href: `#\/book\/\$\{params\.slug\}`/);
  assert.match(card, /params\.slug &&/, 'the way back shows only when the slug is known');
});

test('#34: a failed checkout shows each message once; the banner names only messages with no field on the form', () => {
  // The checkout request's catch: the banner and the field messages it writes.
  const post = src.indexOf('await post(`/public/book/${encodeURIComponent(slug)}/units/${l.unit_id}/checkout`');
  assert.ok(post > 0, 'the checkout request is found');
  const start = src.indexOf('} catch (err) {', post);
  const block = src.slice(start, src.indexOf("if (err.code === 'DATES_TAKEN')", start));
  assert.match(block, /const unplaced = err\.fields \? showErrors\(form, tFields\(err\.fields\)\) : \[\];/, 'field messages are placed once; the ones with no field are kept');
  assert.equal((block.match(/showErrors\(/g) || []).length, 1, 'showErrors runs once');
  assert.match(block, /unplaced\.join\(' '\)/, 'the banner names only the messages with no field on the form');
  assert.match(block, /t\('Please check the highlighted fields\.'\)/, 'when every message has a field, the banner says so once');
  assert.match(src, /'Please check the highlighted fields\.': 'Pakitingnan ang mga naka-highlight\.'/, 'that line has a Taglish entry');
});

test('#34: a code refused at checkout keeps its message under the code field; the quote status line is cleared before the field message goes in', () => {
  // The checkout request's catch, up to the DATES_TAKEN branch that follows the placement.
  const post = src.indexOf('await post(`/public/book/${encodeURIComponent(slug)}/units/${l.unit_id}/checkout`');
  const start = src.indexOf('} catch (err) {', post);
  const block = src.slice(start, src.indexOf("if (err.code === 'DATES_TAKEN')", start));
  const placed = block.indexOf('showErrors(');
  assert.ok(placed > 0, 'the field messages are placed');
  const clear = block.indexOf("codeMsg.textContent = ''");
  assert.ok(clear > 0 && clear < placed, 'the quote status line is cleared before the field message is placed');
  assert.match(block.slice(0, placed), /codeMsg\.className = 'muted small';/, 'the status line drops its error class, so the field message lands in the error line under the box');
  assert.doesNotMatch(block.slice(placed), /codeMsg/, 'nothing after the placement touches the status line');
  assert.match(block, /codeBox\.open = true/, 'the code box opens so the message is visible');
});

test('#34 and #35: the new wording has Taglish entries', () => {
  assert.match(src, /"This booking link isn't valid\. Check the link, or ask your host\.": 'Hindi valid ang booking link na ito\. [^']+'/);
  const i18n = read('i18n.js');
  assert.match(i18n, /'See all places': 'Tingnan lahat ng lugar'/);
  assert.match(i18n, /'Booking not found': 'Hindi makita ang booking'/);
});

test('every t() string on the booking page has a Taglish entry', () => {
  // The same key rules test/language.test.js applies to every guest page, run here on book.js alone.
  const keys = new Set();
  const dict = read('i18n.js');
  for (const m of dict.matchAll(/^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"):/gm)) keys.add((m[1] ?? m[2]).replace(/\\'/g, "'"));
  for (const m of dict.matchAll(/,\s*'((?:[^'\\]|\\.)*)':/g)) keys.add(m[1].replace(/\\'/g, "'"));
  for (const m of src.matchAll(/^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"):\s*'/gm)) keys.add((m[1] ?? m[2]).replace(/\\'/g, "'"));
  const missing = [];
  for (const m of src.matchAll(/\bt\((?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) {
    const k = (m[1] ?? m[2]).replace(/\\'/g, "'");
    if (!keys.has(k)) missing.push(k);
  }
  assert.deepEqual(missing, []);
});
