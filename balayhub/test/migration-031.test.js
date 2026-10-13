'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, sql } = require('./helpers');
const account = require('../src/lib/account');
const { createStaysWorkspace } = require('../src/lib/demo');

let srv; let orgId; let org2; let userId; let unitId; let propertyId; let bookingId;
test.before(async () => {
  srv = await startServer();
  orgId = await createStaysWorkspace({ email: 'm031@example.com', passwordHash: 'x' });
  org2 = await createStaysWorkspace({ email: 'm031b@example.com', passwordHash: 'x' });
  [{ user_id: userId }] = await sql(`SELECT user_id FROM users WHERE organization_id = $1 LIMIT 1`, [orgId]);
  [{ unit_id: unitId, property_id: propertyId }] = await sql(`SELECT u.unit_id, u.property_id FROM units u JOIN properties p USING (property_id) WHERE p.organization_id = $1 LIMIT 1`, [orgId]);
  [{ booking_id: bookingId }] = await sql(`INSERT INTO bookings (organization_id, unit_id, kind, check_in, check_out, block_reason, confirmation_code)
    VALUES ($1, $2, 'block', current_date + 800, current_date + 802, 'm031', 'BLK' || substr(gen_random_uuid()::text, 1, 6)) RETURNING booking_id`, [orgId, unitId]);
});
test.after(async () => { await srv.close(); });

const cols = async (table) => (await sql(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table])).map((r) => r.column_name);
const bad = (q, p) => assert.rejects(sql(q, p), /check|violates|unique/i);
const addon = (over = {}) => {
  const v = { name: 'Breakfast', pricing: 'per_guest', price: 250, max_quantity: 2, ...over };
  return sql(`INSERT INTO listing_addons (organization_id, name, price, pricing, max_quantity) VALUES ($1, $2, $3, $4, $5) RETURNING addon_id`, [orgId, v.name, v.price, v.pricing, v.max_quantity]);
};
const quote = (over = {}) => {
  const v = { status: 'open', pay_type: 'full', num_guests: 2, total: 5000, co: 'current_date + 810', ...over };
  return sql(`INSERT INTO booking_quotes (organization_id, unit_id, public_token, check_in, check_out, num_guests, accommodation_total, total_amount, pay_type, expires_at, status)
    VALUES ($1, $2, 'qt-' || gen_random_uuid(), current_date + 808, ${v.co}, $3, 4000, $4, $5, now() + interval '2 days', $6) RETURNING quote_id`,
  [orgId, unitId, v.num_guests, v.total, v.pay_type, v.status]);
};

test('031: tables, columns and defaults', async () => {
  const want = {
    unit_guides: ['unit_id', 'organization_id', 'arrival', 'arrival_tl', 'parking', 'parking_tl', 'building_notes', 'building_notes_tl', 'local_tips', 'local_tips_tl', 'emergency_contacts', 'emergency_contacts_tl', 'door_code_enc', 'updated_at', 'updated_by'],
    listing_addons: ['addon_id', 'organization_id', 'name', 'name_tl', 'description', 'price', 'pricing', 'max_quantity', 'unit_ids', 'on_booking_page', 'before_arrival', 'active', 'sort_order', 'created_at', 'updated_at'],
    booking_quotes: ['quote_id', 'organization_id', 'unit_id', 'public_token', 'check_in', 'check_out', 'num_guests', 'guest_name', 'guest_email', 'guest_phone', 'accommodation_total', 'cleaning_fee', 'addons', 'addons_total', 'discount_amount', 'total_amount', 'pay_type', 'note', 'expires_at', 'status', 'booking_id', 'created_by', 'created_at', 'cancelled_at'],
    bookings: ['guide_token', 'rules_accepted_at', 'rules_text', 'source'],
    direct_checkouts: ['rules_accepted_at', 'rules_text', 'source', 'addons', 'addons_total', 'quote_id', 'followup_sent_at'],
    booking_charges: ['addon_id'],
    organizations: ['review_links', 'returning_guest_pct', 'abandoned_followup'],
    discount_codes: ['issued_to_booking_id'],
    units: ['public_slug'],
  };
  for (const [t, cs] of Object.entries(want)) { const have = await cols(t); for (const c of cs) assert.ok(have.includes(c), `${t}.${c}`); }
  const [o] = await sql(`SELECT review_links, returning_guest_pct, abandoned_followup FROM organizations WHERE organization_id = $1`, [orgId]);
  assert.deepEqual(o.review_links, []);
  assert.equal(o.returning_guest_pct, null);
  assert.equal(o.abandoned_followup, false);
  const [a] = await sql(`INSERT INTO listing_addons (organization_id, name, price, pricing) VALUES ($1, 'Defaults', 100, 'per_stay') RETURNING max_quantity, unit_ids, on_booking_page, before_arrival, active, sort_order`, [orgId]);
  assert.deepEqual({ ...a }, { max_quantity: 1, unit_ids: [], on_booking_page: true, before_arrival: true, active: true, sort_order: 0 });
  const [q] = await sql(`SELECT status, addons, addons_total, discount_amount, cleaning_fee, sent_count, last_sent_at FROM booking_quotes WHERE quote_id = $1`, [(await quote())[0].quote_id]);
  assert.deepEqual({ ...q }, { status: 'open', addons: [], addons_total: '0.00', discount_amount: '0.00', cleaning_fee: '0.00', sent_count: 0, last_sent_at: null });
  const [b] = await sql(`SELECT guide_token, rules_accepted_at, rules_text, source FROM bookings WHERE booking_id = $1`, [bookingId]);
  assert.deepEqual({ ...b }, { guide_token: null, rules_accepted_at: null, rules_text: null, source: null });
  const [g] = await sql(`INSERT INTO unit_guides (unit_id, organization_id, door_code_enc) VALUES ($1, $2, 'enc') RETURNING arrival, door_code_enc`, [unitId, orgId]);
  assert.equal(g.arrival, null);
  await bad(`INSERT INTO unit_guides (unit_id, organization_id, arrival) VALUES ($1, $2, repeat('x', 2001))`, [unitId, orgId]);
});

test('031: booking and checkout sources are limited to the allow-list', async () => {
  for (const s of ['facebook', 'instagram', 'messenger', 'viber', 'tiktok', 'google', 'whatsapp', 'email', 'referral', 'quote', 'other', null]) {
    await sql(`UPDATE bookings SET source = $2 WHERE booking_id = $1`, [bookingId, s]);
  }
  await bad(`UPDATE bookings SET source = 'myspace' WHERE booking_id = $1`, [bookingId]);
  await bad(`UPDATE bookings SET rules_text = repeat('x', 4001) WHERE booking_id = $1`, [bookingId]);
  await bad(`INSERT INTO direct_checkouts (public_token, organization_id, unit_id, check_in, check_out, num_guests, guest_name, guest_email, guest_phone, pay_type, accommodation_total, cleaning_fee, total_amount, amount_due_now, hold_until, consent_at, source)
    VALUES ('dc-bad', $1, $2, current_date + 820, current_date + 822, 2, 'G', 'g@example.com', '0917', 'full', 100, 0, 100, 100, now(), now(), 'myspace')`, [orgId, unitId]);
  const [dc] = await sql(`INSERT INTO direct_checkouts (public_token, organization_id, unit_id, check_in, check_out, num_guests, guest_name, guest_email, guest_phone, pay_type, accommodation_total, cleaning_fee, total_amount, amount_due_now, hold_until, consent_at, source)
    VALUES ('dc-ok', $1, $2, current_date + 820, current_date + 822, 2, 'G', 'g@example.com', '0917', 'full', 100, 0, 100, 100, now(), now(), 'facebook') RETURNING addons, addons_total, followup_sent_at, quote_id`, [orgId, unitId]);
  assert.deepEqual({ ...dc }, { addons: [], addons_total: '0.00', followup_sent_at: null, quote_id: null });
  await bad(`UPDATE direct_checkouts SET addons_total = -1 WHERE public_token = 'dc-ok'`);
  await bad(`UPDATE direct_checkouts SET accommodation_total = -1 WHERE public_token = 'dc-ok'`);
  await bad(`UPDATE direct_checkouts SET quote_id = gen_random_uuid() WHERE public_token = 'dc-ok'`);
});

test('031: add-on pricing rules and the addon charge category', async () => {
  for (const p of ['per_stay', 'per_night', 'per_guest', 'per_guest_night']) await addon({ pricing: p });
  await assert.rejects(addon({ pricing: 'per_hour' }), /check/i);
  await assert.rejects(addon({ price: 0 }), /check/i);
  await assert.rejects(addon({ price: -5 }), /check/i);
  await assert.rejects(addon({ max_quantity: 0 }), /check/i);
  await assert.rejects(addon({ max_quantity: 21 }), /check/i);
  await assert.rejects(addon({ name: '   ' }), /check/i);
  await assert.rejects(addon({ name: 'x'.repeat(81) }), /check/i);
  const [{ addon_id }] = await addon();
  const ins = (category, aid = null) => sql(`INSERT INTO booking_charges (organization_id, booking_id, category, description, quantity, unit_price, addon_id) VALUES ($1, $2, $3, 'Breakfast', 2, 250, $4) RETURNING charge_id, amount`, [orgId, bookingId, category, aid]);
  const [c] = await ins('addon', addon_id);
  assert.equal(c.amount, '500.00');
  await ins('other');
  await assert.rejects(ins('souvenir'), /check/i);
  await assert.rejects(ins('addon', '00000000-0000-4000-8000-000000000000'), /foreign key|violates/i);
});

test('031: quote status, dates, amounts and token rules', async () => {
  for (const status of ['open', 'paid', 'expired', 'cancelled']) await quote({ status });
  await bad(`UPDATE booking_quotes SET sent_count = -1`);
  await assert.rejects(quote({ status: 'pending' }), /check/i);
  await assert.rejects(quote({ pay_type: 'part' }), /check/i);
  await assert.rejects(quote({ num_guests: 0 }), /check/i);
  await assert.rejects(quote({ num_guests: 51 }), /check/i);
  await assert.rejects(quote({ total: 0 }), /check/i);
  await assert.rejects(quote({ co: 'current_date + 808' }), /check/i);
  await assert.rejects(quote({ co: 'current_date + 800' }), /check/i);
  await bad(`INSERT INTO booking_quotes (organization_id, unit_id, public_token, check_in, check_out, num_guests, accommodation_total, total_amount, pay_type, expires_at, discount_amount)
    VALUES ($1, $2, 'qt-neg', current_date + 830, current_date + 832, 2, 100, 100, 'full', now(), -1)`, [orgId, unitId]);
  const mk = (t) => sql(`INSERT INTO booking_quotes (organization_id, unit_id, public_token, check_in, check_out, num_guests, accommodation_total, total_amount, pay_type, expires_at)
    VALUES ($1, $2, $3, current_date + 830, current_date + 832, 2, 100, 100, 'full', now())`, [orgId, unitId, t]);
  await mk('same-token');
  await assert.rejects(mk('same-token'), /unique|duplicate/i);
});

test('031: returning pct, guide token and issued code uniqueness', async () => {
  await sql(`UPDATE organizations SET returning_guest_pct = 1 WHERE organization_id = $1`, [orgId]);
  await sql(`UPDATE organizations SET returning_guest_pct = 50 WHERE organization_id = $1`, [orgId]);
  await sql(`UPDATE organizations SET returning_guest_pct = NULL WHERE organization_id = $1`, [orgId]);
  await bad(`UPDATE organizations SET returning_guest_pct = 0 WHERE organization_id = $1`, [orgId]);
  await bad(`UPDATE organizations SET returning_guest_pct = 51 WHERE organization_id = $1`, [orgId]);
  await sql(`UPDATE bookings SET guide_token = 'gt-one' WHERE booking_id = $1`, [bookingId]);
  const [{ booking_id: b2 }] = await sql(`INSERT INTO bookings (organization_id, unit_id, kind, check_in, check_out, block_reason, confirmation_code)
    VALUES ($1, $2, 'block', current_date + 840, current_date + 842, 'm031b', 'BLK' || substr(gen_random_uuid()::text, 1, 6)) RETURNING booking_id`, [orgId, unitId]);
  await bad(`UPDATE bookings SET guide_token = 'gt-one' WHERE booking_id = $1`, [b2]);
  const code = (c, bid) => sql(`INSERT INTO discount_codes (organization_id, code, percent_off, max_uses, returning_only, issued_to_booking_id) VALUES ($1, $2, 10, 1, true, $3)`, [orgId, c, bid]);
  await code('WELCOME-AAAAAA', bookingId);
  await assert.rejects(code('WELCOME-BBBBBB', bookingId), /unique|duplicate/i);
  await code('WELCOME-CCCCCC', null);
  await code('WELCOME-DDDDDD', null);
});

test('031: backfilled listing slugs are valid and unique within each workspace', async () => {
  // Active names are unique per property, so exact repeats are archived units (they still get slugs).
  const mkUnit = (prop, name, status = 'active') => sql(`INSERT INTO units (property_id, unit_name, unit_type, status) VALUES ($1, $2, 'studio', $3)`, [prop, name, status]);
  const [{ property_id: prop2 }] = await sql(`SELECT property_id FROM properties WHERE organization_id = $1 LIMIT 1`, [org2]);
  for (const n of ['Casa Mia', 'CASA  MIA!', 'Casa Mia 2', '!!!', 'x'.repeat(60)]) await mkUnit(propertyId, n);
  for (const n of ['Casa Mia', '???', 'x'.repeat(60)]) await mkUnit(propertyId, n, 'archived');
  await mkUnit(prop2, 'Casa Mia'); // same name in another workspace keeps the plain slug
  await sql(`UPDATE units SET public_slug = NULL`);
  const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '031_phase4_guests.sql'), 'utf8');
  await sql(migration.slice(migration.indexOf('DO $$')));
  const rows = await sql(`SELECT u.unit_name, u.public_slug, p.organization_id FROM units u JOIN properties p USING (property_id)`);
  assert.ok(rows.length >= 10);
  const seen = new Set();
  for (const r of rows) {
    assert.match(r.public_slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, r.unit_name);
    assert.ok(r.public_slug.length >= 1 && r.public_slug.length <= 60, r.public_slug);
    const key = `${r.organization_id}|${r.public_slug}`;
    assert.ok(!seen.has(key), `duplicate ${key}`);
    seen.add(key);
  }
  const mine = rows.filter((r) => r.organization_id === orgId).map((r) => r.public_slug);
  for (const s of ['casa-mia', 'casa-mia-2', 'casa-mia-3', 'casa-mia-2-2', 'listing', 'listing-2']) assert.ok(mine.includes(s), s);
  assert.ok(rows.some((r) => r.organization_id === org2 && r.public_slug === 'casa-mia'));
  assert.ok(rows.every((r) => r.public_slug !== null));
});

test('031: a purchase key is unique per booking; charges without one are not limited', async () => {
  const snack = (key) => sql(`INSERT INTO booking_charges (organization_id, booking_id, category, description, quantity, unit_price, request_key)
    VALUES ($1, $2, 'other', 'Snack', 1, 100, $3) RETURNING charge_id`, [orgId, bookingId, key]);
  await snack('tap-one:addon-a');
  await assert.rejects(snack('tap-one:addon-a'), /unique|duplicate/i);
  await snack(null);
  await snack(null);
  await snack('tap-one:addon-b');
});

test('031: export hides door_code_enc and public_token; purge removes everything', async () => {
  const [{ quote_id }] = await quote();
  await sql(`UPDATE direct_checkouts SET quote_id = $1 WHERE public_token = 'dc-ok'`, [quote_id]);
  await sql(`UPDATE booking_quotes SET booking_id = $2 WHERE quote_id = $1`, [quote_id, bookingId]);
  const exp = await account.exportOrganization(orgId);
  for (const t of ['unit_guides', 'listing_addons', 'booking_quotes']) {
    assert.ok(Array.isArray(exp[t]) && exp[t].length > 0, `export ${t}`);
    assert.ok(account.PURGED_TABLES.includes(t), `PURGED_TABLES ${t}`);
  }
  for (const r of exp.unit_guides) assert.ok(!('door_code_enc' in r), 'door_code_enc leaked');
  for (const r of exp.booking_quotes) assert.ok(!('public_token' in r), 'quote public_token leaked');
  assert.ok(!JSON.stringify(exp).includes('"door_code_enc"'));
  assert.ok(exp.unit_guides.some((r) => r.unit_id === unitId));

  await account.purgeOrganization(orgId);
  for (const t of ['unit_guides', 'listing_addons', 'booking_quotes', 'booking_charges', 'direct_checkouts', 'discount_codes', 'bookings', 'users']) {
    assert.equal((await sql(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id = $1`, [orgId]))[0].n, 0, t);
  }
  assert.equal((await sql(`SELECT count(*)::int AS n FROM organizations WHERE organization_id = $1`, [orgId]))[0].n, 0);
  await account.purgeOrganization(org2);
});
