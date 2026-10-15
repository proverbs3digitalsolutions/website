'use strict';

// QA round 9, lane C16 (listings-pricing). Frontend-only: no database. Source scans, plus the one open-or-closed
// helper of listings.js run on its own (listings.js imports the signed-in user from app.js, so it is read as text).
// #34 and #49: Add listing keeps the basics open; price extras, guest info, booking page and payments and booking
//   rules are closed details.form-section groups; a group opens on Edit when the listing holds a value in it.
// QA round 10, lane C08 (#23): More details (room type, tags, building fields) is the first closed group, and the
//   deposit moved from the basics into Booking page and payments, no longer required.
// #37: the channel link reset button reads "Create a new link" and names its listing.
// #50: the pricing explainer is a closed "How pricing works" section.
// node --test --test-concurrency=1 test/qa-r9-c16.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const views = path.join(__dirname, '..', 'public', 'js', 'views');
const src = fs.readFileSync(path.join(views, 'listings.js'), 'utf8');
const pricing = fs.readFileSync(path.join(views, 'pricing.js'), 'utf8');

// Text from a start marker up to the first end marker after it.
function between(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `found: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `found the end after: ${startMarker}`);
  return text.slice(start, end);
}

const fieldsFn = () => between(src, 'function listingFields(', 'async function addListingModal(');
// Each optional group is one <details> call; splitting on it gives the group's options and then its fields.
const groups = () => fieldsFn().split("h('details'").slice(1);
const titleOf = (chunk) => chunk.match(/h\('summary', null, '([^']+)'\)/)?.[1];

const BASICS = ['unit_name', 'unit_type', 'nightly_rate', 'cleaning_fee', 'max_guests'];
const GROUP_FIELDS = {
  'More details': ['room_type'],
  'Price extras': ['weekend_rate', 'holiday_rate', 'weekly_discount', 'fortnight_discount', 'monthly_discount', 'min_price', 'security_deposit_amount'],
  'Guest info': ['checkin_time', 'checkout_time', 'wifi_name', 'wifi_password', 'checkin_instructions', 'house_rules'],
  'Booking page and payments': ['bookable_online', 'description', 'payment_option', 'deposit_pct', 'balance_due_days'],
  'Booking rules': ['min_nights', 'cancellation_policy', 'cancellation_policy_text'],
};

test('the basics stay open and every required field sits above the first collapsed group', () => {
  const text = fieldsFn();
  const firstGroup = text.indexOf("h('details'");
  assert.ok(firstGroup > 0, 'the optional groups are details elements');
  const required = [...text.matchAll(/required: true/g)].map((m) => m.index);
  assert.equal(required.length, 3, 'unit name, type and nightly rate are the required fields');
  for (const at of required) assert.ok(at < firstGroup, `the required field at ${at} is not inside a collapsed group`);
});

test('the optional groups are details.form-section elements with the titles the plan names', () => {
  assert.deepEqual(groups().map(titleOf), ['More details', 'Price extras', 'Guest info', 'Booking page and payments', 'Booking rules']);
  for (const g of groups()) assert.match(g, /^, \{ class: 'form-section', open: holds\(u, \[/, 'each group opens when holds() says so');
});

test('each field sits in its group or the basics, and none was dropped', () => {
  const text = fieldsFn();
  const basics = text.slice(0, text.indexOf("h('details'"));
  for (const name of BASICS) assert.ok(basics.includes(`name: '${name}'`), `${name} is in the basics`);
  const byTitle = Object.fromEntries(groups().map((g) => [titleOf(g), g]));
  assert.ok(byTitle['More details'].includes('tagsField(u.tags)'), 'tags are in More details');
  for (const [title, names] of Object.entries(GROUP_FIELDS)) {
    for (const name of names) assert.ok(byTitle[title].includes(`name: '${name}'`), `${name} is in ${title}`);
  }
  // Every field of the form is still there: 5 basics, room type and tags in More details, 4 more groups.
  const placed = BASICS.length + 1 + Object.values(GROUP_FIELDS).flat().length;
  assert.equal(placed, 28, 'the form keeps all 28 fields');
});

test('an Edit opens a group only when the listing holds a value other than its starting one', () => {
  const holds = new Function(`${between(src, 'const START = {', 'function listingFields(')}\nreturn holds;`)();
  const PRICE = GROUP_FIELDS['Price extras'];
  const GUEST = GROUP_FIELDS['Guest info'];
  const PAGE = GROUP_FIELDS['Booking page and payments'];
  const RULES = GROUP_FIELDS['Booking rules'];
  // A new listing holds nothing, so every group stays closed.
  for (const keys of [PRICE, GUEST, PAGE, RULES]) assert.equal(holds({}, keys), false);
  // What the database returns for a listing that never used a group: zero money, default times, default options.
  assert.equal(holds({ security_deposit_amount: '0.00', weekly_discount: '0.00', fortnight_discount: '0.00', monthly_discount: '0.00', min_price: null, weekend_rate: null, holiday_rate: null }, PRICE), false);
  assert.equal(holds({ checkin_time: '14:00:00', checkout_time: '12:00:00', wifi_name: null, wifi_password: '', checkin_instructions: null, house_rules: null }, GUEST), false);
  assert.equal(holds({ bookable_online: false, description: null, payment_option: 'either', balance_due_days: 3 }, PAGE), false);
  assert.equal(holds({ min_nights: 1, cancellation_policy: null, cancellation_policy_text: null }, RULES), false);
  // A saved value opens its group.
  assert.equal(holds({ weekly_discount: '5.00' }, PRICE), true);
  assert.equal(holds({ min_price: '2500.00' }, PRICE), true);
  assert.equal(holds({ security_deposit_amount: '1500.00' }, PRICE), true);
  assert.equal(holds({ checkin_time: '15:00:00' }, GUEST), true);
  assert.equal(holds({ house_rules: 'No smoking.' }, GUEST), true);
  assert.equal(holds({ bookable_online: true }, PAGE), true);
  assert.equal(holds({ payment_option: 'deposit' }, PAGE), true);
  assert.equal(holds({ balance_due_days: 7 }, PAGE), true);
  assert.equal(holds({ min_nights: 2 }, RULES), true);
  assert.equal(holds({ cancellation_policy: 'strict' }, RULES), true);
});

test('Add listing passes an empty listing, and Edit passes the saved unit to the same form', () => {
  assert.match(src, /fields: \[savedLine, \.\.\.listingFields\(\{\}, roomTypes, newPropMore, \[h\('hr', \{ class: 'divider' \}\), propSelect, newProp\]\)\]/); // QA round 12 (#30): building in Basics; QA round 13 (#39): the saved-building line goes first
  assert.match(src, /listingFields\(\{ \.\.\.unit, tags: unit\.tags \}, roomTypes\)/);
});

test('the channel link reset button reads "Create a new link" and names its listing', () => {
  assert.doesNotMatch(src, /'Reset link'/, 'the old label is gone');
  assert.match(src, /'aria-label': `Create a new link, \$\{listing\.unit_name\}`/, 'the button names its listing');
  assert.match(src, /\}, 'Create a new link'\)\)\),/, 'the visible label reads Create a new link');
  assert.match(src, /title: 'Create a new link\?'/, 'the confirmation keeps its question');
});

test('the pricing explainer is a closed details.form-section titled "How pricing works"', () => {
  assert.doesNotMatch(pricing, /How a night is priced/, 'the old title is gone');
  assert.match(pricing, /h\('details', \{ class: 'form-section' \},\s*h\('summary', null, h\('h2', null, 'How pricing works'\)\),/);
  assert.doesNotMatch(pricing, /h\('details', \{[^}]*open/, 'the explainer is closed by default');
  assert.match(pricing, /h\('ol', \{ class: 'pricing-order' \}/, 'the order list is kept');
  assert.match(pricing, /Then the booking-window rules apply/, 'the explanation text is kept');
});

test('the pricing page names the listing sections that exist now', () => {
  assert.doesNotMatch(pricing, /Pricing helpers/, 'the old section name is gone');
  assert.match(pricing, /Change these in Listings → Edit\./);
  assert.doesNotMatch(src, /Pricing helpers/, 'the listing form no longer names a Pricing helpers section');
});
