'use strict';

// QA round 7, lane C10 (pricing): the rule checks run before the browser asks "Change the existing rule?" (#21);
// a set price below a listing's lowest price is counted the way a percentage cut is (#22); a night a booking-window
// rule adjusted is labelled "Adjusted" (N11). The browser module is loaded with stubs, as in qa-r3-pricing-view.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, ownerAccount, sql, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);

test('#22: a set price below the lowest price is counted in the preview and the apply, as a percentage cut is', async () => {
  const srv = await startServer();
  try {
    const owner = await ownerAccount(srv.base, 'c10-owner@example.com', 'C10 Stays');
    const prop = (await owner.post('/api/properties', { property_name: 'C10 Tower', property_type: 'condominium', address: 'A St', city: 'Taguig', province: 'Metro Manila' })).data.property;
    const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'U1', unit_type: 'studio', nightly_rate: '2500' })).data.unit;
    assert.equal((await owner.patch(`/api/units/${unit.unit_id}`, { min_price: '2000' })).status, 200);

    const base = { unit_ids: [unit.unit_id], from: d(10), to: d(12), action: 'set', dry_run: true };
    const below = await owner.post('/api/bulk/prices', { ...base, price: '1500' });
    assert.equal(below.status, 200, JSON.stringify(below.data));
    assert.equal(below.data.count, 3);
    assert.equal(below.data.below_lowest, 3);

    const atLowest = await owner.post('/api/bulk/prices', { ...base, price: '2500' });
    assert.equal(atLowest.status, 200, JSON.stringify(atLowest.data));
    assert.equal(atLowest.data.below_lowest, 0);

    // The apply counts the same nights as the preview and writes them.
    const applied = await owner.post('/api/bulk/prices', { ...base, price: '1500', dry_run: false });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    assert.equal(applied.data.below_lowest, 3);
    const rows = await sql('SELECT price FROM nightly_rates WHERE unit_id = $1 ORDER BY rate_date', [unit.unit_id]);
    assert.deepEqual(rows.map((r) => r.price), ['1500.00', '1500.00', '1500.00']);

    // The percentage cut still counts the same way.
    const cut = await owner.post('/api/bulk/prices', { unit_ids: [unit.unit_id], from: d(20), to: d(21), action: 'percent', percent: -50, dry_run: true });
    assert.equal(cut.data.below_lowest, 2);
  } finally { await srv.close(); }
});

// ---------------------------------------------------------------- the browser module, loaded with stubs
let view; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-pricing-c10-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { role: \'owner\' } };\n');
  // The real addDays, copied from reservations.js so the test cannot drift from it.
  const reservations = fs.readFileSync(path.join(__dirname, '../public/js/views/reservations.js'), 'utf8');
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), reservations.match(/export function addDays[\s\S]*?\n}\n/)[0]);
  fs.copyFileSync(path.join(__dirname, '../public/js/views/pricing.js'), path.join(dir, 'views', 'pricing.js'));
  fs.copyFileSync(path.join(__dirname, '../public/js/rates.js'), path.join(dir, 'rates.js')); // pricing.js imports the rate check (QA round 12, C13)
  globalThis.Element = class { };
  view = await import(pathToFileURL(path.join(dir, 'views', 'pricing.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('#21: the rule form checks a value the way the server does, field by field, and passes only values the server saves', () => {
  assert.deepEqual(view.ruleProblems('last_minute', 3, -15), {});
  assert.deepEqual(view.ruleProblems('last_minute', 0, 300), {});
  assert.deepEqual(view.ruleProblems('far_out', 31, -90), {});
  assert.deepEqual(view.ruleProblems('gap_night', 7, 1), {});
  assert.deepEqual(view.ruleProblems('last_minute', 31, -15), { days: 'For this kind of rule, use 0 to 30 days.' });
  assert.deepEqual(view.ruleProblems('far_out', 30, 10), { days: 'For this kind of rule, use 31 to 540 days.' });
  assert.deepEqual(view.ruleProblems('far_out', 541, 10), { days: 'Days must be at most 540.' });
  assert.deepEqual(view.ruleProblems('gap_night', 0, 10), { days: 'For this kind of rule, use 1 to 7 days.' });
  assert.deepEqual(view.ruleProblems('gap_night', 1.5, 10), { days: 'Days must be a whole number.' });
  assert.deepEqual(view.ruleProblems('last_minute', 3, -95), { adjust_pct: 'Percentage change must be at least -90.' });
  assert.deepEqual(view.ruleProblems('last_minute', 3, 301), { adjust_pct: 'Percentage change must be at most 300.' });
  assert.deepEqual(view.ruleProblems('last_minute', 3, 0), { adjust_pct: 'Enter a percentage other than 0.' });
  assert.deepEqual(view.ruleProblems('last_minute', 3, 2.5), { adjust_pct: 'Percentage change must be a whole number.' });
});

test('#21: the rule form runs those checks before it asks "Change the existing rule?", and keeps the form open on a refusal', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/pricing.js'), 'utf8');
  const check = src.indexOf('const problems = ruleProblems(');
  const existing = src.indexOf('const dup = rules.find(');
  assert.ok(check > 0, 'the form calls ruleProblems on submit');
  assert.ok(check < existing, 'the checks come before the duplicate-rule question');
  assert.match(src, /if \(Object\.keys\(problems\)\.length\) \{ showErrors\(form, problems\); return false; \}/);
});

test('N11: a night a booking-window rule adjusted reads "Adjusted", and its name says it was adjusted by rules', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/pricing.js'), 'utf8');
  assert.ok(src.includes("const adjusted = (n.applied || []).length > 0;"), 'the cell reads whether rules changed the night');
  assert.ok(src.includes("n.booked ? 'Booked' : adjusted ? 'Adjusted' : KIND_LABEL[kind]"), 'the cell label says Adjusted for a rule-changed night');
  assert.ok(src.includes("${adjusted ? `${KIND_LABEL[kind]}, adjusted by rules` : KIND_LABEL[kind]}"), 'the accessible name says the kind and adjusted by rules');
  assert.ok(!src.includes(', rules applied'), 'the old name is gone');
});
