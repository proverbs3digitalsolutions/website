'use strict';

// QA round 4, C20 "book page guest count" (re-verify R7): on the public booking page, changing Guests with
// dates already picked re-runs the quote, so a count over the listing's limit shows the server's refusal in
// the summary and hides the Total, instead of leaving the old price on screen until "Continue to payment".
// The re-quote waits for the count to settle, so typing or spinning it makes one request, not one per change.
// Static checks on the source, plus a run of the listener block with fake timers (no server, no database).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const book = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'book.js'), 'utf8');

// The guest-count listener block: from its own "let guestTimer;" to the submit handler that follows it.
const start = book.indexOf('let guestTimer;');
const end = book.indexOf("form.addEventListener('submit'");
const block = start > 0 && end > start ? book.slice(start, end) : '';

test('book: changing Guests re-runs the quote once dates are picked, not only when add-ons are picked', () => {
  assert.ok(block, 'the guest-count listener block is found');
  assert.match(block, /num_guests\?\.addEventListener\('change'/);
  assert.match(block, /checkIn && checkOut/, 'the re-quote needs both dates');
  assert.match(block, /updateQuote\(\)/);
  assert.doesNotMatch(block, /picked\.size/, 'add-ons no longer decide whether the quote is re-run');
});

test('book: the guest re-quote waits a short pause after the last change, and never on every keystroke', () => {
  assert.match(block, /clearTimeout\(guestTimer\)/);
  assert.match(block, /guestTimer = setTimeout\(/);
  assert.match(block, /\}, 300\)/, 'a 300 ms pause, like the other debounced inputs');
  assert.doesNotMatch(book, /num_guests\?\.addEventListener\('input'/);
});

test('book: a refused quote shows its message in the summary and clears the Total and Continue', () => {
  const quote = book.slice(book.indexOf('async function updateQuote()'), book.indexOf('// The cancellation policy'));
  assert.ok(quote.length > 0, 'updateQuote is found');
  assert.match(quote, /current = null;\s*submit\.disabled = true;/, 'Continue is off until a quote succeeds');
  assert.match(quote, /const reason = err\.fields \? Object\.values\(err\.fields\)\[0\] : err\.message;/);
  assert.match(quote, /summary\.replaceChildren\(h\('div', \{ class: 'alert alert--error', role: 'alert' \}, tServer\(reason\)\)\);/);
});

test('book: the page adds no window.alert, confirm or prompt', () => {
  assert.doesNotMatch(book, /window\.(alert|confirm|prompt)\(/);
});

test('book: a guest-count change re-quotes once after the pause when dates are picked, and not at all without dates', () => {
  // Run the listener block with a stub form and fake timers. Its only outside names are the form, updateQuote,
  // the timers and the two dates, so the block must not reach for add-ons or anything else.
  const wire = (checkIn, checkOut) => {
    const timers = new Map();
    let nextId = 0;
    let onChange = null;
    let quotes = 0;
    const form = { elements: { num_guests: { addEventListener: (ev, fn) => { if (ev === 'change') onChange = fn; } } } };
    const fakeSetTimeout = (fn, ms) => { nextId += 1; timers.set(nextId, { fn, ms }); return nextId; };
    const fakeClearTimeout = (id) => { timers.delete(id); };
    const updateQuote = () => { quotes += 1; };
    new Function('form', 'updateQuote', 'setTimeout', 'clearTimeout', 'checkIn', 'checkOut', `${block}`)(
      form, updateQuote, fakeSetTimeout, fakeClearTimeout, checkIn, checkOut);
    assert.equal(typeof onChange, 'function', 'the block registers the Guests change listener');
    const fire = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } };
    return { change: () => onChange(), timers, fire, quotes: () => quotes };
  };

  // Dates picked: two quick changes make one pending quote, which runs once after the pause.
  const dated = wire('2026-11-04', '2026-11-05');
  dated.change();
  dated.change();
  assert.equal(dated.quotes(), 0, 'nothing is sent straight away');
  assert.equal(dated.timers.size, 1, 'the second change replaces the first pause');
  const [{ ms }] = dated.timers.values();
  assert.ok(ms >= 200 && ms <= 500, `a short pause, got ${ms} ms`);
  dated.fire();
  assert.equal(dated.quotes(), 1, 'one quote after the count settles');

  // No dates yet: changing Guests sends nothing.
  const undated = wire(null, null);
  undated.change();
  undated.fire();
  assert.equal(undated.quotes(), 0);
});
