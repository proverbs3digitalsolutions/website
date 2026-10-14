'use strict';

// QA round 2, lane B32 (owners#3): the owner portal never sends a stay's confirmation code. The host's
// published snapshot keeps the code (D-47 says it is stored, not shown), so only the owner's copy drops it.
// Every owner read is checked, so a new route can't bring the code back unnoticed.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const { outbox } = require('../src/lib/mailer');

const AUG = '2026-08';
const SEP = '2026-09';
const MARIA_EMAIL = 'maria-b32@example.com';
let srv; let host; let ownerId; let ownerC; let augCode; let sepCode;

test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'r2-b32@example.com', 'R2 B32 Stays');
  const propertyId = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property.property_id;
  const unit = (await host.post(`/api/properties/${propertyId}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  ownerId = (await host.post('/api/unit-owners', { full_name: 'Maria Santos', email: MARIA_EMAIL, management_fee_pct: '10', unit_ids: [unit.unit_id] })).data.owner_id;
  const stay = async (checkIn, checkOut) => {
    const r = await host.post('/api/reservations', { unit_id: unit.unit_id, check_in: checkIn, check_out: checkOut, guest_name: 'Ana Cruz', channel: 'airbnb', channel_fee: '500' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.reservation.confirmation_code;
  };
  augCode = await stay('2026-08-10', '2026-08-12');
  sepCode = await stay('2026-09-10', '2026-09-12');
  assert.equal((await host.post(`/api/unit-owners/${ownerId}/statement/publish`, { month: AUG })).status, 200);

  // The invite mail is sent before the reply, so it is in the outbox by the time the call returns.
  outbox.length = 0;
  assert.equal((await host.post(`/api/unit-owners/${ownerId}/portal-invite`)).status, 200);
  const mail = outbox.find((m) => m.to === MARIA_EMAIL);
  const token = decodeURIComponent(/token=([^&\s]+)/.exec(mail.text)[1]);
  ownerC = client(srv.base);
  assert.equal((await ownerC.post('/api/owner-portal/session', { token })).status, 200);
});
test.after(async () => { await srv.close(); });

test('the owner\'s published statement has the stay but no confirmation code', async () => {
  const r = await ownerC.get(`/api/owner-portal/statements/${AUG}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.statement.stays.length, 1, 'the stay is still listed');
  assert.equal(r.data.statement.stays[0].guest_first_name, 'Ana');
  assert.ok(!('confirmation_code' in r.data.statement.stays[0]), 'the stay has no confirmation_code field');
  assert.ok(!JSON.stringify(r.data).includes(augCode), 'the code itself is not in the response');
});

test('no owner-portal read carries a confirmation code', async () => {
  const reads = [
    '/api/owner-portal/me',
    '/api/owner-portal/statements',
    `/api/owner-portal/statements/${AUG}`,
    '/api/owner-portal/bookings?from=2026-08-01&to=2026-09-30',
    '/api/owner-portal/activity',
    `/api/owner-portal/pnl?month=${AUG}`,
    `/api/owner-portal/pnl?month=${SEP}`,
    '/api/owner-portal/payouts',
    '/api/owner-portal/reserve',
  ];
  for (const url of reads) {
    const r = await ownerC.get(url);
    assert.equal(r.status, 200, `${url}: ${JSON.stringify(r.data)}`);
    const text = JSON.stringify(r.data);
    assert.ok(!text.includes(augCode) && !text.includes(sepCode), `${url} must not carry a confirmation code`);
    assert.ok(!text.includes('confirmation_code'), `${url} must not carry the confirmation_code field`);
  }
  // The live stay is in the bookings list, so the check above is not an empty pass.
  const bookings = (await ownerC.get('/api/owner-portal/bookings?from=2026-08-01&to=2026-09-30')).data.bookings;
  assert.equal(bookings.length, 2);
});

test('the host\'s stored snapshot and the host\'s statement still carry the code', async () => {
  const [{ code }] = await sql(
    `SELECT snapshot->'stays'->0->>'confirmation_code' AS code FROM owner_statements WHERE owner_id = $1 AND month = $2 AND status = 'published'`,
    [ownerId, AUG]);
  assert.equal(code, augCode);
  const hostView = await host.get(`/api/unit-owners/${ownerId}/statement?month=${AUG}`);
  assert.equal(hostView.status, 200, JSON.stringify(hostView.data));
  assert.equal(hostView.data.published.stays[0].confirmation_code, augCode);
});
