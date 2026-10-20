'use strict';

// QA round 21, lane QUO (public/js/views/quotes.js). Frontend only: no database, no server.
// New quote reports dates, guest limit, email and amounts in one pass; a missing quote gets an h1; Cancel quote lands focus on the heading.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '..', 'public', 'js');
const quotesSrc = fs.readFileSync(path.join(SRC, 'views', 'quotes.js'), 'utf8');

let quotes;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-quo-r21-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner' } };\nexport const navigate = () => {};\n");
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), `export function guestsProblem() { return null; }\nexport function addDays(d) { return d; }\nexport function boxValue() { return ""; }\n`);
  fs.writeFileSync(path.join(dir, 'views', 'quotes.js'), quotesSrc);
  globalThis.Node ||= class {};
  globalThis.Element ||= class extends globalThis.Node {};
  globalThis.document ||= { createElement: () => ({}), createTextNode: () => ({}) };
  quotes = await import(pathToFileURL(path.join(dir, 'views', 'quotes.js')));
});

test('reversed dates, too many guests, bad email and a negative amount are all reported at once', () => {
  const listings = [{ unit_id: 'u1', max_guests: 6 }];
  const f = quotes.fieldProblems({ unit_id: 'u1', check_in: '2030-05-10', check_out: '2030-05-08', num_guests: '40', guest_email: 'bad@', accommodation_total: '-5', cleaning_fee: '', discount_amount: '' }, listings);
  assert.deepEqual(Object.keys(f).sort(), ['accommodation_total', 'guest_email', 'num_guests']);
  assert.equal(quotes.datesProblem('2030-05-10', '2030-05-08'), 'Check-out must be after check-in.');
  assert.equal(f.num_guests, 'This listing allows up to 6 guests.');
  assert.equal(f.guest_email, 'Enter a valid email address.');
  assert.equal(f.accommodation_total, 'Accommodation cannot be negative.');
});

test('a clean form has no problems; bad cleaning and discount amounts are named', () => {
  const l = [{ unit_id: 'u1', max_guests: 6 }];
  const ok = { unit_id: 'u1', check_in: '2030-05-08', check_out: '2030-05-10', num_guests: '2', guest_email: 'a@b.co', accommodation_total: '5000', cleaning_fee: '', discount_amount: '' };
  assert.deepEqual(quotes.fieldProblems(ok, l), {});
  const f = quotes.fieldProblems({ ...ok, cleaning_fee: '1,5', discount_amount: '9000' }, l);
  assert.equal(f.cleaning_fee, 'Cleaning fee must be a valid amount (e.g. 8500 or 8500.50).');
  assert.equal(f.discount_amount, "The discount can't be more than the accommodation.");
});

test('a missing quote renders the page error (an h1), and Cancel quote moves focus to the heading', () => {
  assert.match(quotesSrc, /err\?\.status === 404 \? pageError\(err\)/);
  assert.match(quotesSrc, /Quote cancelled\.', true\)/);
  assert.match(quotesSrc, /await rerender\(\);[\s\S]{0,400}\.focus\(\{ preventScroll: true \}\)/);
  assert.match(quotesSrc, /check: \(d\) => \{\s*const bad = fieldProblems\(d, listings\);/);
});
