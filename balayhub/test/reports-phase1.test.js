'use strict';

// Phase 1 money in the reports: extra charges count as revenue, refunds come off
// money received in the month they were paid back, and an owner's statement shows
// refunds on their own line, exact to the centavo.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount } = require('./helpers');
const { outbox } = require('../src/lib/mailer');

let srv; let host; let unitA; let unitB; let unitC; let ownerId;
let r1; let r2; let r3; let r4; let s1; let s2; let s3;

const reserve = async (unit, checkIn, checkOut, extra = {}) =>
  (await host.post('/api/reservations', { unit_id: unit.unit_id, check_in: checkIn, check_out: checkOut, guest_name: 'Guest', ...extra })).data.reservation;
const pay = (r, amount, date, method = 'gcash') => host.post(`/api/reservations/${r.booking_id}/payments`, { amount, payment_date: date, payment_method: method });
const refund = (r, amount, date, reason = 'Refund') => host.post(`/api/reservations/${r.booking_id}/refunds`, { amount, refund_date: date, method: 'gcash', reason });
const charge = (r, category, description, quantity, unitPrice) => host.post(`/api/reservations/${r.booking_id}/charges`, { category, description, quantity, unit_price: unitPrice });
const cancel = (r) => host.post(`/api/reservations/${r.booking_id}/cancel`, { reason: 'Guest cancelled' });
const tax = async () => (await host.get('/api/stay-reports/tax?year=2026')).data;
const month = (t, m) => t.months.find((x) => x.month === m);
const cents = (v) => Math.round(Number(v) * 100);

test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host-p1@example.com', 'Phase1 Reports');
  const p = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const unit = async (name, rate, cleaning) => (await host.post(`/api/properties/${p.property_id}/units`,
    { unit_name: name, unit_type: 'studio', nightly_rate: rate, ...(cleaning ? { cleaning_fee: cleaning } : {}) })).data.unit;
  unitA = await unit('1201', '2000', '500');
  unitB = await unit('805', '1500');
  unitC = await unit('1407', '1234.57', '500');
  ownerId = (await host.post('/api/unit-owners', { full_name: 'Maria Santos', email: 'maria-p1@example.com', management_fee_pct: '20', unit_ids: [unitC.unit_id] })).data.owner_id;

  // Listing A (August): extras on a stay, one extra voided, and a cancelled stay with extras.
  r1 = await reserve(unitA, '2026-08-03', '2026-08-05'); // 2 x 2,000 + 500 cleaning
  await charge(r1, 'late_checkout', 'Late checkout to 3pm', 1, '300');
  await charge(r1, 'damage', 'Broken glass', 2, '150'); // 600 of extras
  const stray = (await charge(r1, 'other', 'Entered by mistake', 1, '999')).data.charge;
  await host.post(`/api/charges/${stray.charge_id}/void`, { reason: 'Entered by mistake' });
  r2 = await reserve(unitA, '2026-08-20', '2026-08-21'); // 2,000 + 500 cleaning
  await charge(r2, 'extra_bed', 'Extra bed', 1, '100');
  await cancel(r2);

  // Listing B (September): a refund on a stay, and a cancelled stay where the host kept part of the money.
  r3 = await reserve(unitB, '2026-09-07', '2026-09-08'); // 1,500
  await pay(r3, '1500.00', '2026-09-07');
  await refund(r3, '400.00', '2026-09-09', 'Left a night early');
  r4 = await reserve(unitB, '2026-09-15', '2026-09-17'); // 3,000, then cancelled
  await pay(r4, '1000.00', '2026-09-10', 'cash');
  await cancel(r4);
  await refund(r4, '300.00', '2026-09-12', 'Partial refund on cancellation');

  // The owner's unit C. July: a channel stay with extras and a refund, and a cancelled stay
  // whose refund must not reach the owner. June: the guest overpaid after a charge was voided.
  s1 = await reserve(unitC, '2026-07-14', '2026-07-16', { channel: 'airbnb', channel_fee: '123.45' }); // 2,469.14 + 500 cleaning + 150.25 extra
  await charge(s1, 'late_checkout', 'Late checkout', 1, '150.25');
  await pay(s1, '2995.94', '2026-07-14', 'bank_transfer'); // what the channel pays out
  await refund(s1, '250.50', '2026-07-20', 'Aircon was out');
  s2 = await reserve(unitC, '2026-07-22', '2026-07-23');
  await pay(s2, '1000.00', '2026-07-21', 'cash');
  await cancel(s2);
  await refund(s2, '300.00', '2026-07-22', 'Goodwill on cancellation');
  s3 = await reserve(unitC, '2026-06-10', '2026-06-11'); // 1,234.57 + 500 cleaning
  const cracked = (await charge(s3, 'damage', 'Cracked tile', 1, '200')).data.charge;
  await pay(s3, '1934.57', '2026-06-10');
  await host.post(`/api/charges/${cracked.charge_id}/void`, { reason: 'Already cracked when they arrived' }); // bill is now 1,734.57, so 200 is overpaid
  await refund(s3, '200.00', '2026-06-12', 'Overpaid after a charge was voided');
  await refund(s3, '150.00', '2026-06-13', 'Goodwill');
});
test.after(async () => { await srv.close(); });

test('extra charges count as revenue on check-in, like cleaning fees; voided and cancelled extras do not', async () => {
  const aug = (await host.get('/api/stay-reports?month=2026-08')).data;
  // 2 nights of 2,000, 500 cleaning and 600 of extras. The voided 999 and the cancelled stay are left out.
  assert.equal(aug.totals.revenue, '5100.00');
  assert.equal(aug.totals.nights, 2);
  assert.equal(aug.totals.cancelled, 1);
  const a = aug.units.find((u) => u.unit_id === unitA.unit_id);
  assert.deepEqual([a.revenue, a.adr], ['5100.00', '2000.00'], 'the average nightly rate is accommodation only');
  assert.equal((await host.get(`/api/reservations/${r1.booking_id}`)).data.reservation.balance, '5100.00', 'the guest owes the extras too');
  assert.equal(month(await tax(), '2026-08').revenue, '5100.00');

  // July: revenue is before the channel fee, which is reported on its own.
  const jul = (await host.get('/api/stay-reports?month=2026-07')).data;
  assert.deepEqual([jul.totals.revenue, jul.totals.channel_fees], ['3119.39', '123.45']);
});

test('income summary: refunds come off payments in the month they were paid back; kept money on a cancelled stay still counts', async () => {
  const t = await tax();
  // June: 1,934.57 paid, 350.00 refunded (the overpayment refund included).
  const jun = month(t, '2026-06');
  assert.deepEqual([jun.received, jun.refunds, jun.net_received], ['1934.57', '350.00', '1584.57']);
  // July: 2,995.94 and 1,000 paid; 250.50 and 300 refunded. The 700 kept on the cancelled stay still counts,
  // as payments on cancelled stays always have.
  const jul = month(t, '2026-07');
  assert.deepEqual([jul.received, jul.refunds, jul.net_received], ['3995.94', '550.50', '3445.44']);
  // September: 1,500 and 1,000 paid; 400 and 300 refunded. Revenue leaves out the cancelled stay.
  const sep = month(t, '2026-09');
  assert.deepEqual([sep.revenue, sep.received, sep.refunds, sep.net_received], ['1500.00', '2500.00', '700.00', '1800.00']);
  const q3 = t.quarters[2];
  assert.deepEqual([q3.received, q3.refunds, q3.net_received], ['6495.94', '1250.50', '5245.44']);
  assert.equal(cents(t.totals.net_received), cents(t.totals.received) - cents(t.totals.refunds));

  const csv = (await host.get('/api/stay-reports/export?kind=tax&year=2026')).data;
  assert.match(csv, /2026-09,1500\.00,2500\.00,0\.00,0\.00,1500\.00,700\.00,1800\.00/);
});

test('a refund counts only in the month it was paid back; voiding one takes it off again', async () => {
  assert.equal((await refund(r3, '200.00', '2026-10-02', 'Late refund')).status, 201);
  let t = await tax();
  assert.equal(month(t, '2026-09').refunds, '700.00', 'September is unchanged');
  const oct = month(t, '2026-10');
  assert.deepEqual([oct.received, oct.refunds, oct.net_received], ['0.00', '200.00', '-200.00']);

  const extra = (await refund(r3, '100.00', '2026-09-11', 'Second refund')).data.refund;
  assert.equal(month(await tax(), '2026-09').refunds, '800.00');
  assert.equal((await host.post(`/api/refunds/${extra.refund_id}/void`, { reason: 'Entered twice' })).status, 200);
  t = await tax();
  assert.equal(month(t, '2026-09').net_received, '1800.00', 'the voided refund stops counting');
});

test('owner statement: refunds come off the payout on their own line, to the centavo', async () => {
  const s = (await host.get(`/api/unit-owners/${ownerId}/statement?month=2026-07`)).data.statement;
  // Gross 3,119.39. Less channel fee 123.45, cleaning 500.00 (kept by the manager) and refund 250.50 = 2,245.44.
  // Management fee 20% = 449.09 (449.088, rounded to the centavo). Payout 1,796.35.
  // The 300 refunded on the cancelled stay is not the owner's: that stay was never in the statement.
  assert.equal(s.refunded, '250.50');
  assert.equal(s.stays.length, 1);
  assert.deepEqual(
    [s.totals.gross, s.totals.channel_fees, s.totals.cleaning_fees, s.totals.net_rental, s.totals.management_fee, s.totals.expenses, s.totals.payout],
    ['3119.39', '123.45', '500.00', '2245.44', '449.09', '0.00', '1796.35']);
  assert.equal((await host.get(`/api/reservations/${s1.booking_id}`)).data.reservation.balance, '0.00', 'the guest has paid the whole bill, extras included');

  outbox.length = 0;
  await host.post(`/api/unit-owners/${ownerId}/statement/publish`, { month: '2026-07' });
  assert.equal((await host.post(`/api/unit-owners/${ownerId}/statement/send`, { month: '2026-07' })).status, 200);
  const mail = outbox.find((x) => x.to === 'maria-p1@example.com');
  assert.match(mail.text, /Less refunds: +₱250\.50/);
  assert.match(mail.text, /Net rental income: +₱2,245\.44/);
});

test('a refund in another month leaves this statement alone; an overpayment refund does not cut the owner', async () => {
  assert.equal((await refund(s1, '100.00', '2026-08-05', 'August goodwill')).status, 201);
  const jul = (await host.get(`/api/unit-owners/${ownerId}/statement?month=2026-07`)).data.statement;
  assert.equal(jul.refunded, '250.50');
  const aug = (await host.get(`/api/unit-owners/${ownerId}/statement?month=2026-08`)).data.statement;
  assert.equal(aug.refunded, '100.00');

  // June: the bill is 1,734.57 and 200 was overpaid. The first 200 refunded only gives that back,
  // so just the 150 beyond it reduces the owner's income: net 1,084.57, fee 216.91 (216.914), payout 867.66.
  const jun = (await host.get(`/api/unit-owners/${ownerId}/statement?month=2026-06`)).data.statement;
  assert.deepEqual(
    [jun.refunded, jun.totals.gross, jun.totals.net_rental, jun.totals.management_fee, jun.totals.payout],
    ['150.00', '1734.57', '1084.57', '216.91', '867.66']);
});
