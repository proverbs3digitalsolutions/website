'use strict';

// QA round 8, lane C01 (settings-view). The Activity screen names the fields an edit changed, as labels only, for
// every edit the round-8 writers log: workspace modules and language, booking page, manual payments, team access,
// profile, notifications, unit owners and the rest. "Offset days", "Par level" and "Unit ids" no longer reach the
// screen, and each Save button on Settings names its card for a screen reader. No database is needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SETTINGS = path.join(__dirname, '../public/js/views/settings.js');
let settings; let dir;

test.before(async () => {
  // settings.js is a browser module. Load it from a temp copy, with its browser-only imports stubbed.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r8-c01-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = {}; export async function refreshUser() {}\n');
  fs.writeFileSync(path.join(dir, 'notifications.js'), 'export async function notificationsCard() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'themeswitch.js'), 'export function themeSwitch() { return null; }\n');
  fs.copyFileSync(SETTINGS, path.join(dir, 'views', 'settings.js'));
  globalThis.Element = class { };
  settings = await import(pathToFileURL(path.join(dir, 'views', 'settings.js')).href);
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// Each key a round-8 writer can log, with the words the Activity screen must use for it.
const FIELD_LABELS = [
  ['business_type', 'Modules for this workspace'], ['guest_language', 'Default language'],
  ['intro', 'Welcome text'], ['paymongo_key', 'PayMongo key'], ['instructions', 'Payment details for guests'],
  ['full_name', 'Full name'], ['phone', 'Mobile number'],
  ['management_fee_pct', 'Management fee'], ['fee_model', 'Fee type'], ['flat_monthly_fee', 'Flat monthly fee'],
  ['reserve_target', 'Repairs reserve target'], ['reserve_monthly', 'Repairs reserve top-up'],
  ['cleaning_to_manager', 'Cleaning fees kept for cleaning'], ['unit_ids', 'Units'], ['offset_days', 'Number of days'],
  ['par_level', 'Keep at least'], ['monthly_rent', 'Monthly rent'], ['due_day', 'Rent due day'],
  ['deposit_amount', 'Security deposit'], ['days', 'Days'], ['max_quantity', 'Maximum quantity'],
  ['subject', 'Subject'], ['body', 'Message'], ['notes', 'Notes'], ['description', 'Details'],
  ['priority', 'Priority'], ['assigned_to', 'Assigned to'], ['estimated_cost', 'Estimated cost'],
  ['role', 'Role'], ['property_ids', 'Properties'], ['name', 'Name'], ['enabled', 'Turned on'],
];

test('every logged field reads as its label, with no values and no raw key', () => {
  for (const [key, label] of FIELD_LABELS) {
    assert.equal(settings.summarize({ fields: [key] }), `Changed: ${label}`, key);
  }
});

test('the QA examples read as labels, and a *_ids key is labelled, not shown raw', () => {
  assert.equal(settings.summarize({ fields: ['business_type', 'guest_language'] }), 'Changed: Modules for this workspace, Default language');
  assert.equal(settings.summarize({ fields: ['unit_ids', 'offset_days', 'par_level'] }), 'Changed: Units, Number of days, Keep at least');
  assert.equal(settings.summarize({ fields: ['some_new_key'] }), 'Changed: Some new key');
  assert.doesNotMatch(settings.summarize({ fields: ['unit_ids'] }), /Unit ids/);
});

test('a key that means different things in different records reads with its action', () => {
  assert.equal(settings.summarize({ fields: ['enabled'] }, 'direct_booking.settings_changed'), 'Changed: Booking page on');
  assert.equal(settings.summarize({ fields: ['enabled'] }, 'workspace.manual_payments_updated'), 'Changed: Manual payments on');
  assert.equal(settings.summarize({ fields: ['property_ids'] }, 'member.updated'), 'Changed: Properties they can access');
  assert.equal(settings.summarize({ fields: ['property_ids'] }, 'user.notify_prefs_updated'), 'Changed: Properties');
  assert.equal(settings.summarize({ fields: ['name'] }, 'workspace.updated'), 'Changed: Workspace name');
});

test('add-on edits read with the add-on labels, and unit_ids is Listings only on add-ons', () => {
  const addon = (fields) => settings.summarize({ fields }, 'addon.updated');
  assert.equal(addon(['name_tl']), 'Changed: Taglish name');
  assert.equal(addon(['name']), 'Changed: Name');
  assert.equal(addon(['description']), 'Changed: Description');
  assert.equal(addon(['unit_ids']), 'Changed: Listings');
  assert.equal(addon(['price', 'pricing', 'max_quantity']), 'Changed: Price, Pricing, Maximum quantity');
  assert.equal(addon(['on_booking_page', 'before_arrival', 'active']), 'Changed: Offer on the booking page, Offer before arrival, Active');
  assert.equal(settings.summarize({ fields: ['unit_ids'] }), 'Changed: Units');
});

test('a pricing rule switched on or off reads as Rule on, and its price change keeps its label', () => {
  assert.equal(settings.summarize({ fields: ['active', 'adjust_pct'] }, 'pricing_rule.updated'), 'Changed: Rule on, Price change');
});

test('notification types read as the labels the Settings toggles use', () => {
  assert.equal(
    settings.summarize({ fields: ['guest_message', 'payment', 'property_ids'] }, 'user.notify_prefs_updated'),
    'Changed: Guest messages, Online payments, Properties');
  assert.equal(
    settings.summarize({ fields: ['sync_problem', 'assignment', 'mention', 'cleaning', 'checkin_form', 'new_booking'] }, 'user.notify_prefs_updated'),
    'Changed: Calendar sync problems, Conversations assigned to you, Mentions in notes, Cleaning tasks, Guest check-in forms, New bookings');
});

test('rows logged before this change still render as they did', () => {
  // Old direct-booking rows stored the switch as a plain value, not as a list of changed fields.
  assert.match(settings.summarize({ enabled: true, slug: 'reyes-stays' }, 'direct_booking.settings_changed'), /^Turned on: Yes/);
  assert.equal(settings.summarize({ enabled: true }), 'Turned on: Yes');
  assert.equal(settings.summarize({ before: { min_nights: 1 }, after: { min_nights: 2 } }), 'Changed: Minimum nights');
});

test('each Save button on Settings names its card, and no two share a name', () => {
  const src = fs.readFileSync(SETTINGS, 'utf8');
  const names = [...src.matchAll(/'aria-label': '(Save [^']+)'/g)].map((m) => m[1]);
  assert.equal(names.length, 4, `four Save buttons carry a name: ${names.join(' | ')}`);
  assert.equal(new Set(names).size, names.length, 'no two Save buttons share an accessible name');
  // Every inline Save button (the ones that close their block with 'Save') is one of the named four.
  assert.equal(src.match(/\}, 'Save'\)/g).length, names.length);
});
