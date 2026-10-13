'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql } = require('./helpers');
const account = require('../src/lib/account');
const { createStaysWorkspace } = require('../src/lib/demo');

let srv; let orgId; let org2; let userId; let unitId; let guestId; let feedId; let bookingId;
test.before(async () => {
  srv = await startServer();
  orgId = await createStaysWorkspace({ email: 'm032@example.com', passwordHash: 'x' });
  org2 = await createStaysWorkspace({ email: 'm032b@example.com', passwordHash: 'x' });
  [{ user_id: userId }] = await sql(`SELECT user_id FROM users WHERE organization_id = $1 LIMIT 1`, [orgId]);
  [{ unit_id: unitId }] = await sql(`SELECT u.unit_id FROM units u JOIN properties p USING (property_id) WHERE p.organization_id = $1 LIMIT 1`, [orgId]);
  [{ guest_id: guestId }] = await sql(`INSERT INTO guests (organization_id, full_name) VALUES ($1, 'M032 Guest') RETURNING guest_id`, [orgId]);
  [{ feed_id: feedId }] = await sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url) VALUES ($1, $2, 'airbnb', 'https://example.com/m032.ics') RETURNING feed_id`, [orgId, unitId]);
});
test.after(async () => { await srv.close(); });

const cols = async (table) => (await sql(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table])).map((r) => r.column_name);
const bad = (q, p) => assert.rejects(sql(q, p), /check|violates|unique|duplicate/i);
const season = (rate, nights, pct, name = 'S') => sql(`INSERT INTO seasons (organization_id, unit_id, name, start_date, end_date, nightly_rate, min_nights, adjust_pct)
  VALUES ($1, $2, $3, current_date + 900, current_date + 910, $4, $5, $6) RETURNING season_id`, [orgId, unitId, name, rate, nights, pct]);
const rule = (kind, unit, days = 3, pct = -10, org = orgId) => sql(`INSERT INTO pricing_rules (organization_id, unit_id, kind, days, adjust_pct) VALUES ($1, $2, $3, $4, $5) RETURNING rule_id`, [org, unit, kind, days, pct]);

test('032: tables, columns and defaults', async () => {
  const want = {
    seasons: ['adjust_pct'],
    units: ['fortnight_discount', 'min_price', 'tags', 'room_type'],
    users: ['notify_prefs'],
    pricing_rules: ['rule_id', 'organization_id', 'unit_id', 'kind', 'days', 'adjust_pct', 'active', 'created_by', 'created_at', 'updated_at'],
    booking_groups: ['group_id', 'organization_id', 'name', 'guest_id', 'notes', 'created_by', 'created_at', 'cancelled_at'],
    bookings: ['group_id'],
    daily_closes: ['close_id', 'organization_id', 'close_date', 'property_ids', 'summary', 'note', 'closed_by', 'closed_at', 'updated_at'],
    ical_conflicts: ['conflict_id', 'organization_id', 'feed_id', 'unit_id', 'external_uid', 'check_in', 'check_out', 'first_seen_at', 'last_seen_at', 'alerted_at', 'resolved_at'],
    ical_feeds: ['alerted_at', 'problem_since'],
  };
  for (const [t, cs] of Object.entries(want)) { const have = await cols(t); for (const c of cs) assert.ok(have.includes(c), `${t}.${c}`); }
  const [u] = await sql(`SELECT fortnight_discount, min_price, tags, room_type FROM units WHERE unit_id = $1`, [unitId]);
  assert.deepEqual({ ...u }, { fortnight_discount: 0, min_price: null, tags: [], room_type: null });
  const [us] = await sql(`SELECT notify_prefs FROM users WHERE user_id = $1`, [userId]);
  assert.deepEqual(us.notify_prefs, {});
  const [r] = await rule('last_minute', null);
  const [rr] = await sql(`SELECT active, created_by, unit_id FROM pricing_rules WHERE rule_id = $1`, [r.rule_id]);
  assert.deepEqual({ ...rr }, { active: true, created_by: null, unit_id: null });
  await sql(`DELETE FROM pricing_rules WHERE rule_id = $1`, [r.rule_id]);
  const [dc] = await sql(`INSERT INTO daily_closes (organization_id, close_date) VALUES ($1, current_date + 900) RETURNING property_ids, summary`, [orgId]);
  assert.deepEqual({ ...dc }, { property_ids: [], summary: {} });
  const [f] = await sql(`SELECT alerted_at, problem_since FROM ical_feeds WHERE feed_id = $1`, [feedId]);
  assert.deepEqual({ ...f }, { alerted_at: null, problem_since: null });
});

test('032: seasons need one of rate, min nights or percentage, never rate and percentage', async () => {
  await season(null, null, 25, 'pct only');
  await season(null, 2, null, 'nights only');
  await season(5000, null, null, 'rate only');
  await season(5000, 2, null, 'rate and nights');
  await season(null, 2, -90, 'pct and nights');
  await season(null, null, 300, 'top of range');
  await bad(`INSERT INTO seasons (organization_id, unit_id, name, start_date, end_date) VALUES ($1, $2, 'none', current_date + 920, current_date + 925)`, [orgId, unitId]);
  await bad(`INSERT INTO seasons (organization_id, unit_id, name, start_date, end_date, nightly_rate, adjust_pct) VALUES ($1, $2, 'both', current_date + 920, current_date + 925, 5000, 10)`, [orgId, unitId]);
  await assert.rejects(season(null, null, -91, 'low'), /check/i);
  await assert.rejects(season(null, null, 301, 'high'), /check/i);
});

test('032: pricing rule kinds, ranges and uniqueness (including all-listings rules)', async () => {
  await assert.rejects(rule('holiday', null), /check/i);
  await assert.rejects(rule('far_out', null, 541), /check/i);
  await assert.rejects(rule('far_out', null, -1), /check/i);
  await assert.rejects(rule('far_out', null, 60, 301), /check/i);
  await assert.rejects(rule('far_out', null, 60, -91), /check/i);
  await rule('far_out', null, 540, 300);
  await rule('last_minute', null, 0, -90);
  await rule('gap_night', null, 7, -20);
  // all-listings rule: one per kind per workspace, even though unit_id is NULL
  await assert.rejects(rule('far_out', null, 100, 5), /unique|duplicate/i);
  // a listing rule is separate from the workspace rule, but unique per listing
  await rule('far_out', unitId, 100, 5);
  await assert.rejects(rule('far_out', unitId, 120, 6), /unique|duplicate/i);
  // another workspace can have its own all-listings rule of the same kind
  await rule('far_out', null, 60, 5, org2);
  // deleting the listing removes its rule via cascade
  const [{ unit_id: tmpUnit, property_id }] = await sql(`INSERT INTO units (property_id, unit_name, unit_type) SELECT property_id, 'M032 temp', unit_type FROM units WHERE unit_id = $1 RETURNING unit_id, property_id`, [unitId]);
  await rule('gap_night', tmpUnit, 2, -5);
  await sql(`DELETE FROM units WHERE unit_id = $1`, [tmpUnit]);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM pricing_rules WHERE unit_id = $1`, [tmpUnit]))[0].n, 0);
  assert.ok(property_id);
});

test('032: unit tags, room type, fortnight discount and minimum price', async () => {
  await sql(`UPDATE units SET tags = ARRAY['beachfront','pool'], room_type = 'Studio', fortnight_discount = 90, min_price = 0 WHERE unit_id = $1`, [unitId]);
  const [t] = await sql(`SELECT unit_id FROM units WHERE tags @> ARRAY['pool'] AND unit_id = $1`, [unitId]);
  assert.equal(t.unit_id, unitId);
  assert.ok((await sql(`SELECT indexname FROM pg_indexes WHERE tablename = 'units' AND indexdef ILIKE '%gin%tags%'`)).length === 1);
  await bad(`UPDATE units SET fortnight_discount = 91 WHERE unit_id = $1`, [unitId]);
  await bad(`UPDATE units SET fortnight_discount = -1 WHERE unit_id = $1`, [unitId]);
  await bad(`UPDATE units SET min_price = -1 WHERE unit_id = $1`, [unitId]);
  await bad(`UPDATE units SET room_type = repeat('x', 41) WHERE unit_id = $1`, [unitId]);
  await sql(`UPDATE units SET room_type = repeat('x', 40) WHERE unit_id = $1`, [unitId]);
});

test('032: booking groups, daily closes and calendar conflicts', async () => {
  const [{ group_id }] = await sql(`INSERT INTO booking_groups (organization_id, name, guest_id, notes) VALUES ($1, 'Santos reunion', $2, 'n') RETURNING group_id`, [orgId, guestId]);
  await bad(`INSERT INTO booking_groups (organization_id, name) VALUES ($1, '')`, [orgId]);
  await bad(`INSERT INTO booking_groups (organization_id, name) VALUES ($1, repeat('x', 121))`, [orgId]);
  await bad(`INSERT INTO booking_groups (organization_id, name, notes) VALUES ($1, 'ok', repeat('x', 1001))`, [orgId]);
  [{ booking_id: bookingId }] = await sql(`INSERT INTO bookings (organization_id, unit_id, kind, check_in, check_out, block_reason, confirmation_code, group_id)
    VALUES ($1, $2, 'block', current_date + 950, current_date + 952, 'm032', 'BLK' || substr(gen_random_uuid()::text, 1, 6), $3) RETURNING booking_id`, [orgId, unitId, group_id]);
  await bad(`UPDATE bookings SET group_id = gen_random_uuid() WHERE booking_id = $1`, [bookingId]);
  await bad(`DELETE FROM booking_groups WHERE group_id = $1`, [group_id]); // bookings still point at it

  await sql(`INSERT INTO daily_closes (organization_id, close_date, note, closed_by) VALUES ($1, current_date + 960, 'ok', $2)`, [orgId, userId]);
  await bad(`INSERT INTO daily_closes (organization_id, close_date) VALUES ($1, current_date + 960)`, [orgId]);
  await sql(`INSERT INTO daily_closes (organization_id, close_date) VALUES ($1, current_date + 961)`, [orgId]);
  await bad(`INSERT INTO daily_closes (organization_id, close_date, note) VALUES ($1, current_date + 962, repeat('x', 1001))`, [orgId]);

  const conflict = (uid, f = feedId) => sql(`INSERT INTO ical_conflicts (organization_id, feed_id, unit_id, external_uid, check_in, check_out) VALUES ($1, $2, $3, $4, current_date + 970, current_date + 972) RETURNING first_seen_at, resolved_at`, [orgId, f, unitId, uid]);
  const [c] = await conflict('uid-1');
  assert.ok(c.first_seen_at); assert.equal(c.resolved_at, null);
  await assert.rejects(conflict('uid-1'), /unique|duplicate/i);
  await conflict('uid-2');
  const [{ feed_id: feed2 }] = await sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url) VALUES ($1, $2, 'booking', 'https://example.com/m032b.ics') RETURNING feed_id`, [orgId, unitId]);
  await conflict('uid-1', feed2); // same uid on a different feed is fine
  await sql(`DELETE FROM ical_feeds WHERE feed_id = $1`, [feed2]);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM ical_conflicts WHERE feed_id = $1`, [feed2]))[0].n, 0, 'conflicts cascade with the feed');
});

test('032: export includes the new tables; purge removes everything', async () => {
  const exp = await account.exportOrganization(orgId);
  for (const t of ['pricing_rules', 'booking_groups', 'daily_closes', 'ical_conflicts']) {
    assert.ok(Array.isArray(exp[t]) && exp[t].length > 0, `export ${t}`);
    assert.ok(account.PURGED_TABLES.includes(t), `PURGED_TABLES ${t}`);
  }
  assert.ok(exp.bookings.some((b) => b.group_id));
  assert.ok(exp.units.some((u) => u.tags.includes('pool')));
  await account.purgeOrganization(orgId);
  for (const t of ['pricing_rules', 'booking_groups', 'daily_closes', 'ical_conflicts', 'ical_feeds', 'bookings', 'guests', 'seasons', 'users']) {
    assert.equal((await sql(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id = $1`, [orgId]))[0].n, 0, t);
  }
  await account.purgeOrganization(org2);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM pricing_rules WHERE organization_id = $1`, [org2]))[0].n, 0);
});
