'use strict';

// QA round 8, lane C08 (pricing): a rule saved with nothing changed writes no UPDATE and no activity row, and a row
// names the changed fields only, never values (N30, D-84). Each rule and season button, and each listing link, names
// its row so a screen reader does not hear "Edit" or "Remove" over and over (N1, D-81).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ownerAccount, sql } = require('./helpers');

const VIEW = fs.readFileSync(path.join(__dirname, '../public/js/views/pricing.js'), 'utf8');
const lineWith = (text) => VIEW.split('\n').find((l) => l.includes(text));

test('N30: a rule saved with nothing changed writes no UPDATE and no activity row; a change names only its fields', async () => {
  const srv = await startServer();
  try {
    const owner = await ownerAccount(srv.base, 'c08-owner@example.com', 'C08 Stays');
    const orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'C08 Stays'`))[0].organization_id;
    const prop = (await owner.post('/api/properties', { property_name: 'C08 Tower', property_type: 'condominium', address: 'A St', city: 'Taguig', province: 'Metro Manila' })).data.property;
    const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Tower 1', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
    const created = await owner.post('/api/pricing/rules', { kind: 'last_minute', days: 3, adjust_pct: -15, unit_id: unit.unit_id });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const ruleId = created.data.rule_id;

    const stored = async () => (await sql('SELECT days, adjust_pct, active, updated_at::text AS updated_at FROM pricing_rules WHERE rule_id = $1', [ruleId]))[0];
    const updatedRows = () => sql(`SELECT details FROM audit_logs WHERE organization_id = $1 AND action = 'pricing_rule.updated' AND record_id = $2 ORDER BY created_at`, [orgId, ruleId]);
    const before = await stored();

    // Saves that change nothing: the same values, one value sent alone, and an empty save.
    const same = await owner.patch(`/api/pricing/rules/${ruleId}`, { days: 3, adjust_pct: -15, active: true });
    assert.equal(same.status, 200, JSON.stringify(same.data));
    assert.deepEqual(Object.keys(same.data.rule).sort(), ['active', 'adjust_pct', 'days', 'kind', 'rule_id', 'unit_id']);
    assert.deepEqual([same.data.rule.days, same.data.rule.adjust_pct, same.data.rule.active], [3, -15, true]);
    assert.equal((await owner.patch(`/api/pricing/rules/${ruleId}`, { days: 3 })).status, 200);
    assert.equal((await owner.patch(`/api/pricing/rules/${ruleId}`, { adjust_pct: -15 })).status, 200);
    assert.equal((await owner.patch(`/api/pricing/rules/${ruleId}`, {})).status, 200);
    assert.deepEqual(await updatedRows(), [], 'no activity row for a save that changed nothing');
    assert.deepEqual(await stored(), before, 'no UPDATE ran, so the row is untouched');

    // A real change writes one row that names the changed field and carries no values.
    assert.equal((await owner.patch(`/api/pricing/rules/${ruleId}`, { days: 4, adjust_pct: -15 })).status, 200);
    assert.deepEqual((await updatedRows()).map((r) => r.details), [{ kind: 'last_minute', fields: ['days'] }]);
    // Switching it off, with days and percentage as they are, names only "active".
    assert.equal((await owner.patch(`/api/pricing/rules/${ruleId}`, { active: false })).status, 200);
    assert.deepEqual((await updatedRows()).map((r) => r.details), [
      { kind: 'last_minute', fields: ['days'] },
      { kind: 'last_minute', fields: ['active'] },
    ]);
    // Saving the same again writes nothing new.
    assert.equal((await owner.patch(`/api/pricing/rules/${ruleId}`, { days: 4, active: false })).status, 200);
    assert.equal((await updatedRows()).length, 2);
    // A refused value is still refused, with no row.
    assert.equal((await owner.patch(`/api/pricing/rules/${ruleId}`, { days: 40 })).status, 400);
    assert.equal((await updatedRows()).length, 2);
  } finally { await srv.close(); }
});

test('N1 and D-81: each rule and season button, and each listing link, names its row', () => {
  const editRule = lineWith('onclick: () => editRule(r)');
  assert.ok(editRule && editRule.includes("'aria-label': `Edit rule: ${ruleSummary(r)}, ${r.unit_name || 'All listings'}`"), 'the rule Edit names the rule and its listing');
  const removeRule = lineWith('onclick: () => removeRule(r)');
  assert.ok(removeRule && removeRule.includes("'aria-label': `Remove rule: ${ruleSummary(r)}, ${r.unit_name || 'All listings'}`"), 'the rule Remove names the rule and its listing');
  const removeSeason = lineWith('onclick: () => remove(s)');
  assert.ok(removeSeason && removeSeason.includes("'aria-label': `Remove season: ${s.name}, ${s.unit_name || 'All listings'}`"), 'the season Remove names the season and its listing');
  const listingLink = lineWith('#/listings?focus=${l.unit_id}');
  assert.ok(listingLink && listingLink.includes("'aria-label': `${l.unit_name}, ${l.property_name}`"), 'the listing link names the listing and its property');
});
