'use strict';

// Guest payment proofs (GCash, Maya, bank transfer), the host's confirm and reject,
// the itemised bill on the pay page, and the owner-only manual payment settings.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { pool } = require('../src/db');
const { outbox } = require('../src/lib/mailer');

const d = (n) => ical.addDays(manilaToday(), n);
// A 1x1 PNG.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
const INSTR = 'GCash 0917 123 4567 (Maria Santos)';

let srv; let owner; let manager; let staff; let other; let guest; let prop;
let res1; let res2; let res3; let res4; let res5; let res6;
let tok1; let tok2; let tok3; let tok4; let tok5; let tok6;
let proof1; let proof2; let proof3; let file1; let payment1;

// A unit with a reservation of two nights, starting `offset` days from today.
async function booking(unitName, offset, guestName, guestEmail) {
  const u = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: unitName, unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500' })).data.unit;
  const r = await owner.post('/api/reservations', { unit_id: u.unit_id, check_in: d(offset), check_out: d(offset + 2), guest_name: guestName, guest_email: guestEmail });
  assert.ok(r.data.reservation, JSON.stringify(r.data));
  return r.data.reservation;
}

// The private pay link for a reservation (the host's own endpoint).
async function payToken(b) {
  const r = await owner.get(`/api/reservations/${b.booking_id}/payment-link`);
  assert.equal(r.data.available, true, JSON.stringify(r.data));
  return r.data.link.split('/#/pay/')[1];
}

// A team member invited to the property, signed in.
async function invite(email, role) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: [prop.property_id] });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const token = decodeURIComponent(inv.data.inviteLink.split('invite=')[1]);
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: email, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: token });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Proof Stays');
  guest = client(srv.base);
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;

  // Ana's stay: 2 nights (4000) + cleaning (500) + an extra bed (300) = 4800, with 2000 already paid.
  res1 = await booking('1201', 10, 'Ana Cruz', 'ana@example.com');
  await owner.post(`/api/reservations/${res1.booking_id}/payments`, { amount: '2000', payment_date: manilaToday(), payment_method: 'gcash' });
  // Extra charges are written straight to the table here (Lane A owns the charges route); the
  // booking's extras_total is what folds them into the total.
  await sql(`INSERT INTO booking_charges (organization_id, booking_id, category, description, quantity, unit_price)
             SELECT organization_id, booking_id, 'extra_bed', 'Extra bed', 1, 300 FROM bookings WHERE booking_id = $1`, [res1.booking_id]);
  await sql('UPDATE bookings SET extras_total = 300 WHERE booking_id = $1', [res1.booking_id]);
});
test.after(async () => { await srv.close(); });

test('manual payments: only the owner can turn them on, and the details are required', async () => {
  assert.equal((await owner.get('/api/workspace/manual-payments')).data.enabled, false);
  const noDetails = await owner.patch('/api/workspace/manual-payments', { enabled: true, instructions: '' });
  assert.equal(noDetails.status, 400);
  assert.ok(noDetails.data.fields.instructions, 'asks for the payment details');

  manager = await invite('mgr@example.com', 'manager');
  staff = await invite('staff@example.com', 'staff');
  assert.equal((await manager.patch('/api/workspace/manual-payments', { enabled: true, instructions: INSTR })).status, 403);
  assert.equal((await manager.get('/api/workspace/manual-payments')).status, 403);
  assert.equal((await staff.patch('/api/workspace/manual-payments', { enabled: true, instructions: INSTR })).status, 403);

  // Without PayMongo or manual payments there is no payment link yet.
  assert.equal((await owner.get(`/api/reservations/${res1.booking_id}/payment-link`)).data.available, false);

  const on = await owner.patch('/api/workspace/manual-payments', { enabled: true, instructions: INSTR });
  assert.equal(on.status, 200);
  assert.deepEqual(on.data, { enabled: true, instructions: INSTR });
  assert.equal((await owner.get('/api/workspace/manual-payments')).data.instructions, INSTR);

  // A payment link now works with manual payments alone.
  tok1 = await payToken(res1);
  other = await ownerAccount(srv.base, 'other@example.com', 'Other Co');
  assert.equal((await other.get('/api/workspace/manual-payments')).data.enabled, false, 'other workspaces keep their own settings');
});

test('the pay page shows the itemised bill, and the manual details only when turned on', async () => {
  const pg = await guest.get(`/api/public/pay/${tok1}`);
  assert.equal(pg.status, 200);
  assert.equal(pg.data.total, '4800.00');
  assert.equal(pg.data.balance, '2800.00');
  assert.equal(pg.data.accepting, false, 'no PayMongo, so no online checkout');
  const bill = pg.data.bill;
  assert.equal(bill.nights, 2);
  assert.equal(bill.accommodation_total, '4000.00');
  assert.equal(bill.cleaning_fee, '500.00');
  assert.equal(bill.other_fees, '0.00');
  assert.deepEqual(bill.charges.map((c) => [c.description, c.amount]), [['Extra bed', '300.00']]);
  assert.equal(bill.total, '4800.00');
  assert.equal(bill.paid, '2000.00');
  assert.deepEqual(bill.payments.map((p) => [p.amount, p.payment_method]), [['2000.00', 'gcash']]);
  assert.deepEqual(pg.data.manual_payments, { instructions: INSTR, accepting: true });

  await owner.patch('/api/workspace/manual-payments', { enabled: false, instructions: INSTR });
  const off = await guest.get(`/api/public/pay/${tok1}`);
  assert.equal(off.data.manual_payments, null);
  assert.equal(JSON.stringify(off.data).includes('0917 123 4567'), false, 'no details when turned off');
  await owner.patch('/api/workspace/manual-payments', { enabled: true, instructions: INSTR });

  assert.equal((await guest.get('/api/public/pay/nonsense-token-123456789')).status, 404);
});

test('a guest sends a proof and a screenshot; the host sees it pending', async () => {
  const send = (body) => guest.post(`/api/public/pay/${tok1}/proofs`, body);
  assert.equal((await send({ amount: '0', method: 'gcash' })).status, 400, 'amount must be above zero');
  assert.equal((await send({ amount: '-5', method: 'gcash' })).status, 400, 'amount cannot be negative');
  assert.equal((await send({ amount: '100', method: 'paypal' })).status, 400, 'method must be on the list');
  const over = await send({ amount: '5000', method: 'gcash' });
  assert.equal(over.status, 400);
  assert.ok(over.data.fields.amount, 'amount cannot be more than the balance');

  const first = await send({ amount: '1000', method: 'gcash', reference_number: 'GC-778812', payer_name: 'Ana Cruz' });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  proof1 = first.data.proof_id;
  const up = (body, type) => guest.post(`/api/public/pay/${tok1}/proofs/${proof1}/image`, body, { 'Content-Type': type });
  assert.equal((await up(PNG, 'text/plain')).status, 415, 'a text type is refused');
  assert.equal((await up(Buffer.from('not really a png'), 'image/png')).status, 415, 'the file header must match its type');
  const shot = await up(PNG, 'image/png');
  assert.equal(shot.status, 201, JSON.stringify(shot.data));
  file1 = shot.data.file_id;
  assert.equal((await up(PNG, 'image/png')).status, 409, 'one screenshot per proof');

  const pending = await owner.get('/api/payment-proofs?status=pending');
  assert.equal(pending.status, 200);
  const row = pending.data.proofs.find((p) => p.proof_id === proof1);
  assert.equal(row.status, 'pending');
  assert.equal(row.amount, '1000.00');
  assert.equal(row.payer_name, 'Ana Cruz');
  assert.equal(row.reference_number, 'GC-778812');
  assert.deepEqual(row.files.map((f) => f.file_id), [file1]);
  assert.ok((await owner.get(`/api/reservations/${res1.booking_id}/proofs`)).data.proofs.some((p) => p.proof_id === proof1));
  assert.ok((await sql(`SELECT 1 FROM messages WHERE direction = 'note' AND body LIKE 'The guest sent a payment proof%'`)).length >= 1, 'the host gets an inbox note');
  assert.equal((await sql(`SELECT 1 FROM audit_logs WHERE action = 'payment_proof.submitted' AND record_id = $1`, [proof1])).length, 1);
  assert.equal((await guest.get(`/api/public/pay/${tok1}`)).data.balance, '2800.00', 'a pending proof moves no money');
});

test('the host confirms a proof: a payment is recorded and the balance drops', async () => {
  const c = await owner.post(`/api/payment-proofs/${proof1}/confirm`, { send_receipt: false });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  payment1 = c.data.payment_id;
  assert.equal(c.data.receipt, null);

  const [pay] = await sql(`SELECT amount::text AS amount, payment_method, reference_number, payment_date::text AS payment_date, receipt_number
                             FROM booking_payments WHERE payment_id = $1`, [payment1]);
  assert.equal(pay.amount, '1000.00');
  assert.equal(pay.payment_method, 'gcash');
  assert.equal(pay.reference_number, 'GC-778812');
  assert.equal(pay.payment_date, manilaToday(), 'dated the day the proof was sent');
  assert.match(pay.receipt_number, /^AR-\d{6}$/);
  const [proof] = await sql('SELECT status, payment_id FROM payment_proofs WHERE proof_id = $1', [proof1]);
  assert.equal(proof.status, 'confirmed');
  assert.equal(proof.payment_id, payment1);
  assert.equal((await sql(`SELECT 1 FROM audit_logs WHERE action = 'reservation.payment_recorded' AND record_id = $1`, [payment1])).length, 1);
  assert.equal((await guest.get(`/api/public/pay/${tok1}`)).data.balance, '1800.00');

  assert.equal((await owner.post(`/api/payment-proofs/${proof1}/confirm`, {})).status, 409, 'confirmed once only');
  assert.equal((await owner.post(`/api/payment-proofs/${proof1}/reject`, { reason: 'Too late' })).status, 409);
});

test('the host rejects a proof with a reason, and the guest is emailed', async () => {
  proof2 = (await guest.post(`/api/public/pay/${tok1}/proofs`, { amount: '500', method: 'maya', reference_number: 'MY-1', payer_name: 'Ana' })).data.proof_id;
  assert.equal((await owner.post(`/api/payment-proofs/${proof2}/reject`, { reason: '' })).status, 400, 'a reason is required');
  const rj = await owner.post(`/api/payment-proofs/${proof2}/reject`, { reason: 'The reference number does not match the screenshot.' });
  assert.equal(rj.status, 200);

  const rejected = (await owner.get('/api/payment-proofs?status=rejected')).data.proofs.find((p) => p.proof_id === proof2);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.reject_reason, 'The reference number does not match the screenshot.');
  assert.equal((await owner.post(`/api/payment-proofs/${proof2}/reject`, { reason: 'Again' })).status, 409);

  const mail = outbox.find((m) => m.to === 'ana@example.com' && /could not confirm/.test(m.subject));
  assert.ok(mail, 'the guest was emailed');
  assert.match(mail.text, /does not match the screenshot/);
  assert.match(mail.text, /\/#\/pay\//, 'the email links back to the pay page');
  assert.equal((await guest.get(`/api/public/pay/${tok1}`)).data.balance, '1800.00', 'a rejection moves no money');
});

test('a confirmation is refused when the balance has dropped below the proof', async () => {
  proof3 = (await guest.post(`/api/public/pay/${tok1}/proofs`, { amount: '1800', method: 'bank_transfer', payer_name: 'Ana Cruz' })).data.proof_id;
  // The host records a cash payment meanwhile, so the balance is now below the proof.
  assert.equal((await owner.post(`/api/reservations/${res1.booking_id}/payments`, { amount: '500', payment_date: manilaToday(), payment_method: 'cash' })).status, 201);
  const refused = await owner.post(`/api/payment-proofs/${proof3}/confirm`, {});
  assert.equal(refused.status, 409);
  assert.equal(refused.data.code, 'OVER_BALANCE');
  assert.equal((await owner.post(`/api/payment-proofs/${proof3}/reject`, { reason: 'The balance was paid in cash.' })).status, 200);
});

test('staff cannot see or act on proofs; another workspace gets 404', async () => {
  assert.equal((await staff.get('/api/payment-proofs')).status, 403);
  assert.equal((await staff.get(`/api/reservations/${res1.booking_id}/proofs`)).status, 403);
  assert.equal((await staff.post(`/api/payment-proofs/${proof3}/confirm`, {})).status, 403);
  assert.equal((await staff.post(`/api/payment-proofs/${proof3}/reject`, { reason: 'x' })).status, 403);
  assert.equal((await staff.get(`/api/files/${file1}`)).status, 403, 'staff never see the screenshot');
  assert.equal((await staff.raw('POST', `/api/files?record_type=payment_proof&record_id=${proof1}`, PNG, { 'Content-Type': 'image/png' })).status, 403);
  assert.equal((await staff.raw('POST', `/api/files?record_type=booking_payment&record_id=${payment1}`, PNG, { 'Content-Type': 'image/png' })).status, 403);

  assert.equal((await manager.get('/api/payment-proofs?status=confirmed')).status, 200);
  assert.equal((await manager.get(`/api/reservations/${res1.booking_id}/proofs`)).status, 200);
  assert.equal((await manager.get(`/api/files/${file1}`)).status, 200, 'managers see the screenshot');
  assert.equal((await owner.raw('POST', `/api/files?record_type=booking_payment&record_id=${payment1}`, PNG, { 'Content-Type': 'image/png' })).status, 201, 'a receipt file can be attached to a payment');

  assert.deepEqual((await other.get('/api/payment-proofs?status=pending')).data.proofs, []);
  assert.equal((await other.get(`/api/reservations/${res1.booking_id}/proofs`)).status, 404);
  assert.equal((await other.post(`/api/payment-proofs/${proof3}/reject`, { reason: 'x' })).status, 404);
  assert.equal((await other.get(`/api/files/${file1}`)).status, 404);
});

test('the host can email a receipt when confirming', async () => {
  res2 = await booking('1202', 20, 'Ben Lim', 'ben@example.com');
  tok2 = await payToken(res2);
  const p = await guest.post(`/api/public/pay/${tok2}/proofs`, { amount: '1000', method: 'gcash', reference_number: 'GC-2', payer_name: 'Ben' });
  assert.equal(p.status, 201);
  const ok = await owner.post(`/api/payment-proofs/${p.data.proof_id}/confirm`, { send_receipt: true });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.receipt.sent, true);
  assert.ok(outbox.some((m) => m.to === 'ben@example.com' && /^Receipt AR-/.test(m.subject)), 'the receipt was emailed');
});

test('a cancelled booking refuses new proofs, screenshots and confirmations', async () => {
  res3 = await booking('1203', 30, 'Cy Tan', 'cy@example.com');
  tok3 = await payToken(res3);
  const pid = (await guest.post(`/api/public/pay/${tok3}/proofs`, { amount: '1000', method: 'other' })).data.proof_id;
  assert.equal((await owner.post(`/api/reservations/${res3.booking_id}/cancel`, { reason: 'Guest changed plans' })).status, 200);

  const late = await guest.post(`/api/public/pay/${tok3}/proofs`, { amount: '1000', method: 'gcash' });
  assert.equal(late.status, 409);
  assert.equal(late.data.code, 'CANCELLED');
  assert.equal((await guest.post(`/api/public/pay/${tok3}/proofs/${pid}/image`, PNG, { 'Content-Type': 'image/png' })).status, 409);
  assert.equal((await owner.post(`/api/payment-proofs/${pid}/confirm`, {})).status, 409);
  assert.equal((await owner.post(`/api/payment-proofs/${pid}/reject`, { reason: 'Booking cancelled' })).status, 200, 'a proof can still be closed off');
});

test('a fully paid balance refuses new proofs', async () => {
  res4 = await booking('1204', 40, 'Dee Ruiz', 'dee@example.com');
  tok4 = await payToken(res4);
  assert.equal((await owner.post(`/api/reservations/${res4.booking_id}/payments`, { amount: '4500', payment_date: manilaToday(), payment_method: 'cash' })).status, 201);
  const r = await guest.post(`/api/public/pay/${tok4}/proofs`, { amount: '100', method: 'gcash' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'PAID');
});

test('an expired link (the stay has ended) refuses new proofs', async () => {
  res5 = await booking('1205', 50, 'Eli Mora', 'eli@example.com');
  tok5 = await payToken(res5);
  await sql(`UPDATE bookings SET check_in = (now() AT TIME ZONE 'Asia/Manila')::date - 4,
                                 check_out = (now() AT TIME ZONE 'Asia/Manila')::date - 2 WHERE booking_id = $1`, [res5.booking_id]);
  const r = await guest.post(`/api/public/pay/${tok5}/proofs`, { amount: '100', method: 'gcash' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'EXPIRED');
});

test('an unknown pay link or proof is refused', async () => {
  assert.equal((await guest.post('/api/public/pay/nonsense-token-123456789/proofs', { amount: '1', method: 'gcash' })).status, 404);
  const nowhere = '00000000-0000-4000-8000-000000000000';
  assert.equal((await guest.post(`/api/public/pay/${tok1}/proofs/${nowhere}/image`, PNG, { 'Content-Type': 'image/png' })).status, 404);
});

test('screenshots are limited to 10 MB and real files; proofs are limited per link', async () => {
  res6 = await booking('1206', 60, 'Fab Diaz', 'fab@example.com');
  tok6 = await payToken(res6);
  const pid = (await guest.post(`/api/public/pay/${tok6}/proofs`, { amount: '100', method: 'gcash' })).data.proof_id;
  const huge = Buffer.alloc(10 * 1024 * 1024 + 1);
  PNG.copy(huge);
  assert.equal((await guest.post(`/api/public/pay/${tok6}/proofs/${pid}/image`, huge, { 'Content-Type': 'image/png' })).status, 413);
  assert.equal((await guest.post(`/api/public/pay/${tok6}/proofs/${pid}/image`, Buffer.from('plain text'), { 'Content-Type': 'image/jpeg' })).status, 415);

  // Ten proofs an hour per link; the eleventh is refused. Each one is rejected as it goes so the
  // five-pending cap doesn't stop the loop before the rate limit is reached.
  for (let i = 1; i < 10; i += 1) {
    const sent = await guest.post(`/api/public/pay/${tok6}/proofs`, { amount: '100', method: 'gcash' });
    assert.equal(sent.status, 201);
    await owner.post(`/api/payment-proofs/${sent.data.proof_id}/reject`, { reason: 'Test: clearing the queue' });
  }
  assert.equal((await guest.post(`/api/public/pay/${tok6}/proofs`, { amount: '100', method: 'gcash' })).status, 429);
});

// Waits until some request is queued behind a row lock, so it has started and is waiting.
async function waitForLockWait() {
  for (let i = 0; i < 200; i += 1) {
    const [{ n }] = await sql(`SELECT COUNT(*)::int AS n FROM pg_stat_activity
                                WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`);
    if (n > 0) return;
    await new Promise((ok) => setTimeout(ok, 25));
  }
  throw new Error('no request waited for the lock');
}

// Another transaction records a payment and holds the booking's lock. `act` starts while the lock
// is held and queues behind it; only then does the payment commit. So `act` must read the balance
// after the wait, not from before it.
async function paidWhile(bookingId, amount, act) {
  const held = await pool.connect();
  let pending;
  try {
    await held.query('BEGIN');
    await held.query('SELECT booking_id FROM bookings WHERE booking_id = $1 FOR UPDATE', [bookingId]);
    await held.query(`INSERT INTO booking_payments (organization_id, booking_id, amount, payment_date, payment_method, notes)
                      SELECT organization_id, booking_id, $2, $3, 'cash', 'Recorded meanwhile' FROM bookings WHERE booking_id = $1`,
    [bookingId, amount, manilaToday()]);
    pending = act();
    await waitForLockWait();
  } finally {
    await held.query('COMMIT');
    held.release();
  }
  return pending;
}

// A two-night reservation on an existing unit, `offset` days from today.
async function stay(unitId, offset, guestName, guestEmail) {
  const r = await owner.post('/api/reservations', { unit_id: unitId, check_in: d(offset), check_out: d(offset + 2), guest_name: guestName, guest_email: guestEmail });
  assert.ok(r.data.reservation, JSON.stringify(r.data));
  return r.data.reservation;
}

test('two proofs for the full balance: the second is refused once the first is confirmed', async () => {
  const b = await stay(res1.unit_id, 70, 'Gia Ramos', 'gia@example.com');
  const tok = await payToken(b);
  const full = (await guest.get(`/api/public/pay/${tok}`)).data.balance;
  const p1 = (await guest.post(`/api/public/pay/${tok}/proofs`, { amount: full, method: 'gcash', reference_number: 'GR-1' })).data.proof_id;
  const p2 = (await guest.post(`/api/public/pay/${tok}/proofs`, { amount: full, method: 'maya', reference_number: 'GR-2' })).data.proof_id;
  assert.equal((await owner.post(`/api/payment-proofs/${p1}/confirm`, {})).status, 201);
  assert.equal((await guest.get(`/api/public/pay/${tok}`)).data.balance, '0.00');
  const refused = await owner.post(`/api/payment-proofs/${p2}/confirm`, {});
  assert.equal(refused.status, 409);
  assert.equal(refused.data.code, 'OVER_BALANCE');
  assert.equal((await sql('SELECT status FROM payment_proofs WHERE proof_id = $1', [p2]))[0].status, 'pending');
});

test('a confirmation reads the balance after a payment that commits while it waits for the lock', async () => {
  const b = await stay(res1.unit_id, 74, 'Hal Cruz', 'hal@example.com');
  const tok = await payToken(b);
  const full = (await guest.get(`/api/public/pay/${tok}`)).data.balance;
  const pid = (await guest.post(`/api/public/pay/${tok}/proofs`, { amount: full, method: 'gcash', reference_number: 'HC-9' })).data.proof_id;
  const r = await paidWhile(b.booking_id, full, () => owner.post(`/api/payment-proofs/${pid}/confirm`, {}));
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'OVER_BALANCE');
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM booking_payments WHERE booking_id = $1', [b.booking_id]))[0].n, 1, 'only the other payment was recorded');
});

test('a guest proof is checked against the balance after a payment that commits while it waits', async () => {
  const b = await stay(res1.unit_id, 78, 'Lou Diaz', 'lou@example.com');
  const tok = await payToken(b);
  const full = (await guest.get(`/api/public/pay/${tok}`)).data.balance;
  const r = await paidWhile(b.booking_id, full, () => guest.post(`/api/public/pay/${tok}/proofs`, { amount: full, method: 'gcash' }));
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.ok(r.data.fields.amount, 'the amount is more than what is still owed');
});

test('a confirmation is refused when its reference number is already confirmed on the same reservation', async () => {
  const b = await stay(res1.unit_id, 82, 'Jo Reyes', 'jo@example.com');
  const tok = await payToken(b);
  const first = (await guest.post(`/api/public/pay/${tok}/proofs`, { amount: '1000', method: 'gcash', reference_number: 'GC-DUP-9' })).data.proof_id;
  const again = (await guest.post(`/api/public/pay/${tok}/proofs`, { amount: '1000', method: 'gcash', reference_number: 'GC-DUP-9' })).data.proof_id;
  assert.equal((await owner.post(`/api/payment-proofs/${first}/confirm`, {})).status, 201);
  const refused = await owner.post(`/api/payment-proofs/${again}/confirm`, {});
  assert.equal(refused.status, 409);
  assert.equal(refused.data.code, 'DUPLICATE_REFERENCE');
  assert.match(refused.data.error, /reference number/);
  assert.equal((await sql('SELECT status FROM payment_proofs WHERE proof_id = $1', [again]))[0].status, 'pending');

  // Proofs without a reference number never count as duplicates of each other.
  const n1 = (await guest.post(`/api/public/pay/${tok}/proofs`, { amount: '500', method: 'gcash' })).data.proof_id;
  const n2 = (await guest.post(`/api/public/pay/${tok}/proofs`, { amount: '500', method: 'gcash' })).data.proof_id;
  assert.equal((await owner.post(`/api/payment-proofs/${n1}/confirm`, {})).status, 201);
  assert.equal((await owner.post(`/api/payment-proofs/${n2}/confirm`, {})).status, 201);

  // The same reference on a different reservation is not a duplicate.
  const b2 = await stay(res1.unit_id, 94, 'Jo Reyes', 'jo@example.com');
  const tok2 = await payToken(b2);
  const elsewhere = (await guest.post(`/api/public/pay/${tok2}/proofs`, { amount: '1000', method: 'gcash', reference_number: 'GC-DUP-9' })).data.proof_id;
  assert.equal((await owner.post(`/api/payment-proofs/${elsewhere}/confirm`, {})).status, 201);
});

test('a guest can have at most five proofs waiting for the host', async () => {
  const b = await stay(res1.unit_id, 86, 'Kim Lopez', 'kim@example.com');
  const tok = await payToken(b);
  const sent = [];
  for (let i = 1; i <= 5; i += 1) {
    const r = await guest.post(`/api/public/pay/${tok}/proofs`, { amount: '100', method: 'gcash', reference_number: `KL-${i}` });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    sent.push(r.data.proof_id);
  }
  const sixth = await guest.post(`/api/public/pay/${tok}/proofs`, { amount: '100', method: 'gcash', reference_number: 'KL-6' });
  assert.equal(sixth.status, 409);
  assert.equal(sixth.data.code, 'TOO_MANY_PENDING');
  assert.match(sixth.data.error, /waiting for the host/);
  // Once the host has reviewed one, the guest can send another.
  assert.equal((await owner.post(`/api/payment-proofs/${sent[0]}/reject`, { reason: 'Not received yet.' })).status, 200);
  assert.equal((await guest.post(`/api/public/pay/${tok}/proofs`, { amount: '100', method: 'gcash', reference_number: 'KL-6' })).status, 201);
});

test("the guest's bill leaves out the host's channel fee, but the balance still takes it off", async () => {
  const b = (await owner.post('/api/reservations', {
    unit_id: res1.unit_id, check_in: d(120), check_out: d(122), guest_name: 'Ivy Tan', guest_email: 'ivy@example.com', channel: 'airbnb', channel_fee: '400',
  })).data.reservation;
  const pg = await guest.get(`/api/public/pay/${await payToken(b)}`);
  assert.equal(pg.data.total, '4500.00');
  assert.equal(pg.data.balance, '4100.00');
  assert.equal(Object.hasOwn(pg.data.bill, 'channel_fee'), false, 'the guest never sees the platform fee');
});

test('downloads of a payment screenshot or receipt are audited, as leases are', async () => {
  const receipt = await owner.raw('POST', `/api/files?record_type=booking_payment&record_id=${payment1}`, PNG, { 'Content-Type': 'image/png' });
  assert.equal(receipt.status, 201, JSON.stringify(receipt.data));
  assert.equal((await manager.get(`/api/files/${receipt.data.file.file_id}`)).status, 200);
  assert.equal((await manager.get(`/api/files/${file1}`)).status, 200);
  const downloads = await sql(`SELECT record_type, record_id FROM audit_logs WHERE action = 'file.downloaded' ORDER BY audit_id`);
  assert.deepEqual(downloads.slice(-2), [
    { record_type: 'booking_payment', record_id: payment1 },
    { record_type: 'payment_proof', record_id: proof1 },
  ]);
});
