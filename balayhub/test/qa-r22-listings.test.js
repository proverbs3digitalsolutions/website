'use strict';
// QA round 22, lane LISTINGS (listings.js, frontend only, no database).
// ONB-1 focus after Save anyway, ONB-2 no preset channel (inferred from the link), ONB-4 booking fold opens until one listing is on the page.
// TEST_DATABASE_URL=... node --test --test-concurrency=1 test/qa-r22-listings.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/listings.js'), 'utf8');
const m = src.match(/export function channelFromLink[\s\S]*?\n}\n/);
const channelFromLink = m ? new Function(`${m[0].replace('export ', '')}\nreturn channelFromLink;`)() : () => { throw new Error('channelFromLink not exported'); };

test('ONB-2 channelFromLink truth table', () => {
  assert.equal(channelFromLink('https://www.airbnb.com/calendar/ical/1.ics'), 'airbnb');
  assert.equal(channelFromLink('https://airbnb.com.ph/calendar/ical/1.ics'), 'airbnb');
  assert.equal(channelFromLink('https://admin.booking.com/hotel/hoteladmin/ical.html?t=1'), 'booking');
  assert.equal(channelFromLink('https://ycs.agoda.com/ical/1.ics'), 'agoda');
  assert.equal(channelFromLink('https://www.vrbo.com/icalendar/1.ics'), 'vrbo');
  assert.equal(channelFromLink('https://www.expedia.com/x.ics'), 'expedia');
  assert.equal(channelFromLink('https://www.trip.com/x.ics'), 'tripcom');
  assert.equal(channelFromLink('https://example.org/cal.ics'), '');
  assert.equal(channelFromLink('https://notairbnb.com/cal.ics'), '');
  assert.equal(channelFromLink('https://airbnb.com.evil.org/cal.ics'), '');
  assert.equal(channelFromLink('not a link'), '');
  assert.equal(channelFromLink(''), '');
});

test('ONB-2 the Channel box starts empty, hand choice is kept, no channel is refused', () => {
  assert.doesNotMatch(src, /name: 'channel', label: 'Channel', type: 'select', value: 'airbnb'/);
  assert.match(src, /name: 'channel', label: 'Channel', type: 'select', value: '', placeholderOption: 'Choose the channel'/);
  assert.match(src, /chosenByHand/);
  assert.match(src, /Choose which site this calendar link is from\./);
});

test('ONB-1 the rebuilt Channels dialog focuses the new row Sync now, or its heading', () => {
  assert.match(src, /async function channelsModal\(listing, onChange, \{ focusFeedId \} = \{\}\)/);
  assert.match(src, /channelsModal\(listing, onChange, \{ focusFeedId: r\.feed_id \}\)/);
  assert.match(src, /channelsModal\(listing, onChange, \{ focusFeedId: f\.feed_id \}\)/);
});

test('ONB-4 the booking fold opens when no listing is on the booking page yet', () => {
  assert.match(src, /listingFields\(\{ \.\.\.unit, tags: unit\.tags \}, roomTypes, null, \[\], !bookable\.size\)/);
  assert.match(src, /open: openBooking \|\| holds\(u, \['bookable_online'/);
});

test('LIST2 the channels add form clears a field mark as soon as the field changes, also when the link picks the channel', () => {
  assert.match(src, /const clearFieldError = \(name\) => \{[\s\S]*?field--invalid[\s\S]*?removeAttribute\('aria-invalid'\)[\s\S]*?\.error[\s\S]*?\};/);
  assert.match(src, /channelSelect\.addEventListener\('change', \(\) => \{ chosenByHand = true; clearFieldError\('channel'\); \}\)/);
  assert.match(src, /if \(!chosenByHand\) \{ channelSelect\.value = channelFromLink\(addForm\.elements\.url\.value\); if \(channelSelect\.value\) clearFieldError\('channel'\); \}/);
  assert.match(src, /addForm\.elements\.url\.addEventListener\('input', \(\) => clearFieldError\('url'\)\)/);
});
