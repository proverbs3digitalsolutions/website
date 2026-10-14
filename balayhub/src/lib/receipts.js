'use strict';

// Guest acknowledgement receipts and booking confirmations, emailed through
// the reservation's inbox conversation so they appear in the guest thread.

const { pool, one, query, tx } = require('../db');
const { mailEnabled } = require('./mailer');
const messaging = require('./messaging');
const { FEE, REFUNDED } = require('./balance');

const METHOD = { cash: 'Cash', bank_transfer: 'Bank transfer', gcash: 'GCash', maya: 'Maya', card: 'Card', channel_payout: 'Channel payout', other: 'Other' };

// Next receipt number for a workspace (inside the payment's transaction).
async function nextReceiptNumber(db, organizationId) {
  const { rows: [r] } = await db.query(
    `INSERT INTO receipt_counters (organization_id, last_number) VALUES ($1, 1)
     ON CONFLICT (organization_id) DO UPDATE SET last_number = receipt_counters.last_number + 1 RETURNING last_number`,
    [organizationId]);
  return `AR-${String(r.last_number).padStart(6, '0')}`;
}

async function receiptData(paymentId) {
  // Payments recorded before receipts existed get a number the first time it's needed.
  await tx(async (db) => {
    const { rows: [p] } = await db.query('SELECT organization_id, receipt_number FROM booking_payments WHERE payment_id = $1 FOR UPDATE', [paymentId]);
    if (p && !p.receipt_number) {
      await db.query('UPDATE booking_payments SET receipt_number = $2 WHERE payment_id = $1', [paymentId, await nextReceiptNumber(db, p.organization_id)]);
    }
  });
  const r = await one(
    `SELECT bp.*, b.confirmation_code, b.check_in, b.check_out, b.total_amount, b.extras_total, b.guest_id,
            COALESCE(g.full_name, b.guest_label, 'Guest') AS guest_name, g.email AS guest_email,
            u.unit_name, p.property_name, o.name AS workspace_name, ru.full_name AS recorded_by_name,
            (${FEE})::numeric(12,2) AS adjustments,
            (b.total_amount - ${FEE} + ${REFUNDED} - COALESCE((SELECT SUM(x.amount) FROM booking_payments x WHERE x.booking_id = b.booking_id AND x.voided_at IS NULL
                                          AND (x.payment_date, x.created_at) <= (bp.payment_date, bp.created_at)), 0))::numeric(12,2) AS balance_after
       FROM booking_payments bp
       JOIN bookings b ON b.booking_id = bp.booking_id
       JOIN units u ON u.unit_id = b.unit_id
       JOIN properties p ON p.property_id = u.property_id
       JOIN organizations o ON o.organization_id = b.organization_id
       LEFT JOIN guests g ON g.guest_id = b.guest_id
       LEFT JOIN users ru ON ru.user_id = bp.recorded_by
      WHERE bp.payment_id = $1`, [paymentId]);
  if (r) {
    r.charges = (await query(
      `SELECT description, quantity, unit_price, amount FROM booking_charges
        WHERE booking_id = $1 AND voided_at IS NULL ORDER BY created_at, charge_id`, [r.booking_id])).rows;
  }
  return r;
}

function receiptText(r) {
  const charges = r.charges.length ? [
    '',
    'Itemised charges:',
    ...r.charges.map((c) => `  ${c.description}${c.quantity > 1 ? ` (${c.quantity} × ${messaging.fmtPeso(c.unit_price)})` : ''}: ${messaging.fmtPeso(c.amount)}`),
    `  Extras total: ${messaging.fmtPeso(r.extras_total)}`,
  ] : [];
  // A channel's fee is settled by the channel, so the remaining balance is net of it; show it so the lines add up.
  const adjustment = Number(r.adjustments) > 0 ? [`Adjustments (settled through the booking channel): -${messaging.fmtPeso(r.adjustments)}`] : [];
  return [
    `ACKNOWLEDGEMENT RECEIPT ${r.receipt_number}`,
    `${r.workspace_name}`,
    '',
    `Received from: ${r.guest_name}`,
    `Amount: ${messaging.fmtPeso(r.amount)}`,
    `Date received: ${messaging.fmtDate(r.payment_date)}`,
    `Payment method: ${METHOD[r.payment_method] || r.payment_method}${r.reference_number ? ` (Ref. ${r.reference_number})` : ''}`,
    '',
    `For: ${r.unit_name}, ${r.property_name}`,
    `Stay: ${messaging.fmtDate(r.check_in)} – ${messaging.fmtDate(r.check_out)} · Booking ${r.confirmation_code}`,
    ...charges,
    `Booking total: ${messaging.fmtPeso(r.total_amount)}`,
    ...adjustment,
    `Remaining balance: ${messaging.fmtPeso(Math.max(0, Number(r.balance_after)))}`,
    '',
    'Thank you for your payment!',
    '',
    'This is an acknowledgement receipt for your records, not a BIR official receipt.',
  ].join('\n');
}

const why = (r) => {
  if (!r.guest_email) return 'The guest has no email address.';
  if (!mailEnabled()) return 'Email sending is not set up on the server.';
  return null;
};

// Email a payment receipt to the guest. Returns { sent, error }.
async function sendReceipt(paymentId, user) {
  const r = await receiptData(paymentId);
  if (!r) return { sent: false, error: 'Payment not found.' };
  if (r.voided_at) return { sent: false, error: 'This payment was voided.' };
  const blocked = why(r);
  if (blocked) return { sent: false, error: blocked };
  const res = await messaging.queueMessage({
    bookingId: r.booking_id, user, kind: 'receipt',
    subject: `Receipt ${r.receipt_number} — ${messaging.fmtPeso(r.amount)} received for your stay at ${r.unit_name}`,
    body: receiptText(r),
  });
  if (res.message.status !== 'sent') return { sent: false, error: res.message.error || 'The email could not be sent.' };
  await query('UPDATE booking_payments SET receipt_sent_at = now() WHERE payment_id = $1', [paymentId]);
  return { sent: true };
}

// Mark "on booking" automations that use the confirmation template as done for
// this stay, so the confirmation is never sent twice.
async function claimConfirmation(db, bookingId, organizationId) {
  await db.query(
    `INSERT INTO automation_runs (automation_id, booking_id, skipped)
     SELECT a.automation_id, $1, 'sent manually' FROM automations a JOIN message_templates t USING (template_id)
      WHERE a.organization_id = $2 AND a.trigger_event = 'booking_created' AND t.system_key = 'confirmation'
     ON CONFLICT DO NOTHING`, [bookingId, organizationId]);
}

// Email the booking confirmation (the workspace's "Booking confirmation" template).
async function sendConfirmation(bookingId, user) {
  const ctx = await messaging.bookingContext(bookingId);
  if (!ctx) return { sent: false, error: 'Reservation not found.' };
  await messaging.ensureDefaults(ctx.organization_id);
  await claimConfirmation(pool, bookingId, ctx.organization_id);
  const release = () => query(
    `DELETE FROM automation_runs WHERE booking_id = $1 AND skipped = 'sent manually' AND message_id IS NULL`, [bookingId]);
  const blocked = why({ guest_email: ctx.guest_email });
  if (blocked) { await release(); return { sent: false, error: blocked }; }
  const t = await one(`SELECT template_id FROM message_templates WHERE organization_id = $1 AND system_key = 'confirmation'`, [ctx.organization_id]);
  const out = await messaging.renderTemplateFor(t.template_id, bookingId, user?.full_name);
  const res = await messaging.queueMessage({ bookingId, user, kind: 'confirmation', subject: out.subject, body: out.body });
  if (res.message.status !== 'sent') {
    await release(); // let the automatic message try later instead
    return { sent: false, error: res.message.error || 'The email could not be sent.' };
  }
  return { sent: true };
}

module.exports = { claimConfirmation, nextReceiptNumber, receiptData, receiptText, sendReceipt, sendConfirmation };
