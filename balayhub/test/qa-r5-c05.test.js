'use strict';

// QA round 5 (C05): the guest pay page remembers the proofs already sent (#6), and proofs that are
// still waiting for the host can't add up to more than is owed (#7). #26: the amount check on the
// proof form reads money with parseAmount.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');

let srv; let owner; let guest; let unitId; let offsetNext = 10;

// A one-night stay of 10,500 + 500 cleaning = 11,000 total, with manual payments on.
async function booking(guestName) {
  const r = await owner.post('/api/reservations', { unit_id: unitId, check_in: d(offsetNext), check_out: d(offsetNext + 1), guest_name: guestName, guest_email: `${guestName.split(' ')[0].toLowerCase()}@example.com` });
  offsetNext += 2;
  assert.ok(r.data.reservation, JSON.stringify(r.data));
  const link = await owner.get(`/api/reservations/${r.data.reservation.booking_id}/payment-link`);
  return { booking_id: r.data.reservation.booking_id, token: link.data.link.split('/#/pay/')[1] };
}
const sendProof = (tok, amount) => guest.post(`/api/public/pay/${tok}/proofs`, { amount, method: 'gcash', reference_number: `REF-${amount}`, payer_name: 'Ana Cruz' });
const page = async (tok) => (await guest.get(`/api/public/pay/${tok}`)).data;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host-r5-c05@example.com', 'Proof Stays');
  guest = client(srv.base);
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unitId = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1301', unit_type: 'studio', nightly_rate: '10500', cleaning_fee: '500' })).data.unit.unit_id;
  assert.equal((await owner.patch('/api/workspace/manual-payments', { enabled: true, instructions: 'GCash 0917 123 4567' })).status, 200);
});
test.after(async () => { await srv.close(); });

test('#6 the pay page lists the pending proofs after a reload', async () => {
  const b = await booking('Ana Cruz');
  assert.deepEqual((await page(b.token)).manual_payments.pending, []);
  assert.equal((await page(b.token)).manual_payments.pending_total, '0.00');
  const sent = await sendProof(b.token, '1000');
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  const m = (await page(b.token)).manual_payments;
  assert.equal(m.pending.length, 1);
  assert.equal(m.pending_total, '1000.00');
  const p = m.pending[0];
  assert.equal(p.proof_id, sent.data.proof_id);
  assert.equal(Number(p.amount), 1000);
  assert.equal(p.method, 'gcash');
  assert.equal('reference_number' in p, false, 'the pay link does not expose the reference number');
  assert.equal(p.has_file, false);
  assert.ok(p.sent_at);
  assert.equal('notes' in p, false);
  await guest.post(`/api/public/pay/${b.token}/proofs/${p.proof_id}/image`, PNG, { 'Content-Type': 'image/png' });
  assert.equal((await page(b.token)).manual_payments.pending[0].has_file, true);
});

test('#7 pending proofs together can not pass the balance', async () => {
  const b = await booking('Ben Lim');
  assert.equal((await sendProof(b.token, '1000')).status, 201);
  const over = await sendProof(b.token, '10500');
  assert.equal(over.status, 400);
  assert.match(over.data.fields.amount, /already sent proofs for ₱1,000\.00/);
  assert.match(over.data.fields.amount, /up to ₱10,000\.00 more/);
  assert.equal((await sendProof(b.token, '10000')).status, 201);
  const none = await sendProof(b.token, '1');
  assert.equal(none.status, 400);
  assert.equal(none.data.fields.amount, 'Your proofs already cover what you owe. The host will check them soon.');
});

test('#7 a rejected proof no longer counts, and other bookings never show', async () => {
  const b = await booking('Cy Tan');
  const other = await booking('Di Reyes');
  const sent = await sendProof(b.token, '11000');
  assert.equal(sent.status, 201);
  assert.equal((await sendProof(other.token, '500')).status, 201);
  assert.equal((await page(b.token)).manual_payments.pending.length, 1);
  assert.equal((await page(other.token)).manual_payments.pending_total, '500.00');
  assert.equal((await sendProof(b.token, '100')).status, 400);
  const rej = await owner.post(`/api/payment-proofs/${sent.data.proof_id}/reject`, { reason: 'No match' });
  assert.equal(rej.status, 200, JSON.stringify(rej.data));
  assert.equal((await page(b.token)).manual_payments.pending_total, '0.00');
  assert.equal((await sendProof(b.token, '11000')).status, 201);
  assert.ok((await sql('SELECT 1 FROM payment_proofs WHERE booking_id = $1', [b.booking_id])).length >= 2);
});

test('#6 #7 #26 the pay page shows pending proofs, hides the form when covered, and reads money with parseAmount', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/pay.js'), 'utf8');
  assert.match(src, /import \{[^}]*\bparseAmount\b[^}]*\} from '\.\.\/ui\.js'/);
  assert.doesNotMatch(src, /replace\(\/\[₱,\\s\]\/g/);
  assert.match(src, /pending_total/);
  assert.match(src, /Take it back/);
  assert.match(src, /Add the screenshot/);
  assert.match(src, /Your proofs already cover what you owe\. The host will check them soon\./);
  assert.match(src, /'Take it back':\s*'/);
  assert.match(src, /'Add the screenshot':\s*'/);
});
