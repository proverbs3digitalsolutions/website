'use strict';

// Monthly owner statement: stays that checked out in the month on the owner's
// units, less channel fees, cleaning fees (when the manager keeps them), the
// management fee and the units' expenses, giving the owner's payout.

const { query, one } = require('../db');

const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const cents = (v) => Math.round(Number(v || 0) * 100);
const money = (c) => (c / 100).toFixed(2);

function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); // first day of next month
  return { start, end };
}

async function ownerStatement(orgId, ownerId, month) {
  const owner = await one('SELECT * FROM unit_owners WHERE owner_id = $1 AND organization_id = $2', [ownerId, orgId]);
  if (!owner) return null;
  const org = await one('SELECT name FROM organizations WHERE organization_id = $1', [orgId]);
  const { start, end } = monthBounds(month);
  const { rows: units } = await query(
    `SELECT u.unit_id, u.unit_name, p.property_name FROM units u JOIN properties p USING (property_id)
      WHERE u.owner_id = $1 AND p.organization_id = $2 ORDER BY p.property_name, u.unit_name`, [ownerId, orgId]);
  const ids = units.map((u) => u.unit_id);
  const { rows: stays } = await query(
    `SELECT b.booking_id, b.unit_id, u.unit_name, b.check_in::text, b.check_out::text, (b.check_out - b.check_in) AS nights, b.channel,
            b.confirmation_code, split_part(COALESCE(g.full_name, b.guest_label, 'Guest'), ' ', 1) AS guest_first_name,
            b.accommodation_total, b.cleaning_fee, b.other_fees, b.total_amount, b.channel_fee
       FROM bookings b JOIN units u USING (unit_id) LEFT JOIN guests g ON g.guest_id = b.guest_id
      WHERE b.unit_id = ANY($1) AND b.kind = 'reservation' AND b.status = 'confirmed' AND b.check_out >= $2 AND b.check_out < $3
        AND b.check_out <= $4  -- only stays that have ended
      ORDER BY b.check_out, u.unit_name`, [ids, start, end, manilaToday()]);
  const { rows: expenses } = await query(
    `SELECT e.expense_id, e.expense_date::text, e.category, e.description, e.vendor_name, e.amount, u.unit_name
       FROM expenses e JOIN units u ON u.unit_id = e.unit_id
      WHERE e.unit_id = ANY($1) AND e.voided_at IS NULL AND e.expense_date >= $2 AND e.expense_date < $3
      ORDER BY e.expense_date`, [ids, start, end]);

  let gross = 0; let channelFees = 0; let cleaning = 0;
  const lines = stays.map((s) => {
    const g = cents(s.total_amount); const cf = cents(s.channel_fee);
    const cl = owner.cleaning_to_manager ? cents(s.cleaning_fee) : 0;
    gross += g; channelFees += cf; cleaning += cl;
    return { ...s, net: money(g - cf - cl), missing_amount: g === 0 };
  });
  const net = gross - channelFees - cleaning;
  const fee = Math.round((Math.max(net, 0) * Number(owner.management_fee_pct)) / 100);
  const exp = expenses.reduce((s, e) => s + cents(e.amount), 0);
  const nights = stays.reduce((s, x) => s + Number(x.nights), 0);
  const days = (Date.parse(end) - Date.parse(start)) / 86400000;
  return {
    month, period: { start, end_exclusive: end },
    workspace: org.name,
    owner: { owner_id: owner.owner_id, full_name: owner.full_name, email: owner.email, management_fee_pct: owner.management_fee_pct, cleaning_to_manager: owner.cleaning_to_manager },
    units, stays: lines, expenses,
    totals: {
      stays: stays.length, nights, occupancy_pct: units.length ? Math.min(100, Math.round((100 * nights) / (units.length * days))) : 0,
      gross: money(gross), channel_fees: money(channelFees), cleaning_fees: money(cleaning), net_rental: money(net),
      management_fee: money(fee), expenses: money(exp), payout: money(net - fee - exp),
    },
    missing_amounts: lines.filter((l) => l.missing_amount).length,
  };
}

const peso = (v) => `₱${Number(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Plain-text version for email.
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
    `Net rental income:     ${peso(t.net_rental)}`,
    `Management fee (${Number(s.owner.management_fee_pct)}%): ${peso(t.management_fee)}`,
    `Expenses:              ${peso(t.expenses)}`,
    ...ex,
    '',
    `Payout to owner:       ${peso(t.payout)}`,
  ].join('\n');
}

module.exports = { ownerStatement, statementText, monthBounds };
