'use strict';
// QA round 12, lane C13 (listings, calendar, pricing, Launchpad text; frontend only, no database).
// #29: a nightly rate above 50,000 is asked about before it is saved (public/js/rates.js), never refused.
// #30: Basics starts with the listing name, type, base rate and cleaning fee, then the building; the Launchpad step says so.
// #31: the calendar page is headed "Calendar"; the channel link field names the channels it comes from.
// #26: the bulk block preview's last column is "Last night", the check-out day less one.
// Class (list defaults): the guests list request sends its defaults through apiFilters.
// node --test --test-concurrency=1 test/qa-r12-c13.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..', 'public', 'js');
const views = path.join(root, 'views');
const listings = fs.readFileSync(path.join(views, 'listings.js'), 'utf8');
const calendar = fs.readFileSync(path.join(views, 'calendar.js'), 'utf8');
const pricing = fs.readFileSync(path.join(views, 'pricing.js'), 'utf8');
const onboarding = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'onboarding.js'), 'utf8');

// Text from a start marker up to the first end marker after it.
function between(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `found: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `found the end after: ${startMarker}`);
  return text.slice(start, end);
}

// rates.js is loaded from a temp copy. Its ui.js import is a stub that re-exports the real ui.js (peso and parseAmount
// stay real) and replaces confirmDialog with a recorder, so each test can see the question and choose the answer.
let dir;
test.before(() => {
  globalThis.Element = class { }; // ui.js names the DOM Element class when it loads
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r12-c13-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(root, 'api.js'), path.join(dir, 'api.js'));
  fs.copyFileSync(path.join(root, 'ui.js'), path.join(dir, 'ui-real.js'));
  fs.writeFileSync(path.join(dir, 'ui.js'), [
    "export * from './ui-real.js';",
    'export const asked = [];',
    'export let answer = true;',
    'export function setAnswer(v) { answer = v; }',
    'export async function confirmDialog(opts) { asked.push(opts); return answer; }',
    '',
  ].join('\n'));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// Copies rates.js in on each call, so a missing module fails the test that needs it rather than the whole file.
async function loaded() {
  fs.copyFileSync(path.join(root, 'rates.js'), path.join(dir, 'rates.js'));
  const rates = await import(pathToFileURL(path.join(dir, 'rates.js')).href);
  const ui = await import(pathToFileURL(path.join(dir, 'ui.js')).href);
  ui.asked.length = 0;
  ui.setAnswer(true);
  return { ...rates, ui };
}

// ---- #29: a high nightly rate is asked about, never refused
test('#29 HIGH_NIGHTLY_RATE is 50,000 pesos a night', async () => {
  assert.equal((await loaded()).HIGH_NIGHTLY_RATE, 50000);
});

test('#29 a rate at or under 50,000, or text that is not a number, saves without a question', async () => {
  const { highRateOk, ui } = await loaded();
  for (const amount of [3500, 50000, '2,500', '', undefined, 'abc']) {
    assert.equal(await highRateOk(amount), true, `${String(amount)} saves`);
  }
  assert.equal(ui.asked.length, 0, 'no question was asked');
});

test('#29 a rate above 50,000 asks once, in plain words, and saves when the person says Save anyway', async () => {
  const { highRateOk, ui } = await loaded();
  assert.equal(await highRateOk(99999999), true);
  assert.equal(ui.asked.length, 1, 'one question');
  assert.deepEqual(ui.asked[0], {
    title: 'Check the nightly rate',
    text: 'This is ₱99,999,999.00 a night. Save anyway?',
    confirmText: 'Save anyway',
    cancelText: 'Change it',
  });
});

test('#29 a typed rate above 50,000 is read as the form reads it, and cancelling saves nothing', async () => {
  const { highRateOk, ui } = await loaded();
  ui.setAnswer(null); // "Change it", Escape or the close button
  assert.equal(await highRateOk('60,000'), false);
  assert.equal(ui.asked.length, 1, 'the typed amount with a comma is asked about');
});

// ---- #29: where the question is asked
test('#29 Add and Edit listing ask about the highest rate typed before anything is saved, and "Change it" keeps the form with that box focused', () => {
  assert.match(listings, /import \{[^}]*\bhighRateOk\b[^}]*\} from '\.\.\/rates\.js';/);
  const check = between(listings, 'async function highRateCheck(', 'async function lowPriceOk(');
  assert.match(check, /\['nightly_rate', 'weekend_rate', 'holiday_rate'\]/, 'the base, weekend and holiday rates are read');
  assert.match(check, /await highRateOk\(top\.amount\)/);
  assert.match(check, /form\.elements\[top\.name\]\.focus\(\);\s*return false;/, '"Change it" focuses that rate box and returns false');
  assert.equal(listings.split('if (!await highRateCheck(d, form)) return false;').length - 1, 2, 'Add and Edit both ask');
  const add = between(listings, 'async function addListingModal(', '// Listing photos for the booking page');
  assert.ok(add.indexOf('highRateCheck(d, form)') < add.indexOf("post('/properties'"), 'asked before the building is saved');
  assert.ok(add.indexOf('highRateCheck(d, form)') < add.indexOf('lowPriceOk(d, form'), 'asked before the lowest-price question');
});

test('#29 the calendar nightly price asks before the save; "Change it" keeps the dialog open with the price box focused', () => {
  assert.match(calendar, /import \{[^}]*\bhighRateOk\b[^}]*\} from '\.\.\/rates\.js';/);
  assert.match(calendar, /import \{[^}]*\bparseAmount\b[^}]*\} from '\.\.\/ui\.js';/);
  const body = between(calendar, 'function priceModal(', 'async function blockMenu(');
  assert.match(body, /onSubmit: async \(d, \{ form \}\) => \{/);
  assert.match(body, /if \(!await highRateOk\(parseAmount\(d\.price\)\)\) \{ form\.elements\.price\.focus\(\); return false; \}/);
  assert.ok(body.indexOf('highRateOk(') < body.indexOf("api('PUT', '/rates'"), 'asked before the PUT /rates');
});

test('#29 a bulk "Set a price" asks about a high price before it is applied; "Change it" puts focus in the price box', () => {
  assert.match(pricing, /import \{ highRateOk \} from '\.\.\/rates\.js';/);
  assert.match(pricing, /^import \{[^}]*\bparseAmount\b[^}]*\} from '\.\.\/ui\.js';$/m);
  const apply = between(pricing, "applyBtn.addEventListener('click', async () => {", 'const r = await run(false);');
  assert.match(apply, /if \(actSel\.value === 'set' && !await highRateOk\(parseAmount\(price\.value\)\)\) \{ price\.focus\(\); return; \}/);
});

// ---- #30: Basics order and the Launchpad text
test('#30 Basics: listing name, type, base rate and cleaning fee come first, then the building, then maximum guests', () => {
  const basics = between(listings, 'function listingFields(', "h('details', { class: 'form-section', open: holds(u, ['room_type', 'tags'])");
  const order = ["name: 'unit_name'", "name: 'unit_type'", "name: 'nightly_rate'", "name: 'cleaning_fee'", '...buildingBasics', "name: 'max_guests'"]
    .map((s) => { const i = basics.indexOf(s); assert.ok(i > -1, `${s} is in Basics`); return i; });
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'in that order');
  const add = between(listings, 'async function addListingModal(', '// Listing photos for the booking page');
  assert.match(add, /listingFields\(\{\}, roomTypes, newPropMore, \[h\('hr', \{ class: 'divider' \}\), propSelect, newProp\]\)/);
  assert.match(add, /Guests see the city and province on your booking page\. The street address stays private\./);
});

test('#30 the Launchpad step names the listing name, the rate, the cleaning fee and the building', () => {
  assert.ok(onboarding.includes("'Enter the listing name (for example Tower 1 - 1201), the nightly rate, the cleaning fee and the building.'"));
  assert.ok(!onboarding.includes('the unit name'), 'the old wording is gone');
});

// ---- #31: the calendar heading and the channel link label
test('#31 the calendar page is headed "Calendar", and the channel link field names the channels it comes from', () => {
  assert.match(calendar, /h\('h1', null, 'Calendar'\)/);
  assert.ok(!calendar.includes("'Multi-calendar'"), 'no Multi-calendar heading');
  assert.ok(listings.includes("label: 'Calendar link from Airbnb, Booking.com or Agoda (ends in .ics)'"));
  assert.ok(!listings.includes("'Their calendar (iCal) link'"), 'the old label is gone');
});

// ---- #26: the block preview names the last night
test('#26 the bulk block preview has a "Last night" column: the check-out day less one', () => {
  const preview = between(pricing, 'if (isBlocks()) {', '} else {');
  assert.match(preview, /tableOf\(\['Listing', 'From', 'Last night'\], rows\.map\(\(x\) => \[x\.unit_name, fmtDate\(x\.check_in\), fmtDate\(addDays\(x\.check_out, -1\)\)\]\)\)/);
  assert.ok(!preview.includes("'To'"), 'no To column');
});

// ---- class: list defaults on the guests list
test('the guests list request is built with apiFilters, and the address keeps changed()', () => {
  assert.match(listings, /import \{[^}]*\bapiFilters\b[^}]*\} from '\.\.\/filters\.js';/);
  assert.match(listings, /get\(`\/guests\$\{qs\(apiFilters\(filters\)\)\}`\)/);
  assert.ok(!listings.includes('qs(active)'), 'no request is built from the changed() copy');
  assert.ok(listings.includes('`#/guests${qs(changed(filters, defaults))}`'), 'the address still uses changed()');
});
