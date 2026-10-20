'use strict';

// QA round 10, lane C08 (listings-settings). Frontend-only: no database. Source scans, plus the holds() helper of
// listings.js run on its own (listings.js imports app.js, so the helper is read as text, as qa-r9-c16 does).
// #21: the channel link error is announced, marks the link field and moves focus to that field.
// #23: the first Add listing screen shows the basics (and, for a new building, its name and address, QA round 11 K10);
//      the property type, room type and tags sit in a closed "More details" section; the deposit moves to
//      "Booking page and payments" and is not required.
// K17: a default time (14:00 or 14:00:00) does not open Guest info on Edit; a changed time does.
// #22: Turn on is disabled, with a line saying why, while no listing is ticked for the booking page.
// #16: the plan card counts "Short-term listings", and says monthly units are not counted when a listing has no nightly rate (QA round 11, K5).
// node --test --test-concurrency=1 test/qa-r10-c08.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const views = path.join(__dirname, '..', 'public', 'js', 'views');
const src = fs.readFileSync(path.join(views, 'listings.js'), 'utf8');
const settings = fs.readFileSync(path.join(views, 'settings.js'), 'utf8');

// Text from a start marker up to the first end marker after it.
function between(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `found: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `found the end after: ${startMarker}`);
  return text.slice(start, end);
}

const fieldsFn = () => between(src, 'function listingFields(', 'async function addListingModal(');
const addModal = () => between(src, 'async function addListingModal(', '// Listing photos for the booking page');
const channels = () => between(src, 'async function channelsModal(', '// Guest pages: the guidebook');
const bookingCard = () => between(settings, 'async function bookingCard(', '// Guest experience: public review links');
const planCard = () => between(settings, 'async function planCard(', '// Choose a plan and length');

// ---- #21: the channel link error
test('#21: the calendar-link error box is an alert, and a link problem is shown under the link field', () => {
  const modal = channels();
  assert.match(modal, /const status = h\('div'\);\n {2}status\.setAttribute\('role', 'alert'\);/, 'the message box is announced');
  assert.match(modal, /clearErrors\(addForm\); status\.replaceChildren\(\);/, 'each submit starts with no old message');
  assert.match(modal, /if \(err\.fields\?\.url\) showErrors\(addForm, \{ url: err\.fields\.url \}\);/,
    'a link problem goes to the link field: it is marked (aria-invalid) and focused by showErrors');
  assert.match(modal, /else status\.replaceChildren\(h\('div', \{ class: 'alert alert--error' \}, err\.message\)\);/,
    'any other problem goes in the alert above the form');
  assert.doesNotMatch(modal, /err\.fields\?\.url \|\| err\.message/, 'the old line that wrote the link problem into the plain box is gone');
  assert.match(src, /import \{[^}]*\bshowErrors\b[^}]*\} from '\.\.\/ui\.js'/, 'showErrors is imported from ui.js');
  assert.match(src, /import \{[^}]*\bclearErrors\b[^}]*\} from '\.\.\/ui\.js'/, 'clearErrors is imported from ui.js');
  // The link field is built by field(), which ties its input to an alert box with aria-describedby.
  assert.match(modal, /field\(\{ name: 'url', label: 'Calendar link from Airbnb, Booking\.com or Agoda \(ends in \.ics\)', type: 'url'/); // QA round 12 (#31) relabelled it; QA round 13 (#41) says ".ics" in plain words
});

// ---- #23: the Add listing screen
test('#23: the basics are the listing name, type, nightly rate, cleaning fee and guests, and come before any collapsed group', () => {
  const text = fieldsFn();
  const firstDetails = text.indexOf("h('details'");
  const basics = text.slice(0, firstDetails);
  for (const name of ['unit_name', 'unit_type', 'nightly_rate', 'cleaning_fee', 'max_guests']) {
    assert.ok(basics.includes(`name: '${name}'`), `${name} is in the basics`);
  }
  assert.ok(!basics.includes("name: 'room_type'"), 'room type is not in the basics');
  assert.ok(!basics.includes("name: 'deposit_pct'"), 'the deposit is not in the basics');
  assert.ok(!basics.includes('tagsField('), 'tags are not in the basics');
});

test('#23: More details is a closed section holding the property type, room type and tags', () => {
  const text = fieldsFn();
  assert.match(text, /h\('details', \{ class: 'form-section', open: holds\(u, \['room_type', 'tags'\]\) \},\s*h\('summary', null, 'More details'\),\s*building,/,
    'More details opens only when the listing holds a room type or tags, and takes the building fields first');
  const more = between(text, "h('summary', null, 'More details')", "h('summary', null, 'Price extras')");
  assert.ok(more.includes("name: 'room_type'"), 'room type is in More details');
  assert.ok(more.includes('tagsField(u.tags)'), 'tags are in More details');
  // QA round 11 (K10, N6): the building name and address move into Basics, required; only the property type stays in More details.
  const addText = addModal();
  const nameBlock = between(addText, 'const newProp = h(', 'const newPropMore = h(');
  for (const name of ['property_name', 'address', 'city', 'province']) {
    assert.ok(nameBlock.includes(`name: '${name}'`), `${name} is at the top, with the building choice`);
  }
  assert.ok(!nameBlock.includes("name: 'property_type'"), 'property type is not at the top');
  const buildingBlock = between(addText, 'const newPropMore = h(', 'const showNewBuilding');
  assert.ok(buildingBlock.includes("name: 'property_type'"), 'property type is in the building block (More details)');
  for (const name of ['property_name', 'address', 'city', 'province']) {
    assert.ok(!buildingBlock.includes(`name: '${name}'`), `${name} is not in More details`);
  }
  // QA round 12 (#30): the building fields now sit in Basics after the cleaning fee; only the property type stays in More details.
  assert.match(addText, /listingFields\(\{\}, roomTypes, newPropMore, \[h\('hr', \{ class: 'divider' \}\), propSelect, newProp\]\)/,
    'the Add form passes the building fields in Basics, after the cleaning fee, and the property type into More details');
  // Choosing a building (or a new one) shows or hides both parts of the building fields together.
  assert.match(addText, /const showNewBuilding = \(show\) => \{ newProp\.hidden = !show; newPropMore\.hidden = !show; for \(const el of buildingInputs\) el\.required = show; \};/);
  assert.match(addText, /showNewBuilding\(e\.target\.value === '__new'\)/);
  assert.match(addText, /showNewBuilding\(false\);/, 'a saved building hides its fields too');
});

test('#23: the deposit sits in Booking page and payments and is not required (a blank one saves the default 50)', () => {
  const text = fieldsFn();
  const page = between(text, "h('summary', null, 'Booking page and payments')", "h('summary', null, 'Booking rules')");
  assert.match(page, /field\(\{ name: 'deposit_pct', label: 'Deposit \(% of the total\)', type: 'number', min: 10, max: 90/);
  const required = [...text.matchAll(/required: true/g)].map((m) => m.index);
  assert.equal(required.length, 3, 'unit name, type and nightly rate are the only required fields');
  const firstDetails = text.indexOf("h('details'");
  for (const at of required) assert.ok(at < firstDetails, 'each required field is in the basics');
});

// ---- K17: the default time is not a change
test('K17: a default check-in or check-out time does not open Guest info on Edit; a changed one does', () => {
  const holds = new Function(`${between(src, 'const START = {', 'function listingFields(')}\nreturn holds;`)();
  const GUEST = ['checkin_time', 'checkout_time', 'wifi_name', 'wifi_password', 'checkin_instructions', 'house_rules'];
  assert.equal(holds({ checkin_time: '14:00', checkout_time: '12:00' }, GUEST), false, 'the defaults without seconds');
  assert.equal(holds({ checkin_time: '14:00:00', checkout_time: '12:00:00' }, GUEST), false, 'the defaults as the database sends them');
  assert.equal(holds({ checkin_time: '15:00' }, GUEST), true, 'a changed check-in time');
  assert.equal(holds({ checkin_time: '15:00:00' }, GUEST), true, 'a changed check-in time as the database sends it');
  assert.equal(holds({ checkout_time: '11:00' }, GUEST), true, 'a changed check-out time');
});

test('the More details and Booking page groups open on Edit only for a saved value that is not the default', () => {
  const holds = new Function(`${between(src, 'const START = {', 'function listingFields(')}\nreturn holds;`)();
  const MORE = ['room_type', 'tags'];
  const PAGE = ['bookable_online', 'description', 'payment_option', 'deposit_pct', 'balance_due_days'];
  assert.equal(holds({}, MORE), false, 'a new listing keeps More details closed');
  assert.equal(holds({ room_type: null, tags: [] }, MORE), false, 'a listing with no room type or tags keeps it closed');
  assert.equal(holds({ room_type: 'Studio' }, MORE), true);
  assert.equal(holds({ tags: ['beachfront'] }, MORE), true);
  assert.equal(holds({ deposit_pct: 50, bookable_online: false, payment_option: 'either', balance_due_days: 3 }, PAGE), false, 'the default deposit keeps the group closed');
  assert.equal(holds({ deposit_pct: 30 }, PAGE), true, 'a changed deposit opens the group');
});

// ---- the Edit form keeps the same signature (the building block is only for Add)
test('Edit passes the saved unit to the same form without a building block', () => {
  assert.match(src, /listingFields\(\{ \.\.\.unit, tags: unit\.tags \}, roomTypes, null, \[\], !bookable\.size\)/);
});

// ---- #22: Turn on needs a listing
test('#22: Turn on is disabled, with a line under it, while no listing is ticked for the booking page', () => {
  const card = bookingCard();
  assert.match(card, /const listed = b\.listings\.filter\(\(l\) => l\.bookable_online\);/);
  assert.match(card, /const noListing = !listed\.length;/);
  const on = card.split('\n').find((line) => line.includes("'Turn on'"));
  assert.ok(on, 'the Turn on button is in the card');
  assert.match(on, /disabled: noListing/, 'Turn on is disabled while no listing is ticked');
  const off = card.split('\n').find((line) => line.includes("'Turn off'"));
  assert.ok(off, 'the Turn off button is in the card');
  assert.doesNotMatch(off, /disabled/, 'Turn off is never gated');
  assert.match(card, /Tick at least one listing for your page first \(Listings → Edit → Booking page and payments\)\./,
    'the line says what to do');
  assert.match(card, /!b\.enabled && b\.paymongo_connected && noListing && h\('p', \{ class: 'muted small', id: 'bp-on-hint' \}/,
    'the line shows only when the page is off and PayMongo is connected');
});

// ---- #16: the plan card's listing count
test('#16: the plan card counts short-term listings and notes that monthly units are not counted', () => {
  // The note's condition changed in QA round 11 (K5): see the monthlyNote assertion below.
  const card = planCard();
  assert.match(card, /h\('dt', null, 'Short-term listings'\)/, 'the count is labelled for what it counts');
  assert.doesNotMatch(card, /h\('dt', null, 'Listings'\)/, 'the old label is gone');
  assert.match(card, /h\('dd', null, `\$\{shortTermCount\(listings\)\} of /, 'the count is still the short-term count');
  assert.match(card, /monthlyNote\(listings\) && h\('div', \{ class: 'muted small' \}, 'Monthly units are not counted\.'\)/,
    'the note shows under the count when a listing has no nightly rate (QA round 11, K5: the workspace type no longer decides it)');
});
