'use strict';

// The guest balance, written once (D-85): total, less the channel fee on a booking that came through a channel
// (a direct booking owes its full total, D-78), less non-voided payments, plus non-voided refunds. Negative means
// the guest is still overpaid after refunds. Every SQL that needs a balance interpolates these; the booking row
// must be aliased `b`. Money stays in SQL so the centavos are exact.
const FEE = `CASE WHEN b.channel = 'direct' THEN 0 ELSE b.channel_fee END`;
const PAID = `COALESCE((SELECT SUM(x.amount) FROM booking_payments x WHERE x.booking_id = b.booking_id AND x.voided_at IS NULL), 0)`;
const REFUNDED = `COALESCE((SELECT SUM(r.amount) FROM booking_refunds r WHERE r.booking_id = b.booking_id AND r.voided_at IS NULL), 0)`;
const BALANCE = `(b.total_amount - ${FEE} - ${PAID} + ${REFUNDED})::numeric(12,2)`;

module.exports = { FEE, PAID, REFUNDED, BALANCE };
