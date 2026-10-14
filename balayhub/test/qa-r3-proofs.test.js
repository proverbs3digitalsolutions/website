'use strict';

// QA round 3 (guest#5): a guest whose screenshot was refused can take the proof back and send it
// again, and the host hears about a proof only once its screenshot is in.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);
// A 1x1 PNG.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
const INSTR = 'GCash 0917 123 4567 (Maria Santos)';

let srv; let owner; let guest; let prop; let unitId; let offsetNext = 10;

// A two-night reservation with manual payments on, and its private pay link.
async function payLinkFor(guestName) {
  const r = await owner.post('/api/reservations', { unit_id: unitId, check_in: d(offsetNext), check_out: d(offsetNext + 2), guest_name: guestName, guest_email: `${guestName.split(' ')[0].toLowerCase()}@example.com` });
  offsetNext += 3;
  assert.ok(r.data.reservation, JSON.stringify(r.data));
  const link = await owner.get(`/api/reservations/${r.data.reservation.booking_id}/payment-link`);
  assert.equal(link.data.available, true, JSON.stringify(link.data));
  return { booking_id: r.data.reservation.booking_id, token: link.data.link.split('/#/pay/')[1] };
}

// The host's inbox notes about proofs on one reservation.
async function hostNotes(bookingId) {
  const [{ n }] = await sql(`SELECT COUNT(*)::int AS n FROM messages m JOIN conversations c ON c.conversation_id = m.conversation_id
                              WHERE c.booking_id = $1 AND m.direction = 'note' AND m.body LIKE 'The guest sent a payment proof%'`, [bookingId]);
  return n;
}

// Step 1 of a proof: the details only, no screenshot yet.
async function sendDetails(tok, amount = '1000') {
  const r = await guest.post(`/api/public/pay/${tok}/proofs`, { amount, method: 'gcash', reference_number: `REF-${amount}`, payer_name: 'Ana Cruz' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.proof_id;
}

const withdraw = (tok, proofId) => guest.raw('DELETE', `/api/public/pay/${tok}/proofs/${proofId}`);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host-r3-proofs@example.com', 'Withdraw Stays');
  guest = client(srv.base);
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unitId = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1301', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500' })).data.unit.unit_id;
  assert.equal((await owner.patch('/api/workspace/manual-payments', { enabled: true, instructions: INSTR })).status, 200);
});
test.after(async () => { await srv.close(); });

test('the host hears about a proof only once its screenshot is in', async () => {
  const b = await payLinkFor('Ana Cruz');
  const pid = await sendDetails(b.token);
  assert.equal(await hostNotes(b.booking_id), 0, 'no inbox note for a proof with no screenshot');

  const refused = await guest.post(`/api/public/pay/${b.token}/proofs/${pid}/image`, Buffer.from('plain text'), { 'Content-Type': 'image/png' });
  assert.equal(refused.status, 415);
  assert.equal(await hostNotes(b.booking_id), 0, 'a refused screenshot does not tell the host');

  assert.equal((await guest.post(`/api/public/pay/${b.token}/proofs/${pid}/image`, PNG, { 'Content-Type': 'image/png' })).status, 201);
  assert.equal(await hostNotes(b.booking_id), 1, 'the host is told once the screenshot is in');
});

test('a pending proof with no screenshot can be withdrawn, and the guest can send a corrected one', async () => {
  const b = await payLinkFor('Ben Lim');
  const pid = await sendDetails(b.token, '1000');
  const gone = await withdraw(b.token, pid);
  assert.equal(gone.status, 200, JSON.stringify(gone.data));
  assert.deepEqual(gone.data, { ok: true });
  assert.equal((await sql('SELECT 1 FROM payment_proofs WHERE proof_id = $1', [pid])).length, 0, 'the proof row is gone');
  assert.equal((await sql(`SELECT 1 FROM audit_logs WHERE action = 'payment_proof.withdrawn' AND record_id = $1`, [pid])).length, 1, 'the withdrawal is audited');
  assert.equal(await hostNotes(b.booking_id), 0, 'the host was never told about it');

  const corrected = await sendDetails(b.token, '800');
  assert.equal((await sql('SELECT amount::text AS amount FROM payment_proofs WHERE proof_id = $1', [corrected]))[0].amount, '800.00');
});

test('a proof that already has a screenshot cannot be withdrawn', async () => {
  const b = await payLinkFor('Cy Tan');
  const pid = await sendDetails(b.token);
  assert.equal((await guest.post(`/api/public/pay/${b.token}/proofs/${pid}/image`, PNG, { 'Content-Type': 'image/png' })).status, 201);
  const refused = await withdraw(b.token, pid);
  assert.equal(refused.status, 409, JSON.stringify(refused.data));
  assert.equal(refused.data.code, 'HAS_FILE');
  assert.equal((await sql('SELECT status FROM payment_proofs WHERE proof_id = $1', [pid]))[0].status, 'pending', 'the proof is still waiting for the host');
});

test('a proof the host has already reviewed cannot be withdrawn', async () => {
  const b = await payLinkFor('Dee Ruiz');
  const pid = await sendDetails(b.token);
  assert.equal((await owner.post(`/api/payment-proofs/${pid}/reject`, { reason: 'Reference not found.' })).status, 200);
  const refused = await withdraw(b.token, pid);
  assert.equal(refused.status, 409);
  assert.equal(refused.data.code, 'NOT_PENDING');
  assert.equal((await sql('SELECT status FROM payment_proofs WHERE proof_id = $1', [pid]))[0].status, 'rejected');
});

test("another booking's proof, a bad pay link or a bad proof id cannot be withdrawn", async () => {
  const mine = await payLinkFor('Eli Mora');
  const theirs = await payLinkFor('Fab Diaz');
  const pid = await sendDetails(mine.token);

  assert.equal((await withdraw(theirs.token, pid)).status, 404, 'another booking\'s link does not reach this proof');
  assert.equal((await withdraw('nonsense-token-123456789', pid)).status, 404, 'an unknown link is refused');
  assert.equal((await withdraw(mine.token, 'not-a-proof-id')).status, 404, 'a malformed proof id is refused');
  assert.equal((await sql('SELECT status FROM payment_proofs WHERE proof_id = $1', [pid]))[0].status, 'pending', 'the proof is untouched');
});
