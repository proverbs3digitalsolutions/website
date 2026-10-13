'use strict';

// Monthly owner statement: stays that checked out in the month on the owner's
// units, less channel fees, cleaning fees (when the manager keeps them) and refunds
// paid in the month, then the management fee (D-40), the units' expenses and the
// repairs reserve top-up (D-43), giving the owner's payout. Money is worked in centavos.
//
// Publishing freezes this result in owner_statements.snapshot. The snapshot is the
// published copy: the owner portal and the emailed statement show it, never live numbers.

const { query } = require('../db');

const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const cents = (v) => Math.round(Number(v || 0) * 100);
const money = (c) => (c / 100).toFixed(2);

function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); // first day of next month
  return { start, end };
}

// Statements are published, and reminded about, only once their month is over in Manila time.
const monthHasEnded = (month) => month < manilaToday().slice(0, 7);

// Repairs reserve balance in centavos: non-voided deposits minus non-voided withdrawals.
// This month's own statement deposit is left out, so its top-up is the same before and after publishing.
async function reserveBalance(db, ownerId, month) {
  const { rows: [r] } = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN e.kind = 'deposit' THEN e.amount ELSE -e.amount END), 0) AS bal
       FROM owner_reserve_entries e
      WHERE e.owner_id = $1 AND e.voided_at IS NULL
        AND (e.kind = 'withdrawal' OR e.statement_id IS NULL OR e.statement_id NOT IN
             (SELECT s.statement_id FROM owner_statements s WHERE s.owner_id = $1 AND s.month = $2))`,
    [ownerId, month]);
  return cents(r.bal);
}

// D-40: net_pct is today's rule; gross_pct is a share of gross after refunds; flat is a fixed
// monthly fee in any month the owner has an active unit. The fee is never negative.
function managementFee(owner, { net, grossAfterRefunds, hasUnits }) {
  if (owner.fee_model === 'flat') {
    return { fee: hasUnits ? cents(owner.flat_monthly_fee) : 0, label: 'Management fee (flat)' };
  }
  const pct = Number(owner.management_fee_pct);
  const onGross = owner.fee_model === 'gross_pct';
  const base = onGross ? grossAfterRefunds : net;
  return {
    fee: Math.round((Math.max(base, 0) * pct) / 100),
    label: `Management fee (${pct}% of ${onGross ? 'gross' : 'net'})`,
  };
}

// `db` is a transaction client when publishing, so the numbers are read under the owner's lock.
async function ownerStatement(orgId, ownerId, month, db = { query }) {
  const owner = (await db.query('SELECT * FROM unit_owners WHERE owner_id = $1 AND organization_id = $2', [ownerId, orgId])).rows[0];
  if (!owner) return null;
  const org = (await db.query('SELECT name FROM organizations WHERE organization_id = $1', [orgId])).rows[0];
  const { start, end } = monthBounds(month);
  const { rows: units } = await db.query(
    `SELECT u.unit_id, u.unit_name, u.status, p.property_name FROM units u JOIN properties p USING (property_id)
      WHERE u.owner_id = $1 AND p.organization_id = $2 ORDER BY p.property_name, u.unit_name`, [ownerId, orgId]);
  const hasUnits = units.some((u) => u.status === 'active');
  const ids = units.map((u) => u.unit_id);
  const { rows: stays } = await db.query(
    `SELECT b.booking_id, b.unit_id, u.unit_name, b.check_in::text, b.check_out::text, (b.check_out - b.check_in) AS nights, b.channel,
            b.confirmation_code, split_part(COALESCE(g.full_name, b.guest_label, 'Guest'), ' ', 1) AS guest_first_name,
            b.accommodation_total, b.cleaning_fee, b.other_fees, b.total_amount, b.channel_fee
       FROM bookings b JOIN units u USING (unit_id) LEFT JOIN guests g ON g.guest_id = b.guest_id
      WHERE b.unit_id = ANY($1) AND b.kind = 'reservation' AND b.status = 'confirmed' AND b.check_out >= $2 AND b.check_out < $3
        AND b.check_out <= $4  -- only stays that have ended
      ORDER BY b.check_out, u.unit_name`, [ids, start, end, manilaToday()]);
  const { rows: expenses } = await db.query(
    `SELECT e.expense_id, e.expense_date::text, e.category, e.description, e.vendor_name, e.amount, u.unit_name,
            e.receipt_file_id, (e.receipt_file_id IS NOT NULL) AS has_receipt
       FROM expenses e JOIN units u ON u.unit_id = e.unit_id
      WHERE e.unit_id = ANY($1) AND e.voided_at IS NULL AND e.expense_date >= $2 AND e.expense_date < $3
      ORDER BY e.expense_date`, [ids, start, end]);

  // Refunds dated in the month on confirmed stays of these units (cancelled stays were never in
  // the gross, so their refunds don't touch the owner). Refunding an overpayment does not reduce
  // the owner's income: the bill already dropped by that amount when the charge was voided (D-32).
  // So each booking loses only the refunds that go beyond its overpayment.
  const { rows: refundRows } = await db.query(
    `SELECT b.booking_id, b.total_amount, SUM(r.amount) AS in_period,
            COALESCE((SELECT SUM(p.amount) FROM booking_payments p WHERE p.booking_id = b.booking_id AND p.voided_at IS NULL), 0) AS paid,
            COALESCE((SELECT SUM(x.amount) FROM booking_refunds x WHERE x.booking_id = b.booking_id AND x.voided_at IS NULL AND x.refund_date < $2), 0) AS before_period
       FROM booking_refunds r JOIN bookings b ON b.booking_id = r.booking_id
      WHERE b.unit_id = ANY($1) AND b.kind = 'reservation' AND b.status = 'confirmed'
        AND r.voided_at IS NULL AND r.refund_date >= $2 AND r.refund_date < $3
      GROUP BY b.booking_id, b.total_amount`, [ids, start, end]);
  const refunds = refundRows.reduce((s, r) => {
    const over = Math.max(0, cents(r.paid) - cents(r.total_amount));
    const before = cents(r.before_period);
    return s + Math.max(0, before + cents(r.in_period) - over) - Math.max(0, before - over);
  }, 0);

  let gross = 0; let channelFees = 0; let cleaning = 0;
  const lines = stays.map((s) => {
    const g = cents(s.total_amount); const cf = cents(s.channel_fee);
    const cl = owner.cleaning_to_manager ? cents(s.cleaning_fee) : 0;
    gross += g; channelFees += cf; cleaning += cl;
    return { ...s, net: money(g - cf - cl), missing_amount: g === 0 };
  });
  const net = gross - channelFees - cleaning - refunds;
  // The management fee is worked out on what is left after refunds, so it doesn't apply to money given back.
  const { fee, label } = managementFee(owner, { net, grossAfterRefunds: gross - refunds, hasUnits });
  const exp = expenses.reduce((s, e) => s + cents(e.amount), 0);
  // D-43: the top-up is the smallest of the monthly amount, what is left to reach the target, and the
  // payout before the top-up. It is never below 0, so a target of 0 switches the reserve off.
  const beforeTopup = net - fee - exp;
  const reserveBal = await reserveBalance(db, ownerId, month);
  const target = cents(owner.reserve_target);
  const monthly = cents(owner.reserve_monthly);
  const topup = Math.max(0, Math.min(monthly, target - reserveBal, beforeTopup));
  const nights = stays.reduce((s, x) => s + Number(x.nights), 0);
  const days = (Date.parse(end) - Date.parse(start)) / 86400000;
  return {
    month, period: { start, end_exclusive: end },
    workspace: org.name,
    fee_label: label,
    owner: {
      owner_id: owner.owner_id, full_name: owner.full_name, email: owner.email, management_fee_pct: owner.management_fee_pct,
      cleaning_to_manager: owner.cleaning_to_manager, fee_model: owner.fee_model, flat_monthly_fee: owner.flat_monthly_fee,
    },
    units, stays: lines, expenses,
    // Outside totals so the totals keep their shape; net_rental and payout already include it.
    refunded: money(refunds),
    reserve: { balance: money(reserveBal), target: money(target), monthly: money(monthly), topup: money(topup) },
    totals: {
      stays: stays.length, nights, occupancy_pct: units.length ? Math.min(100, Math.round((100 * nights) / (units.length * days))) : 0,
      gross: money(gross), channel_fees: money(channelFees), cleaning_fees: money(cleaning), net_rental: money(net),
      management_fee: money(fee), expenses: money(exp), payout: money(beforeTopup - topup),
    },
    missing_amounts: lines.filter((l) => l.missing_amount).length,
  };
}

// Makes sure every owner with an active unit has a draft statement row for the month, publishing nothing.
// Returns how many of the workspace's active owners have a draft or published row for that month.
async function draftMonth(orgId, month) {
  await query(
    `INSERT INTO owner_statements (organization_id, owner_id, month)
     SELECT o.organization_id, o.owner_id, $2::text FROM unit_owners o
      WHERE o.organization_id = $1 AND o.archived_at IS NULL
        AND EXISTS (SELECT 1 FROM units u WHERE u.owner_id = o.owner_id AND u.status = 'active')
     ON CONFLICT (owner_id, month) DO NOTHING`, [orgId, month]);
  const { rows: [r] } = await query(
    `SELECT COUNT(*)::int AS n FROM owner_statements s JOIN unit_owners o ON o.owner_id = s.owner_id
      WHERE s.organization_id = $1 AND s.month = $2 AND o.archived_at IS NULL`, [orgId, month]);
  return r.n;
}

const peso = (v) => `₱${Number(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Plain-text version for email. Pass a published snapshot, not a live statement.
function statementText(s, monthLabel) {
  const t = s.totals;
  const rows = s.stays.map((x) => `  ${x.check_in} → ${x.check_out}  ${x.unit_name}  ${x.guest_first_name} (${x.channel}, ${x.nights} night${x.nights > 1 ? 's' : ''})  ${peso(x.total_amount)}${Number(x.channel_fee) ? `  less fee ${peso(x.channel_fee)}` : ''}`);
  const ex = s.expenses.map((e) => `  ${e.expense_date}  ${e.unit_name}  ${e.description || e.category}  ${peso(e.amount)}`);
  return [
    `Owner statement for ${monthLabel}`,
    `${s.owner.full_name} · prepared by ${s.workspace}`,
    `Units: ${s.units.map((u) => u.unit_name).join(', ') || 'none'}`,
    '',
    `Stays checked out this month: ${t.stays} (${t.nights} nights, ${t.occupancy_pct}% occupancy)`,
    ...rows,
    '',
    `Gross bookings:        ${peso(t.gross)}`,
    `Less channel fees:     ${peso(t.channel_fees)}`,
    ...(s.owner.cleaning_to_manager ? [`Less cleaning fees:    ${peso(t.cleaning_fees)}`] : []),
    `Less refunds:          ${peso(s.refunded)}`,
    `Net rental income:     ${peso(t.net_rental)}`,
    `${s.fee_label}: ${peso(t.management_fee)}`,
    `Expenses:              ${peso(t.expenses)}`,
    ...ex,
    ...(Number(s.reserve.topup) > 0 ? [`Less repairs reserve top-up: ${peso(s.reserve.topup)}`] : []),
    '',
    `Payout to owner:       ${peso(t.payout)}`,
  ].join('\n');
}

module.exports = { ownerStatement, statementText, monthBounds, monthHasEnded, reserveBalance, draftMonth };
