'use strict';

// Settings view (QA round 4, lane C12). The invite form checks the email and the property together, email
// first as the server does, and shows both problems at once (#14). Audit details name pricing and pricing rules
// in plain words, with the price change signed, and no detail text carries a raw underscore word (#29). The
// Default language label is tied to its select, so the select's spoken name is the label's words (#30).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '../public/js/views/settings.js');
let settings; let dir;

test.before(async () => {
  // settings.js is a browser module. Load it from a temp copy, with its browser-only imports stubbed.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r4-c12-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = {}; export async function refreshUser() {}\n');
  fs.writeFileSync(path.join(dir, 'notifications.js'), 'export async function notificationsCard() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'themeswitch.js'), 'export function themeSwitch() { return null; }\n');
  fs.copyFileSync(SRC, path.join(dir, 'views', 'settings.js'));
  globalThis.Element = class { };
  settings = await import(pathToFileURL(path.join(dir, 'views', 'settings.js')).href);
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// ---------------------------------------------------------------- invite order (#14)

test('an invite with a bad email and no property names both problems, email first', () => {
  const fields = settings.inviteProblems({ email: 'abc', role: 'manager', property_ids: [] });
  assert.deepEqual(Object.keys(fields), ['email', 'property_ids']);
  assert.equal(fields.email, 'Enter a valid email address.');
  assert.equal(fields.property_ids, 'Pick at least one property for a manager.');
});

test('a cleaner with a bad email and no property gets both messages too', () => {
  const fields = settings.inviteProblems({ email: 'maria@', role: 'cleaner' });
  assert.deepEqual(Object.keys(fields), ['email', 'property_ids']);
  assert.equal(fields.property_ids, 'Pick at least one property for a cleaner.');
});

test('a good email with no property names only the property', () => {
  assert.deepEqual(settings.inviteProblems({ email: 'ana@example.com', role: 'manager', property_ids: [] }),
    { property_ids: 'Pick at least one property for a manager.' });
});

test('a bad email to staff, who need no property, names only the email', () => {
  assert.deepEqual(settings.inviteProblems({ email: 'no-at-sign.example.com', role: 'staff' }),
    { email: 'Enter a valid email address.' });
});

test('a valid invite with a property passes', () => {
  assert.deepEqual(settings.inviteProblems({ email: 'ana@example.com', role: 'manager', property_ids: ['6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'] }), {});
});

// ---------------------------------------------------------------- audit detail words (#29)

test('pricing reads in plain words, as it does on the add-on form', () => {
  assert.equal(settings.summarize({ pricing: 'per_stay' }), 'Pricing: Per stay');
  assert.equal(settings.summarize({ pricing: 'per_night' }), 'Pricing: Per night');
  assert.equal(settings.summarize({ pricing: 'per_guest_night' }), 'Pricing: Per guest, per night');
});

test('a pricing rule reads its kind in plain words, and its price change as a signed percentage', () => {
  assert.equal(settings.summarize({ kind: 'gap_night', days: 2, adjust_pct: -10, listing: 'All listings' }),
    'Type: Gap night · Days: 2 · Price change: -10% · Listing: All listings');
  assert.equal(settings.summarize({ kind: 'last_minute', days: 3, adjust_pct: 15 }), 'Type: Last minute · Days: 3 · Price change: +15%');
  assert.equal(settings.summarize({ kind: 'far_out' }), 'Type: Far out');
  assert.equal(settings.summarize({ type: 'gap_night', adjust_pct: -10 }), 'Type: Gap night · Price change: -10%');
});

test('no detail text carries a raw underscore word', () => {
  const rows = [
    { pricing: 'per_guest_night', name: 'Late checkout', price: '500.00' },
    { kind: 'gap_night', days: 1, adjust_pct: -10, listing: 'Unit 3B' },
    { kind: 'last_minute', days: 3, adjust_pct: 20 },
    { max_quantity: 2, pricing: 'per_night', unit_ids: ['6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'] },
  ];
  for (const d of rows) {
    const text = settings.summarize(d);
    assert.doesNotMatch(text, /_/, text);
  }
});

// ---------------------------------------------------------------- language label (#30)

test('the Default language label is tied to its select, and the select has no other spoken name', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  const label = src.match(/h\('label', \{ for: '([^']+)' \}, 'Default language'\)/);
  assert.ok(label, 'the Default language label has a for attribute');
  const select = src.match(/const lang = h\('select', \{([^}]*)\}/);
  assert.ok(select, 'the guest language select is found');
  assert.match(select[1], new RegExp(`id: '${label[1]}'`), 'the select carries the id the label points to');
  assert.doesNotMatch(select[1], /aria-label/, 'the select has no aria-label that would replace the visible label');
});
