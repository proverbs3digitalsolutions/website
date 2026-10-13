'use strict';

// Bulk changes (D-67) and listing tags and room types (D-68): prices, blocks, the tag and room-type
// lists, and what a manager may reach.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const PASSWORD = 'longenough1';
const today = manilaToday();
const d = (n) => ical.addDays(today, n);

let srv; let owner; let manager; let staff; let orgId;
let prop; let propB; let a1; let a2; let a3; let long1; let b1;

const invite = (email, role, propertyIds) => owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });

// Accepts an invitation through the sign-up form, which also signs the new account in.
async function accept(email, role, propertyIds, fullName) {
  const inv = await invite(email, role, propertyIds);
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', {
    full_name: fullName, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'bulk-owner@example.com', 'Bulk Stays');
  orgId = (await sql('SELECT organization_id FROM users WHERE email = $1', ['bulk-owner@example.com']))[0].organization_id;
  prop = (await owner.post('/api/properties', { property_name: 'Azure Residences', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  propB = (await owner.post('/api/properties', { property_name: 'Grass Tower', property_type: 'condominium', address: 'Project 8', city: 'Quezon City', province: 'Metro Manila' })).data.property;
  const make = async (p, body) => {
    const r = await owner.post(`/api/properties/${p.property_id}/units`, body);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.unit;
  };
  a1 = await make(prop, { unit_name: 'A1', unit_type: 'studio', nightly_rate: '2500', weekend_rate: '2800' });
  a2 = await make(prop, { unit_name: 'A2', unit_type: 'studio', nightly_rate: '1800' });
  a3 = await make(prop, { unit_name: 'A3', unit_type: 'studio', nightly_rate: '3000' });
  long1 = await make(prop, { unit_name: 'Long 1', unit_type: 'apartment', monthly_rent: '9000' });
  b1 = await make(propB, { unit_name: 'B1', unit_type: 'studio', nightly_rate: '2000' });
  manager = await accept('bulk-mgr@example.com', 'manager', [prop.property_id], 'Manager Azure');
  staff = await accept('bulk-staff@example.com', 'staff', [prop.property_id], 'Staff Azure');
});
test.after(async () => { await srv.close(); });

test('tags and room types are saved on the listing, checked, and listed', async () => {
  const saved = await owner.patch(`/api/units/${a1.unit_id}`, {
    tags: ['  Beach ', 'beach', 'Near MRT'], room_type: '  Studio  ', min_price: '1,800', fortnight_discount: 10,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(saved.data.unit.tags, ['beach', 'near mrt']);
  assert.equal(saved.data.unit.room_type, 'Studio');
  assert.equal(saved.data.unit.min_price, '1800.00');
  assert.equal(saved.data.unit.fortnight_discount, 10);

  const refused = [
    [{ tags: Array.from({ length: 11 }, (_, i) => `tag${i}`) }, 'tags'],
    [{ tags: ['x'.repeat(31)] }, 'tags'],
    [{ tags: ['   '] }, 'tags'],
    [{ tags: 'beach' }, 'tags'],
    [{ room_type: 'x'.repeat(41) }, 'room_type'],
    [{ min_price: '-1' }, 'min_price'],
    [{ fortnight_discount: 91 }, 'fortnight_discount'],
  ];
  for (const [body, field] of refused) {
    const r = await owner.patch(`/api/units/${a1.unit_id}`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.ok(r.data.fields[field], JSON.stringify(r.data));
  }
  const still = await owner.get(`/api/properties/${prop.property_id}`);
  assert.deepEqual(still.data.units.find((u) => u.unit_id === a1.unit_id).tags, ['beach', 'near mrt']);

  const cleared = await owner.patch(`/api/units/${a1.unit_id}`, { min_price: '' });
  assert.equal(cleared.data.unit.min_price, null);
  await owner.patch(`/api/units/${a1.unit_id}`, { min_price: '1800' });

  // A new listing can take tags, a room type and a lowest price at creation.
  const created = await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: 'Pent 1', unit_type: 'apartment', tags: ['Sea View', 'sea view'], min_price: '1500',
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.deepEqual(created.data.unit.tags, ['sea view']);
  assert.equal(created.data.unit.min_price, '1500.00');
  assert.equal(created.data.unit.room_type, null);
  assert.equal(created.data.unit.fortnight_discount, 0);
  const badCreate = await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Pent 2', unit_type: 'apartment', tags: [' '] });
  assert.equal(badCreate.status, 400);

  await owner.patch(`/api/units/${a2.unit_id}`, { tags: ['beach'], room_type: 'Studio' });
  await owner.patch(`/api/units/${b1.unit_id}`, { tags: ['beach', 'pool'], room_type: 'Studio' });

  const detail = await owner.get(`/api/properties/${prop.property_id}`);
  const row = detail.data.units.find((u) => u.unit_id === a1.unit_id);
  assert.deepEqual(row.tags, ['beach', 'near mrt']);
  assert.equal(row.room_type, 'Studio');
  assert.equal(row.min_price, '1800.00');
  assert.equal(row.fortnight_discount, 10);

  const listings = await owner.get('/api/listings');
  assert.deepEqual(listings.data.listings.find((l) => l.unit_id === a1.unit_id).tags, ['beach', 'near mrt']);
  const beach = await owner.get('/api/listings?tag=BEACH');
  assert.deepEqual(beach.data.listings.map((l) => l.unit_id).sort(), [a1, a2, b1].map((u) => u.unit_id).sort());
  const mine = await manager.get('/api/listings?tag=beach');
  assert.deepEqual(mine.data.listings.map((l) => l.unit_id).sort(), [a1.unit_id, a2.unit_id].sort());

  const tags = await owner.get('/api/tags');
  assert.deepEqual(tags.data.tags.find((t) => t.tag === 'beach'), { tag: 'beach', count: 3 });
  assert.deepEqual(tags.data.tags.find((t) => t.tag === 'pool'), { tag: 'pool', count: 1 });
  const mgrTags = await manager.get('/api/tags');
  assert.deepEqual(mgrTags.data.tags.find((t) => t.tag === 'beach'), { tag: 'beach', count: 2 });
  assert.equal(mgrTags.data.tags.find((t) => t.tag === 'pool'), undefined);

  const types = await owner.get('/api/room-types');
  assert.equal(types.data.room_types.find((r) => r.property_id === prop.property_id).count, 2);
  assert.equal(types.data.room_types.find((r) => r.property_id === propB.property_id).count, 1);
  const mgrTypes = await manager.get('/api/room-types');
  assert.deepEqual(mgrTypes.data.room_types, [{ property_id: prop.property_id, room_type: 'Studio', count: 2 }]);
});

test('bulk prices: a preview writes nothing, and the apply writes exactly the preview', async () => {
  const body = { unit_ids: [a1.unit_id, a2.unit_id], from: d(10), to: d(12), action: 'set', price: '3000' };
  const preview = await owner.post('/api/bulk/prices', { ...body, dry_run: true });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.dry_run, true);
  assert.equal(preview.data.count, 6);
  assert.equal(preview.data.changes.length, 6);
  assert.ok(preview.data.changes.every((c) => c.to_price === '3000.00'));
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM nightly_rates WHERE unit_id = ANY($1::uuid[])', [[a1.unit_id, a2.unit_id]]))[0].n, 0);

  const applied = await owner.post('/api/bulk/prices', body);
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(applied.data.dry_run, false);
  assert.equal(applied.data.count, 6);
  assert.deepEqual(applied.data.changes, preview.data.changes);
  const rows = await sql('SELECT rate_date AS date, price FROM nightly_rates WHERE unit_id = $1 ORDER BY rate_date', [a1.unit_id]);
  assert.deepEqual(rows.map((r) => [r.date, r.price]), [[d(10), '3000.00'], [d(11), '3000.00'], [d(12), '3000.00']]);
});

test('bulk prices: a percentage change starts from the price now and rounds to the centavo', async () => {
  // A1's nights d10 and d11 are 3000 now, so +10% gives 3300.
  const preview = await owner.post('/api/bulk/prices', { unit_ids: [a1.unit_id], from: d(10), to: d(11), action: 'percent', percent: 10, dry_run: true });
  assert.deepEqual(preview.data.changes.map((c) => [c.from_price, c.to_price]), [['3000.00', '3300.00'], ['3000.00', '3300.00']]);
  await owner.post('/api/bulk/prices', { unit_ids: [a1.unit_id], from: d(10), to: d(11), action: 'percent', percent: 10 });
  const rows = await sql('SELECT price FROM nightly_rates WHERE unit_id = $1 AND rate_date BETWEEN $2 AND $3 ORDER BY rate_date', [a1.unit_id, d(10), d(11)]);
  assert.deepEqual(rows.map((r) => r.price), ['3300.00', '3300.00']);

  // 1234.57 x 1.05 = 1296.2985, which rounds to 1296.30.
  await owner.post('/api/bulk/prices', { unit_ids: [a3.unit_id], from: d(20), to: d(20), action: 'set', price: '1234.57' });
  const rounded = await owner.post('/api/bulk/prices', { unit_ids: [a3.unit_id], from: d(20), to: d(20), action: 'percent', percent: 5 });
  assert.equal(rounded.data.changes[0].to_price, '1296.30');

  // A2 has no custom price on d30, so its base rate of 1800 less 10% is 1620.
  const base = await owner.post('/api/bulk/prices', { unit_ids: [a2.unit_id], from: d(30), to: d(30), action: 'percent', percent: -10, dry_run: true });
  assert.deepEqual([base.data.changes[0].from_price, base.data.changes[0].to_price], ['1800.00', '1620.00']);
});

test('bulk prices: a listing with no nightly rate is reported, not guessed', async () => {
  const r = await owner.post('/api/bulk/prices', { unit_ids: [long1.unit_id], from: d(10), to: d(11), action: 'percent', percent: 5, dry_run: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.count, 0);
  assert.equal(r.data.skipped.length, 1);
  assert.equal(r.data.skipped[0].unit_id, long1.unit_id);
  assert.equal(r.data.skipped[0].reason, 'No nightly rate on 2 nights. Those nights were left alone.');
});

test('bulk prices: clear removes custom prices in range, and a preview leaves them in place', async () => {
  const body = { unit_ids: [a1.unit_id], from: d(10), to: d(12), action: 'clear' };
  const preview = await owner.post('/api/bulk/prices', { ...body, dry_run: true });
  assert.equal(preview.data.count, 3);
  assert.deepEqual(preview.data.changes.map((c) => [c.from_price, c.to_price]), [['3300.00', null], ['3300.00', null], ['3000.00', null]]);
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM nightly_rates WHERE unit_id = $1', [a1.unit_id]))[0].n, 3);

  const applied = await owner.post('/api/bulk/prices', body);
  assert.deepEqual(applied.data.changes, preview.data.changes);
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM nightly_rates WHERE unit_id = $1', [a1.unit_id]))[0].n, 0);
});

test('bulk prices: validation and the limits', async () => {
  const base = { unit_ids: [a1.unit_id], from: d(10), to: d(12), action: 'set', price: '2600', dry_run: true };
  const refused = [
    [{ ...base, from: d(-1) }, 'from'],
    [{ ...base, to: d(9) }, 'to'],
    [{ ...base, to: d(376) }, 'to'],
    [{ ...base, unit_ids: undefined }, 'unit_ids'],
    [{ ...base, tag: 'beach' }, 'unit_ids'],
    [{ ...base, unit_ids: Array.from({ length: 51 }, () => crypto.randomUUID()) }, 'unit_ids'],
    [{ ...base, price: undefined }, 'price'],
    [{ ...base, price: '0' }, 'price'],
    [{ ...base, action: 'double' }, 'action'],
    [{ ...base, action: 'percent', percent: undefined }, 'percent'],
    [{ ...base, action: 'percent', percent: 301 }, 'percent'],
    [{ ...base, action: 'percent', percent: -91 }, 'percent'],
    [{ ...base, action: 'percent', percent: 2.5 }, 'percent'],
  ];
  for (const [body, field] of refused) {
    const r = await owner.post('/api/bulk/prices', body);
    assert.equal(r.status, 400, `${field}: ${JSON.stringify(r.data)}`);
    assert.ok(r.data.fields[field], `${field}: ${JSON.stringify(r.data)}`);
  }
  // A year counted from the first night: 366 nights is allowed.
  const year = await owner.post('/api/bulk/prices', { ...base, to: d(375) });
  assert.equal(year.status, 200, JSON.stringify(year.data));
  assert.equal(year.data.count, 366);
  assert.equal(year.data.truncated, false);
});

test('bulk: a manager changes only their own listings; staff and signed-out visitors are refused', async () => {
  const base = { unit_ids: [a1.unit_id], from: d(10), to: d(12), action: 'clear', dry_run: true };
  assert.equal((await manager.post('/api/bulk/prices', base)).status, 200);
  assert.equal((await manager.post('/api/bulk/prices', { ...base, unit_ids: [b1.unit_id] })).status, 404);
  assert.equal((await owner.post('/api/bulk/prices', { ...base, unit_ids: [crypto.randomUUID()] })).status, 404);
  const poolTag = await manager.post('/api/bulk/prices', { ...base, unit_ids: undefined, tag: 'pool' });
  assert.equal(poolTag.status, 400);
  assert.equal((await staff.post('/api/bulk/prices', base)).status, 403);
  assert.equal((await staff.post('/api/bulk/blocks', { unit_ids: [a1.unit_id], from: d(10), to: d(12), action: 'block' })).status, 403);
  assert.equal((await client(srv.base).post('/api/bulk/prices', base)).status, 401);
  // The refused apply on another property wrote nothing.
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM nightly_rates WHERE unit_id = $1', [b1.unit_id]))[0].n, 0);
});

test('bulk prices: a tag reaches only the listings in scope, and more than 50 listings are refused', async () => {
  // "beach" is on A1, A2 and B1; a manager's preview covers A1 and A2 only.
  const mine = await manager.post('/api/bulk/prices', { tag: 'beach', from: d(40), to: d(40), action: 'percent', percent: 5, dry_run: true });
  assert.equal(mine.status, 200, JSON.stringify(mine.data));
  assert.deepEqual(mine.data.changes.map((c) => c.unit_id).sort(), [a1.unit_id, a2.unit_id].sort());

  let first;
  for (let i = 1; i <= 51; i += 1) {
    const u = await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: `Cap ${i}`, unit_type: 'room', tags: ['bulkcap'] });
    assert.equal(u.status, 201, JSON.stringify(u.data));
    if (i === 1) first = u.data.unit;
  }
  const capped = await owner.post('/api/bulk/prices', { tag: 'bulkcap', from: d(40), to: d(40), action: 'clear', dry_run: true });
  assert.equal(capped.status, 400);
  assert.match(capped.data.fields.tag, /51 listings/);

  assert.equal((await owner.patch(`/api/units/${first.unit_id}`, { tags: [] })).status, 200);
  const fifty = await owner.post('/api/bulk/prices', { tag: 'bulkcap', from: d(40), to: d(40), action: 'clear', dry_run: true });
  assert.equal(fifty.status, 200, JSON.stringify(fifty.data));
  assert.equal(fifty.data.count, 0);
});

test('bulk blocks: a listing with a booking on those nights is skipped, the others are blocked', async () => {
  const booked = await owner.post('/api/reservations', { unit_id: a2.unit_id, check_in: d(41), check_out: d(43), guest_name: 'Bulk Guest', accommodation_total: '3600' });
  assert.equal(booked.status, 201, JSON.stringify(booked.data));
  const body = { unit_ids: [a1.unit_id, a2.unit_id], from: d(41), to: d(42), action: 'block', reason: 'Owner use' };

  const preview = await owner.post('/api/bulk/blocks', { ...body, dry_run: true });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.deepEqual(preview.data.created, [{ unit_id: a1.unit_id, unit_name: 'A1', check_in: d(41), check_out: d(43) }]);
  assert.equal(preview.data.skipped.length, 1);
  assert.equal(preview.data.skipped[0].unit_id, a2.unit_id);
  assert.match(preview.data.skipped[0].reason, /^Booked on some of these nights \(BH-/);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM bookings WHERE kind = 'block' AND unit_id = $1`, [a1.unit_id]))[0].n, 0);

  const applied = await owner.post('/api/bulk/blocks', body);
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.deepEqual(applied.data.created, preview.data.created);
  assert.deepEqual(applied.data.skipped, preview.data.skipped);
  assert.equal(applied.data.count, 1);
  const [blk] = await sql(`SELECT check_in::text AS check_in, check_out::text AS check_out, block_reason, confirmation_code
                             FROM bookings WHERE kind = 'block' AND unit_id = $1`, [a1.unit_id]);
  assert.deepEqual([blk.check_in, blk.check_out, blk.block_reason], [d(41), d(43), 'Owner use']);
  assert.match(blk.confirmation_code, /^BL-/);
  const clash = await owner.post('/api/reservations', { unit_id: a1.unit_id, check_in: d(42), check_out: d(44), guest_name: 'Too late', accommodation_total: '1' });
  assert.equal(clash.status, 409);

  const again = await owner.post('/api/bulk/blocks', { ...body, dry_run: true });
  assert.equal(again.data.created.length, 0);
  assert.match(again.data.skipped.find((s) => s.unit_id === a1.unit_id).reason, /^Already blocked/);

  assert.equal((await manager.post('/api/bulk/blocks', { unit_ids: [b1.unit_id], from: d(45), to: d(46), action: 'block', dry_run: true })).status, 404);
  assert.equal((await owner.post('/api/bulk/blocks', { unit_ids: [a1.unit_id], from: d(-1), to: d(1), action: 'block', dry_run: true })).status, 400);
  assert.equal((await owner.post('/api/bulk/blocks', { unit_ids: [a1.unit_id], from: d(45), to: d(46), action: 'block', reason: 'x'.repeat(201) })).status, 400);
});

test('bulk unblocks: cancel only manual blocks fully inside the range', async () => {
  // A second manual block on A1 for d50 and d51, which runs past a narrower range.
  const extra = await owner.post('/api/bulk/blocks', { unit_ids: [a1.unit_id], from: d(50), to: d(51), action: 'block' });
  assert.equal(extra.status, 200, JSON.stringify(extra.data));

  // A channel block and an owner stay on A3, set straight in the database (the sync and the owner portal write them in the app).
  const [feed] = await sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url)
                            VALUES ($1, $2, 'airbnb', 'https://calendar.example.com/a3.ics') RETURNING feed_id`, [orgId, a3.unit_id]);
  await sql(`INSERT INTO bookings (organization_id, unit_id, kind, check_in, check_out, block_reason, confirmation_code, ical_feed_id, external_uid)
             VALUES ($1, $2, 'block', $3, $4, 'Airbnb block', 'CH-TEST-1', $5, 'uid-1')`, [orgId, a3.unit_id, d(60), d(61), feed.feed_id]);
  const [owner1] = await sql(`INSERT INTO unit_owners (organization_id, full_name) VALUES ($1, 'Ana Reyes') RETURNING owner_id`, [orgId]);
  await sql(`INSERT INTO bookings (organization_id, unit_id, kind, check_in, check_out, block_reason, confirmation_code, owner_block_by)
             VALUES ($1, $2, 'block', $3, $4, 'Owner stay', 'BL-OWNER-1', $5)`, [orgId, a3.unit_id, d(70), d(71), owner1.owner_id]);

  const preview = await owner.post('/api/bulk/blocks', { unit_ids: [a1.unit_id], from: d(40), to: d(42), action: 'unblock', dry_run: true });
  assert.deepEqual(preview.data.cancelled, [{ unit_id: a1.unit_id, unit_name: 'A1', check_in: d(41), check_out: d(43) }]);
  assert.deepEqual(preview.data.skipped, []);
  const applied = await owner.post('/api/bulk/blocks', { unit_ids: [a1.unit_id], from: d(40), to: d(42), action: 'unblock' });
  assert.deepEqual(applied.data.cancelled, preview.data.cancelled);
  assert.equal(applied.data.count, 1);
  const left = await sql(`SELECT check_in::text AS check_in FROM bookings WHERE kind = 'block' AND unit_id = $1 ORDER BY check_in`, [a1.unit_id]);
  assert.deepEqual(left.map((r) => r.check_in), [d(50)]);

  // The d50 block also covers nights outside d51 alone, so it stays and is reported.
  const partial = await owner.post('/api/bulk/blocks', { unit_ids: [a1.unit_id], from: d(51), to: d(51), action: 'unblock' });
  assert.deepEqual(partial.data.cancelled, []);
  assert.equal(partial.data.skipped.length, 1);
  assert.match(partial.data.skipped[0].reason, /outside these dates/);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM bookings WHERE kind = 'block' AND unit_id = $1`, [a1.unit_id]))[0].n, 1);

  // Channel blocks and owner stays are never removed here; each is reported.
  const channel = await owner.post('/api/bulk/blocks', { unit_ids: [a3.unit_id], from: d(60), to: d(70), action: 'unblock' });
  assert.deepEqual(channel.data.cancelled, []);
  const reasons = channel.data.skipped.map((s) => s.reason).join(' ');
  assert.equal(channel.data.skipped.length, 2);
  assert.match(reasons, /channel calendar/);
  assert.match(reasons, /owner/);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM bookings WHERE unit_id = $1 AND kind = 'block'`, [a3.unit_id]))[0].n, 2);

  // Reservations are never touched by an unblock.
  const reservations = await owner.post('/api/bulk/blocks', { unit_ids: [a2.unit_id], from: d(41), to: d(42), action: 'unblock' });
  assert.deepEqual(reservations.data.cancelled, []);
  assert.deepEqual(reservations.data.skipped, []);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM bookings WHERE unit_id = $1 AND kind = 'reservation' AND status = 'confirmed'`, [a2.unit_id]))[0].n, 1);
});

test('every apply writes one audit entry with its counts; a preview writes none', async () => {
  const count = async (action) => (await sql('SELECT COUNT(*)::int AS n FROM audit_logs WHERE organization_id = $1 AND action = $2', [orgId, action]))[0].n;
  const priceBefore = await count('bulk.prices');
  await owner.post('/api/bulk/prices', { unit_ids: [a1.unit_id], from: d(100), to: d(100), action: 'set', price: '2100', dry_run: true });
  assert.equal(await count('bulk.prices'), priceBefore);
  await owner.post('/api/bulk/prices', { unit_ids: [a1.unit_id], from: d(100), to: d(100), action: 'set', price: '2100' });
  assert.equal(await count('bulk.prices'), priceBefore + 1);
  const [last] = await sql(`SELECT details FROM audit_logs WHERE organization_id = $1 AND action = 'bulk.prices' ORDER BY audit_id DESC LIMIT 1`, [orgId]);
  assert.equal(last.details.action, 'set');
  assert.equal(last.details.listings, 1);
  assert.equal(last.details.changed, 1);

  const blockBefore = await count('bulk.blocks');
  await owner.post('/api/bulk/blocks', { unit_ids: [a3.unit_id], from: d(100), to: d(101), action: 'block', dry_run: true });
  assert.equal(await count('bulk.blocks'), blockBefore);
  await owner.post('/api/bulk/blocks', { unit_ids: [a3.unit_id], from: d(100), to: d(101), action: 'block' });
  assert.equal(await count('bulk.blocks'), blockBefore + 1);
});
