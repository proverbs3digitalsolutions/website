'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

// QA round 10, lane C13. #28: a past day's close lists only the damage reports that were still open
// on that day. #30: the recurring-job next-due message reads as dates, not ISO text.
// Runs on its own database (TEST_DATABASE_URL) because the test resets the schema.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');

const addDays = (s, n) => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);
const day = (date) => `/api/daily-close?date=${date}`;
const section = (body, key) => body.sections.find((s) => s.key === key);

let srv; let owner; let orgId; let unit; let today; let yesterday;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'c13-owner@example.com', 'Lane C13 Stays');
  orgId = (await sql('SELECT organization_id FROM organizations WHERE name = $1', ['Lane C13 Stays']))[0].organization_id;
  today = manilaToday();
  yesterday = addDays(today, -1);
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'house', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1A', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  // Opened two days ago and still open: on yesterday's list. Opened today: not on yesterday's list.
  await sql(`INSERT INTO damage_reports (organization_id, unit_id, description, status, created_at)
             VALUES ($1, $2, 'Opened two days ago', 'open', now() - interval '2 days'),
                    ($1, $2, 'Opened today', 'open', now())`, [orgId, unit.unit_id]);
});
test.after(async () => { await srv.close(); });

test('a past day lists only the damage reports open on that day', async () => {
  const r = await owner.get(day(yesterday));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const damage = section(r.data, 'damage_open');
  assert.equal(damage.title, 'Damage reports still open');
  assert.deepEqual(damage.items.map((i) => i.detail), ['Opened two days ago']);
  assert.equal(damage.count, 1);
});

test("today's checklist still lists every open damage report", async () => {
  const r = await owner.get(day(today));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const damage = section(r.data, 'damage_open');
  assert.equal(damage.title, 'Open damage reports');
  assert.deepEqual(damage.items.map((i) => i.detail).sort(), ['Opened today', 'Opened two days ago']);
});

test('a close for a past day stores the same damage count it shows', async () => {
  const saved = await owner.post('/api/daily-close', { date: yesterday, note: 'Late close' });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.closed.summary.counts.damage_open, 1);
});

test('the recurring job next-due message reads as dates, not ISO text', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/maintenance.js'), 'utf8');
  assert.equal(src.includes('Next due must be between'), false);
  assert.ok(src.includes('`Pick a date between ${fmtDate(earliest)} and ${fmtDate(latest)}.`'));
});
