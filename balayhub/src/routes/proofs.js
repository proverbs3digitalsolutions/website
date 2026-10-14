'use strict';

// Guest payment proofs for manual payments (GCash, Maya, bank transfer). A guest who
// paid sends the amount, method, reference and a screenshot from their pay page. The
// host checks it, then either confirms it (which records the payment on the reservation)
// or rejects it with a reason. Also the workspace's manual-payment settings (owner only).

const express = require('express');
const config = require('../config');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole, rateLimit } = require('../lib/auth');
const { propertyScope } = require('../lib/access');
const { notify, propertyOfBooking } = require('../lib/push');
const { mailEnabled } = require('../lib/mailer');
const messaging = require('../lib/messaging');
const receipts = require('../lib/receipts');
const storage = require('../lib/storage');
const { BALANCE, loadByToken, manualRefusal, closeOpenCheckouts, ensurePayToken, payLink } = require('./balancepay');

const router = express.Router();
const publicRouter = express.Router();
const managers = requireRole('owner', 'manager');
const owners = requireRole('owner');

const METHODS = ['gcash', 'maya', 'bank_transfer', 'other'];
const STATUSES = ['pending', 'confirmed', 'rejected'];
const MAX_PENDING_PROOFS = 5; // per reservation, so a guest can't flood the host's queue
const METHOD_LABEL = { gcash: 'GCash', maya: 'Maya', bank_transfer: 'bank transfer', other: 'another method' };
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });

const PROOF_SELECT = `SELECT pp.proof_id, pp.booking_id, pp.amount, pp.method, pp.reference_number, pp.payer_name, pp.status,
       pp.submitted_at, pp.reviewed_at, pp.reject_reason, b.status AS booking_status, b.confirmation_code, b.check_in, b.check_out,
       ${BALANCE} AS balance, u.unit_name, p.property_name, COALESCE(g.full_name, b.guest_label, 'Guest') AS guest_name
  FROM payment_proofs pp
  JOIN bookings b ON b.booking_id = pp.booking_id
  JOIN units u ON u.unit_id = b.unit_id
  JOIN properties p ON p.property_id = u.property_id
  LEFT JOIN guests g ON g.guest_id = b.guest_id`;

// Attach each proof's screenshots (file ids, served by routes/files.js) to its row.
async function withFiles(rows) {
  if (!rows.length) return rows;
  const { rows: files } = await query(
    `SELECT file_id, file_name, mime_type, related_record_id FROM files
      WHERE related_record_type = 'payment_proof' AND related_record_id = ANY($1::uuid[]) ORDER BY uploaded_at`,
    [rows.map((r) => r.proof_id)]);
  return rows.map((r) => ({
    ...r,
    files: files.filter((f) => f.related_record_id === r.proof_id).map((f) => ({ file_id: f.file_id, file_name: f.file_name, mime_type: f.mime_type })),
  }));
}

// A reservation the user may see, or 404.
async function loadScopedBooking(user, id) {
  const params = [id];
  const row = await one(
    `SELECT b.booking_id FROM bookings b JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
      WHERE b.booking_id = $1 AND b.kind = 'reservation' AND ${propertyScope(user, params)}`, params);
  if (!row) throw notFound();
}

// A proof and its booking, locked until the transaction ends; 404 unless the user may see it.
// The lock is taken in its own statement. The balance is read in a second one, because under
// READ COMMITTED a statement that waits for a lock keeps the snapshot it started with, so it
// would miss a payment that committed while it waited.
async function lockProof(user, id, db) {
  const params = [id];
  const { rows: [locked] } = await db.query(
    `SELECT pp.proof_id
       FROM payment_proofs pp
       JOIN bookings b ON b.booking_id = pp.booking_id
       JOIN units u ON u.unit_id = b.unit_id
       JOIN properties p ON p.property_id = u.property_id
      WHERE pp.proof_id = $1 AND ${propertyScope(user, params)}
      FOR UPDATE OF pp, b`, params);
  if (!locked) throw notFound();
  const { rows: [p] } = await db.query(
    `SELECT pp.*, b.status AS booking_status, (pp.submitted_at AT TIME ZONE 'Asia/Manila')::date AS submitted_on,
            ${BALANCE} AS balance, (pp.amount > ${BALANCE}) AS over_balance
       FROM payment_proofs pp
       JOIN bookings b ON b.booking_id = pp.booking_id
      WHERE pp.proof_id = $1`, [id]);
  return p;
}

// ---------------------------------------------------------------- host side (owners and managers)
// Proofs waiting for a decision (or another status), for the properties the user may see.
router.get('/payment-proofs', managers, ah(async (req, res) => {
  const { status } = validate(req.query, { status: { type: 'enum', values: STATUSES, label: 'Status' } });
  const params = [status || 'pending'];
  const { rows } = await query(`${PROOF_SELECT} WHERE pp.status = $1 AND ${propertyScope(req.user, params)} ORDER BY pp.submitted_at`, params);
  res.json({ proofs: await withFiles(rows) });
}));

// Every proof on one reservation, newest first.
router.get('/reservations/:id/proofs', managers, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  await loadScopedBooking(req.user, id);
  const { rows } = await query(`${PROOF_SELECT} WHERE pp.booking_id = $1 ORDER BY pp.submitted_at DESC`, [id]);
  res.json({ proofs: await withFiles(rows) });
}));

// Confirm a proof: records the payment the guest sent, the same way recording a payment does.
router.post('/payment-proofs/:id/confirm', managers, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const body = validate(req.body, { send_receipt: { type: 'bool', label: 'Email receipt' } });
  const done = await tx(async (db) => {
    const p = await lockProof(req.user, id, db);
    if (p.status !== 'pending') throw new HttpError(409, `This payment proof was already ${p.status}.`, { code: 'NOT_PENDING' });
    if (p.booking_status !== 'confirmed') throw new HttpError(409, 'This reservation is cancelled. Payments cannot be recorded on it.', { code: 'CANCELLED' });
    if (p.over_balance) {
      throw new HttpError(409, `The balance is now ${messaging.fmtPeso(p.balance)}, so this proof for ${messaging.fmtPeso(p.amount)} is more than is owed. Reject it, or record a smaller payment by hand.`, { code: 'OVER_BALANCE' });
    }
    if (p.reference_number) {
      // ponytail: exact match, so case and spaces count; normalise the reference if the host reports misses.
      const { rows: [dup] } = await db.query(
        `SELECT 1 FROM payment_proofs WHERE booking_id = $1 AND status = 'confirmed' AND reference_number = $2 LIMIT 1`,
        [p.booking_id, p.reference_number]);
      if (dup) {
        throw new HttpError(409, 'A payment with this reference number is already confirmed on this reservation. If this is the same payment, reject this proof.', { code: 'DUPLICATE_REFERENCE' });
      }
    }
    const receiptNumber = await receipts.nextReceiptNumber(db, p.organization_id);
    const { rows: [pay] } = await db.query(
      `INSERT INTO booking_payments (organization_id, booking_id, amount, payment_date, payment_method, reference_number, notes, recorded_by, receipt_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING payment_id`,
      [p.organization_id, p.booking_id, p.amount, p.submitted_on, p.method, p.reference_number,
        'Confirmed from a payment proof the guest sent', req.user.user_id, receiptNumber]);
    await db.query(`UPDATE payment_proofs SET status = 'confirmed', reviewed_by = $2, reviewed_at = now(), payment_id = $3 WHERE proof_id = $1`,
      [id, req.user.user_id, pay.payment_id]);
    await audit(db, req.user, 'reservation.payment_recorded', 'booking_payment', pay.payment_id,
      { booking_id: p.booking_id, amount: p.amount, receipt: receiptNumber, proof_id: id });
    return { paymentId: pay.payment_id, bookingId: p.booking_id };
  });
  // The amount owed just changed: a guest's open PayMongo checkout must not still ask for the old amount.
  await closeOpenCheckouts(done.bookingId);
  const receipt = body.send_receipt ? await receipts.sendReceipt(done.paymentId, req.user) : null;
  res.status(201).json({ ok: true, payment_id: done.paymentId, receipt });
}));

// Reject a proof with a reason. The guest gets the reason by email if they have an address.
router.post('/payment-proofs/:id/reject', managers, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const { reason } = validate(req.body, { reason: { type: 'string', required: true, max: 300, label: 'Reason' } });
  const p = await tx(async (db) => {
    const row = await lockProof(req.user, id, db);
    if (row.status !== 'pending') throw new HttpError(409, `This payment proof was already ${row.status}.`, { code: 'NOT_PENDING' });
    await db.query(`UPDATE payment_proofs SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), reject_reason = $3 WHERE proof_id = $1`,
      [id, req.user.user_id, reason]);
    await audit(db, req.user, 'payment_proof.rejected', 'payment_proof', id, { booking_id: row.booking_id, amount: row.amount, reason });
    return row;
  });
  await tellGuestRejected(req.user, p, reason).catch((err) => console.error('[proofs] reject email failed:', err.message));
  res.json({ ok: true });
}));

async function tellGuestRejected(user, p, reason) {
  const ctx = await messaging.bookingContext(p.booking_id);
  if (!ctx?.guest_email || !mailEnabled()) return;
  const amount = messaging.fmtPeso(p.amount);
  const firstName = String(ctx.guest_name || '').split(' ')[0] || 'there';
  const link = payLink(await ensurePayToken(p.booking_id));
  await messaging.queueMessage({
    bookingId: p.booking_id, user, kind: 'message',
    subject: `We could not confirm your payment of ${amount}`,
    body: `Hi ${firstName},\n\n${ctx.workspace_name} could not confirm the ${amount} payment you sent for ${ctx.unit_name} `
      + `(${messaging.fmtDate(ctx.check_in)} to ${messaging.fmtDate(ctx.check_out)}).\n\nReason: ${reason}\n\n`
      + `You can send the payment proof again from your payment page: ${link}\n\n${ctx.workspace_name}`,
  });
}

// The workspace's manual-payment settings: owner only.
router.get('/workspace/manual-payments', owners, ah(async (req, res) => {
  const o = await one('SELECT manual_payments_enabled, manual_payment_instructions FROM organizations WHERE organization_id = $1', [req.user.organization_id]);
  res.json({ enabled: o.manual_payments_enabled, instructions: o.manual_payment_instructions });
}));

// Partial: only the fields sent change. Enabling needs details, saved or sent with this save.
router.patch('/workspace/manual-payments', owners, ah(async (req, res) => {
  const body = validate(req.body, {
    enabled: { type: 'bool', label: 'Accept manual payments' },
    instructions: { type: 'text', max: 1000, label: 'Payment details' },
  }, { partial: true });
  const saved = await tx(async (db) => {
    // Locked, so two saves at once can't each check against stale values.
    const { rows: [cur] } = await db.query(
      'SELECT manual_payments_enabled, manual_payment_instructions FROM organizations WHERE organization_id = $1 FOR UPDATE', [req.user.organization_id]);
    const next = {
      enabled: 'enabled' in body ? body.enabled : cur.manual_payments_enabled,
      instructions: 'instructions' in body ? body.instructions : cur.manual_payment_instructions,
    };
    if (next.enabled && !next.instructions) {
      throw validationError({ instructions: 'Add the GCash number, bank name or account name guests should pay to.' });
    }
    // Nothing changed: no write and no audit row.
    if (next.enabled === cur.manual_payments_enabled && next.instructions === cur.manual_payment_instructions) return next;
    await db.query('UPDATE organizations SET manual_payments_enabled = $2, manual_payment_instructions = $3 WHERE organization_id = $1',
      [req.user.organization_id, next.enabled, next.instructions]);
    await audit(db, req.user, 'workspace.manual_payments_updated', 'organization', req.user.organization_id, { enabled: next.enabled });
    return next;
  });
  res.json(saved);
}));

// ---------------------------------------------------------------- guest side (public, by pay link)
// Per link: at most 10 proofs an hour, and 30 screenshot uploads, whatever the IP.
const proofLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, key: (req) => `proof|${req.params.token}` });
const proofUploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, key: (req) => `proof-upload|${req.params.token}` });

// Step 1: the payment details. The screenshot follows in step 2 (same shape as check-in: form first, then photos).
publicRouter.post('/public/pay/:token/proofs', proofLimiter, express.json({ limit: '20kb' }), ah(async (req, res) => {
  const b = await loadByToken(req.params.token);
  const refusal = manualRefusal(b);
  if (refusal) throw refusal;
  const body = validate(req.body, {
    amount: { type: 'money', required: true, positive: true, label: 'Amount' },
    method: { type: 'enum', values: METHODS, required: true, label: 'Payment method' },
    reference_number: { type: 'string', max: 100, label: 'Reference number' },
    payer_name: { type: 'string', max: 120, label: 'Name of payer' },
  });
  const proofId = await tx(async (db) => {
    // Lock the booking, then check the amount against what is owed now, not what the page showed.
    // The balance is read after the lock (see lockProof) so a payment that just committed counts.
    await db.query('SELECT booking_id FROM bookings WHERE booking_id = $1 FOR UPDATE', [b.booking_id]);
    const { rows: [now] } = await db.query(
      `SELECT ${BALANCE} AS balance, $2::numeric <= ${BALANCE} AS within FROM bookings b WHERE b.booking_id = $1`,
      [b.booking_id, body.amount]);
    if (!now.within) throw validationError({ amount: `This is more than the ${messaging.fmtPeso(now.balance)} still owed.` });
    const { rows: [{ waiting }] } = await db.query(
      `SELECT COUNT(*)::int AS waiting FROM payment_proofs WHERE booking_id = $1 AND status = 'pending'`, [b.booking_id]);
    if (waiting >= MAX_PENDING_PROOFS) {
      throw new HttpError(409, `There are already ${MAX_PENDING_PROOFS} payment proofs waiting for the host to check. Please wait for the host to review them before you send another.`, { code: 'TOO_MANY_PENDING' });
    }
    const { rows: [p] } = await db.query(
      `INSERT INTO payment_proofs (organization_id, booking_id, amount, method, reference_number, payer_name)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING proof_id`,
      [b.organization_id, b.booking_id, body.amount, body.method, body.reference_number, body.payer_name]);
    await audit(db, { organization_id: b.organization_id }, 'payment_proof.submitted', 'payment_proof', p.proof_id,
      { booking_id: b.booking_id, amount: body.amount, method: body.method });
    return p.proof_id;
  });
  await tellHost(b, body.amount, body.method);
  res.status(201).json({ ok: true, proof_id: proofId });
}));

// Step 2: the screenshot or receipt for a proof just sent (JPG, PNG, WEBP or PDF, up to 10 MB).
publicRouter.post('/public/pay/:token/proofs/:proofId/image', proofUploadLimiter,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], limit: config.maxUploadBytes }), ah(async (req, res) => {
    const b = await loadByToken(req.params.token);
    const refusal = manualRefusal(b);
    if (refusal) throw refusal;
    const proofId = uuidParam(req.params.proofId);
    const mime = String(req.get('Content-Type') || '').split(';')[0].trim();
    if (!storage.checkUpload(mime, req.body)) {
      throw new HttpError(415, 'Upload a JPG, PNG, WEBP or PDF file up to 10 MB.', { code: 'UNSUPPORTED_FILE' });
    }
    const file = await tx(async (db) => {
      const { rows: [p] } = await db.query('SELECT proof_id, status FROM payment_proofs WHERE proof_id = $1 AND booking_id = $2 FOR UPDATE', [proofId, b.booking_id]);
      if (!p) throw notFound('This payment proof was not found. Please send it again.');
      if (p.status !== 'pending') throw new HttpError(409, 'This payment proof has already been reviewed.', { code: 'NOT_PENDING' });
      const { rows: [{ n }] } = await db.query(`SELECT COUNT(*)::int AS n FROM files WHERE related_record_type = 'payment_proof' AND related_record_id = $1`, [proofId]);
      if (n >= 1) throw new HttpError(409, 'This payment proof already has a screenshot.', { code: 'TOO_MANY' });
      const saved = await storage.saveFile({
        organizationId: b.organization_id, recordType: 'payment_proof', recordId: proofId, body: req.body, mime,
        fileName: `payment-proof.${storage.ALLOWED[mime].ext}`, db,
      });
      await audit(db, { organization_id: b.organization_id }, 'payment_proof.image_added', 'payment_proof', proofId, { file_id: saved.file_id });
      return saved;
    });
    res.status(201).json({ ok: true, file_id: file.file_id });
  }));

// Tell the host a proof came in: a push notification and a note in the reservation's inbox.
async function tellHost(b, amount, method) {
  try {
    await notify(b.organization_id, 'payment', {
      title: `Payment to check · ${messaging.fmtPeso(amount)}`, body: `${METHOD_LABEL[method]} · ${b.unit_name}, ${b.check_in}`,
      url: `/#/reservations/${b.booking_id}`, propertyId: await propertyOfBooking(b.booking_id),
    });
    const conv = await messaging.getOrCreateConversation(b.booking_id);
    await query(`INSERT INTO messages (conversation_id, organization_id, direction, from_name, body, status) VALUES ($1,$2,'note','BalayHub',$3,'note')`,
      [conv.conversation_id, conv.organization_id, `The guest sent a payment proof: ${messaging.fmtPeso(amount)} by ${METHOD_LABEL[method]}. Check it on the reservation page.`]);
    await query(`UPDATE conversations SET unread = true, status = 'open', snoozed_until = NULL, last_message_at = now() WHERE conversation_id = $1`, [conv.conversation_id]);
  } catch (err) {
    console.error('[proofs] host notice failed:', err.message);
  }
}

module.exports = { router, publicRouter };
