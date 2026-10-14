'use strict';

// QA round 6, lane C15: review list filters and totals (#27), and a ticket keeps its first rating (#41).

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, sql, manilaToday } = require('./helpers');

let srv; let host; let unit; let orgId;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Review Stays');
  const p = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await host.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500', bookable_online: true, payment_option: 'full' })).data.unit;
  orgId = (await sql('SELECT organization_id FROM organizations WHERE name = $1', ['Review Stays']))[0].organization_id;
});
test.after(async () => { await srv.close(); });

test('#27 a malformed unit_id or property_id filter is ignored, like other bad filter values (D-77)', async () => {
  const all = (await host.get('/api/reviews')).data;
  const badUnit = await host.get('/api/reviews?unit_id=zz');
  assert.equal(badUnit.status, 200, JSON.stringify(badUnit.data));
  assert.equal(badUnit.data.matched, all.matched);
  const badProperty = await host.get('/api/reviews?property_id=not-a-uuid');
  assert.equal(badProperty.status, 200, JSON.stringify(badProperty.data));
  assert.equal(badProperty.data.matched, all.matched);
});

test('#27 matched and matched_average cover every matching review, not only the 200 rows listed', async () => {
  // 205 one-night stays in one unit, each with a review. The 5 oldest reviews are 1 star; the 200 newest are 5 stars.
  await sql(
    `INSERT INTO bookings (organization_id, unit_id, kind, channel, status, check_in, check_out, accommodation_total, confirmation_code, guest_label)
     SELECT $1, $2, 'reservation', 'direct', 'confirmed', ($3::date - 400 + n), ($3::date - 399 + n), 1000, 'QA15-' || n, 'Guest ' || n
       FROM generate_series(1, 205) n`,
    [orgId, unit.unit_id, manilaToday()]);
  await sql(
    `INSERT INTO guest_reviews (organization_id, booking_id, rating, created_at)
     SELECT b.organization_id, b.booking_id, CASE WHEN n > 200 THEN 1 ELSE 5 END, now() - make_interval(mins => n)
       FROM generate_series(1, 205) n JOIN bookings b ON b.confirmation_code = 'QA15-' || n AND b.organization_id = $1`,
    [orgId]);

  const r = (await host.get(`/api/reviews?unit_id=${unit.unit_id}`)).data;
  assert.equal(r.reviews.length, 200, 'the list still stops at 200 rows');
  assert.equal(r.matched, 205);
  assert.equal(r.matched_average, 4.9, 'average over all 205 matching reviews, not the 200 listed (which would be 5)');
  assert.equal(r.count, 205);
  assert.equal(r.average, 4.9);

  const none = (await host.get('/api/reviews?unit_id=5f2d6c1e-0000-4000-8000-000000000000')).data;
  assert.equal(none.matched, 0);
  assert.equal(none.matched_average, null);
});

test('#41 a ticket keeps its first rating: a second rating is refused and the first stays', async () => {
  const t = (await host.post('/api/support/tickets', { subject: 'Rating overwrite', category: 'question', body: 'Where is the rate button?' })).data;
  await sql(`UPDATE support_tickets SET status = 'resolved', resolved_at = now() WHERE ticket_id = $1`, [t.ticket_id]);

  const first = await host.post(`/api/support/tickets/${t.ticket_id}/rate`, { rating: 4, comment: 'Helpful' });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const second = await host.post(`/api/support/tickets/${t.ticket_id}/rate`, { rating: 1, comment: 'Changed my mind' });
  assert.equal(second.status, 409, JSON.stringify(second.data));
  assert.equal(second.data.code, 'ALREADY_RATED');
  assert.equal(second.data.error, 'This ticket is already rated.');

  const [row] = await sql('SELECT rating, rating_comment FROM support_tickets WHERE ticket_id = $1', [t.ticket_id]);
  assert.equal(row.rating, 4);
  assert.equal(row.rating_comment, 'Helpful');
  const [ev] = await sql(`SELECT count(*)::int AS n FROM support_events WHERE ticket_id = $1 AND kind = 'rated'`, [t.ticket_id]);
  assert.equal(ev.n, 1, 'the timeline logs one rating');
});

test('#41 two ratings sent at the same moment: exactly one is saved', async () => {
  const t = (await host.post('/api/support/tickets', { subject: 'Double click', category: 'question', body: 'Hi' })).data;
  await sql(`UPDATE support_tickets SET status = 'resolved', resolved_at = now() WHERE ticket_id = $1`, [t.ticket_id]);
  const [a, b] = await Promise.all([
    host.post(`/api/support/tickets/${t.ticket_id}/rate`, { rating: 3 }),
    host.post(`/api/support/tickets/${t.ticket_id}/rate`, { rating: 5 }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const [ev] = await sql(`SELECT count(*)::int AS n FROM support_events WHERE ticket_id = $1 AND kind = 'rated'`, [t.ticket_id]);
  assert.equal(ev.n, 1);
});
