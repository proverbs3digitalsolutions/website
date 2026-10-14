'use strict';

// QA round 7, C12 (booking page). Frontend only, so these are source checks on book.js (no database).
// #41 (a regression of round 6 C17): a Guests count below 1 says "At least 1 guest." at once and keeps it until
// the count is fixed. A quote refresh clears only the server's guest-limit text, never the page's own message.
// #9: each booking view sets redraw before its first request, so a language switch on an error card redraws that card.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/book.js'), 'utf8');

// The source of one exported view, up to the next top-level export.
function viewSrc(name) {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) return '';
  const next = src.indexOf('\nexport ', start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

// updateQuote(), from its start up to the cancellation policy block that follows it.
const quoteFn = () => src.slice(src.indexOf('async function updateQuote() {'), src.indexOf('// The cancellation policy'));
const quoteBeforeTry = () => { const body = quoteFn(); return body.slice(0, body.indexOf('try {')); };

// The Guests change listener that sets the count message. The timer listener below it re-quotes and has no message.
const countListener = () => {
  const listeners = [...src.matchAll(/form\.elements\.num_guests\?\.addEventListener\('change', \(\) => \{[\s\S]*?\n {2}\}\);/g)].map((m) => m[0]);
  return listeners.find((l) => /guestCountMsg/.test(l)) || '';
};

test('#41: a Guests count below 1 is said on change, at once, with no quote request', () => {
  const listener = countListener();
  assert.ok(listener, 'the Guests change listener that sets the count message is found');
  assert.match(listener, /setGuestsError\(guestCountOk\(\) \? '' : guestCountMsg\(\)\)/);
  assert.doesNotMatch(listener, /updateQuote|\bget\(/, 'the listener makes no quote request');
  assert.match(src, /const guestCountOk = \(\) => \{[\s\S]*?Number\.isInteger\(n\) && n >= 1[\s\S]*?\};/);
});

test('#41: a Guests change drops any server guest-limit text, so the flag never outlives the message it describes', () => {
  assert.match(countListener(), /guestsFromServer = false;/);
});

test('#41: updateQuote does not quote a count below 1', () => {
  assert.match(quoteBeforeTry(), /if \(!guestCountOk\(\)\) return;/);
});

test('#41: updateQuote clears the Guests message only when the server set it', () => {
  const before = quoteBeforeTry();
  assert.match(before, /if \(guestsFromServer\) \{ guestsFromServer = false; setGuestsError\(''\); \}/);
  assert.equal((before.match(/setGuestsError\(''\)/g) || []).length, 1, 'no other clear runs before the quote request');
});

test('#41: the server guest-limit refusal marks its message as the server\'s', () => {
  const body = quoteFn();
  const at = body.indexOf('if (err.fields?.guests)');
  assert.ok(at > 0, 'the guest-limit refusal has its own branch in the catch');
  const branch = body.slice(at, body.indexOf('const reason', at));
  assert.match(branch, /guestsFromServer = true;/);
  assert.match(branch, /setGuestsError\(cap \? t\('Guests must be at most \{n\}\.', \{ n: cap\[1\] \}\) : tServer\(err\.fields\.guests\)\)/);
  assert.match(branch, /\^Guests must be at most \(\\d\+\)\\\.\$/, 'the cap is read from the server message');
  assert.match(branch, /tServer\(err\.fields\.guests\)/, 'other messages still go through tServer');
});

test('#9: each booking view sets redraw before its first request, so a language switch on an error card redraws it', () => {
  for (const name of ['bookHostView', 'bookListingView', 'bookDoneView']) {
    const v = viewSrc(name);
    const at = v.indexOf('redraw = () =>');
    const request = v.indexOf('await get(');
    assert.ok(at > 0 && at < request, `${name}: redraw is set before its first request`);
  }
});

test('the Page not found cards print the server sentence through tServer, so the Taglish page reads it in Taglish', () => {
  for (const name of ['bookHostView', 'bookListingView']) {
    const v = viewSrc(name);
    const at = v.indexOf("t('Page not found')");
    assert.ok(at > 0, `${name}: the Page not found card is found`);
    const card = v.slice(at, v.indexOf('return;', at));
    assert.match(card, /h\('p', \{ class: 'muted' \}, tServer\(err\.message\)\)/, `${name}: the server sentence goes through tServer`);
    assert.equal((card.match(/err\.message/g) || []).length, 1, `${name}: err.message is printed only through tServer`);
  }
});

test('#9: the done page sets redraw to re-check the status before its first request', () => {
  const done = viewSrc('bookDoneView');
  const at = done.indexOf('redraw = () => check();');
  assert.ok(at > 0, 'redraw re-checks the status');
  assert.ok(at < done.indexOf('get('), 'redraw is set before the status request');
});
