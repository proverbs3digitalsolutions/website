'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { outbox } = require('../src/lib/mailer');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
const d = (n) => ical.addDays(manilaToday(), n);

let srv; let host; let prop; let unit; let res; let staff;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Deposit Stays');
  prop = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await host.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', security_deposit_amount: '1000' })).data.unit;
  res = (await host.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(-3), check_out: d(-1), guest_name: 'Ana Cruz', guest_email: 'ana@example.com' })).data.reservation;
  const inv = await host.post('/api/team/invitations', { email: 'staff@example.com', role: 'staff', property_ids: [prop.property_id] });
  staff = client(srv.base);
  await staff.post('/api/auth/signup', { full_name: 'Nene Staff', email: 'staff@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
});
test.after(async () => { await srv.close(); });

test('record a deposit (staff can); it is not booking income', async () => {
  assert.equal((await host.get(`/api/reservations/${res.booking_id}/deposit`)).data.suggested, '1000.00');
  assert.equal((await staff.post(`/api/reservations/${res.booking_id}/deposit`, { amount: '1000', received_date: d(1), method: 'cash' })).status, 400, 'no future date');
  outbox.length = 0;
  const r = await host.post(`/api/reservations/${res.booking_id}/deposit`, { amount: '1000', received_date: d(-3), method: 'gcash', reference_number: '1234', send_receipt: true });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.receipt.sent, true);
  assert.match(outbox.at(-1).text, /security deposit of ₱1,000\.00 by GCash/);
  assert.equal((await host.post(`/api/reservations/${res.booking_id}/deposit`, { amount: '500', received_date: d(-3), method: 'cash' })).status, 409);
  const b = (await host.get(`/api/reservations/${res.booking_id}`)).data.reservation;
  assert.equal(b.amount_paid, '0.00', 'not counted as a payment');
  const due = (await host.get('/api/deposits/due')).data.deposits;
  assert.equal(due.length, 1);
});

test('return with a deduction: reason required, guest gets a summary, photos attach', async () => {
  const url = `/api/reservations/${res.booking_id}/deposit/settle`;
  assert.equal((await staff.post(url, {})).status, 403, 'staff can\'t settle');
  assert.equal((await host.post(url, { deduction_amount: '1500' })).status, 400);
  assert.equal((await host.post(url, { deduction_amount: '300' })).status, 400, 'reason needed');
  assert.equal((await host.post(url, { deduction_amount: '300', deduction_reason: 'Broken glass' })).status, 400, 'refund method needed');
  outbox.length = 0;
  const r = await host.post(url, { deduction_amount: '300', deduction_reason: 'Broken glass and late check-out', refund_method: 'gcash', refund_reference: 'R-1', send_receipt: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.deposit.status, 'partly_refunded');
  assert.equal(r.data.deposit.refund_amount, '700.00');
  assert.match(outbox.at(-1).text, /Deduction: ₱300\.00\nReason: {4}Broken glass and late check-out\nReturned: {2}₱700\.00 by GCash \(ref\. R-1\)/);
  assert.equal((await host.post(url, { deduction_amount: '0' })).status, 409, 'once');
  assert.equal((await host.get('/api/deposits/due')).data.deposits.length, 0);

  const dep = r.data.deposit;
  const up = await host.raw('POST', `/api/files?record_type=deposit&record_id=${dep.deposit_id}`, PNG, { 'Content-Type': 'image/png' });
  assert.equal(up.status, 201);
  assert.equal((await host.get(`/api/reservations/${res.booking_id}/deposit`)).data.deposit.files.length, 1);
  const other = await ownerAccount(srv.base, 'x@example.com', 'Other');
  assert.equal((await other.raw('POST', `/api/files?record_type=deposit&record_id=${dep.deposit_id}`, PNG, { 'Content-Type': 'image/png' })).status, 404);
  assert.equal((await other.get(`/api/reservations/${res.booking_id}/deposit`)).status, 404);

  // Owner can undo; then keep it all.
  assert.equal((await staff.post(`/api/reservations/${res.booking_id}/deposit/reopen`)).status, 403);
  assert.equal((await host.post(`/api/reservations/${res.booking_id}/deposit/reopen`)).data.deposit.status, 'held');
  const kept = await host.post(url, { deduction_amount: '1000', deduction_reason: 'Stained mattress' });
  assert.equal(kept.data.deposit.status, 'kept');
  assert.equal(kept.data.deposit.refund_amount, '0.00');
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM stay_deposits'))[0].n, 1);
});
