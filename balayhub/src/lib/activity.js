'use strict';

// Plain-English lines for the reservation activity log (D-69). One audit_logs row
// becomes one sentence and a kind for filtering. Only the detail fields read here
// are used, so tokens, check-in and guidebook links, gate-pass recipients, door
// codes and guest contact details never reach the page.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const METHODS = {
  cash: 'cash', bank_transfer: 'bank transfer', gcash: 'GCash', maya: 'Maya', card: 'card', channel_payout: 'channel payout', other: 'other',
};
const CATEGORIES = {
  early_checkin: 'early check-in', late_checkout: 'late check-out', extra_guest: 'extra guest', extra_bed: 'extra bed',
  airport_transfer: 'airport transfer', extra_cleaning: 'extra cleaning', damage: 'damage', addon: 'add-on', other: 'other',
};

// Actions with no signed-in user are a guest's own actions. Any other unsigned action is automatic.
const GUEST_ACTIONS = new Set([
  'payment_proof.submitted', 'payment_proof.image_added', 'reservation.charge_added',
  'reservation.booked_online', 'reservation.balance_paid_online',
]);

const words = (s) => String(s).replace(/[._]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// Money arrives as NUMERIC strings or numbers. Work in centavos, print as ₱1,234.00.
function peso(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const c = Math.round(n * 100);
  const whole = String(Math.floor(Math.abs(c) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${c < 0 ? '-' : ''}₱${whole}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
}

const ofAmount = (v) => {
  const p = peso(v);
  return p ? ` of ${p}` : '';
};
const by = (m) => (m ? ` by ${METHODS[m] || String(m).replace(/_/g, ' ')}` : '');
const receipt = (n) => (n ? ` (receipt ${n})` : '');

// "2026-03-12" → "12 Mar 2026". Dates are DATE values, so no time zone shift.
function day(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}
const span = (a, b) => (day(a) && day(b) ? ` (${day(a)} to ${day(b)})` : '');

// Free text typed by people: drop anything that looks like an email, a phone number or a long token.
function clean(text) {
  return String(text ?? '')
    .replace(/[^\s@]+@[^\s@]+/g, '')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '' : m))
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const because = (reason) => {
  const text = clean(reason);
  return text ? `: ${text}` : '';
};

// "Changed the reservation: check in, notes". Only the field names are shown, never the values.
function changed(lead, after) {
  const keys = Object.keys(after || {}).map((k) => k.replace(/_/g, ' '));
  return keys.length ? `${lead}: ${keys.join(', ')}` : lead;
}

// Fixed sentences: [kind, text].
const PLAIN = {
  'reservation.check_in': ['booking', 'Checked the guest in'],
  'reservation.undo_check_in': ['booking', 'Undid the check-in'],
  'reservation.check_out': ['booking', 'Checked the guest out'],
  'reservation.undo_check_out': ['booking', 'Undid the check-out'],
  'reservation.receipt_sent': ['payment', 'Emailed the payment receipt to the guest'],
  'reservation.confirmation_sent': ['message', 'Emailed the booking confirmation to the guest'],
  'payment_proof.image_added': ['payment', 'Attached a screenshot to a payment proof'],
  'checkin.link_replaced': ['guest', 'Replaced the guest check-in link'],
  'guide.link_shared': ['guest', 'Shared the guidebook link with the guest'],
  'quote.sent': ['message', 'Emailed the quote to the guest'],
  'quote.cancelled': ['booking', 'Cancelled the quote'],
  'inbox.message_sent': ['message', 'Sent a message to the guest'],
  'inbox.message_scheduled': ['message', 'Scheduled a message to the guest'],
  'inbox.note_added': ['message', 'Added an internal note'],
  'inbox.message_cancelled': ['message', 'Cancelled a scheduled message'],
  'inbox.ai_draft': ['message', 'Asked for an AI reply draft'],
  'calendar.unblocked': ['booking', 'Unblocked the dates'],
  'owner_portal.block_cancelled': ['booking', 'Cancelled a block from the owner portal'],
  'deposit.reopened': ['payment', 'Reopened the security deposit'],
  'damage.deducted': ['other', 'Marked the damage to come out of the security deposit'],
  'lost_found.reported': ['other', 'Logged a lost-and-found item'],
  'cleaning.task_created': ['cleaning', 'Created a cleaning task'],
  'cleaning.task_in_progress': ['cleaning', 'Started the cleaning'],
  'cleaning.task_done': ['cleaning', 'Marked the cleaning done'],
  'cleaning.task_cancelled': ['cleaning', 'Cancelled the cleaning task'],
  'cleaning.task_todo': ['cleaning', 'Moved the cleaning task back to to-do'],
  'cleaner_pay.unpaid': ['cleaning', "Marked the cleaner's pay as unpaid"],
};

// Sentences that read details: action → details → [kind, text].
const DETAILED = {
  'reservation.created': (d) => ['booking', `Created reservation${d.code ? ` ${d.code}` : ''}${span(d.check_in, d.check_out)}`],
  'reservation.updated': (d) => ['booking', changed('Changed the reservation', d.after)],
  'reservation.cancelled': (d) => ['booking', `Cancelled the reservation${because(d.reason)}`],
  'reservation.booked_online': (d) => ['booking', peso(d.amount) ? `Booked online and paid ${peso(d.amount)} now` : 'Booked online'],
  'reservation.payment_recorded': (d) => ['payment', d.proof_id
    ? `Confirmed a payment proof as a payment${ofAmount(d.amount)}${receipt(d.receipt)}`
    : `Recorded a payment${ofAmount(d.amount)}${receipt(d.receipt)}`],
  'reservation.payment_voided': (d) => ['payment', `Voided a payment${ofAmount(d.amount)}${because(d.reason)}`],
  'reservation.balance_paid_online': (d) => ['payment', peso(d.amount) ? `Paid ${peso(d.amount)} of the balance online` : 'Paid the balance online'],
  'reservation.charge_added': (d) => {
    const qty = Number(d.quantity) || 1;
    const label = CATEGORIES[d.category] || String(d.category ?? 'other').replace(/_/g, ' ');
    const total = peso(Number(d.unit_price) * qty);
    const each = qty > 1 && peso(d.unit_price) ? ` (${qty} × ${peso(d.unit_price)})` : '';
    return ['charge', `Added a charge for ${label}${total ? `: ${total}` : ''}${each}`];
  },
  'reservation.charge_voided': (d) => ['charge', `Voided a charge${ofAmount(d.amount)}${because(d.reason)}`],
  'reservation.refund_recorded': (d) => ['refund', `Recorded a refund${ofAmount(d.amount)}${by(d.method)}`],
  'reservation.refund_voided': (d) => ['refund', `Voided a refund${ofAmount(d.amount)}${because(d.reason)}`],
  'payment_proof.submitted': (d) => ['payment', `Sent a payment proof${ofAmount(d.amount)}${by(d.method)}`],
  'payment_proof.rejected': (d) => ['payment', `Rejected a payment proof${ofAmount(d.amount)}${because(d.reason)}`],
  'deposit.received': (d) => ['payment', `Received a security deposit${ofAmount(d.amount)}`],
  'deposit.settled': (d) => ['payment', `Settled the security deposit: returned ${peso(d.refund) ?? 'nothing'}, kept ${peso(d.deduction) ?? 'nothing'}`],
  'damage.reported': (d) => ['other', `Reported damage${peso(d.estimated_cost) ? ` (estimated at ${peso(d.estimated_cost)})` : ''}`],
  'damage.charged': (d) => ['charge', `Charged ${peso(d.amount) ?? 'for damage'} to the guest`],
  'damage.waived': (d) => ['other', `Waived a damage report${because(d.note)}`],
  'lost_found.updated': (d) => ['other', d.from && d.to ? `Changed a lost-and-found item from ${d.from} to ${d.to}` : 'Changed a lost-and-found item'],
  'cleaning.task_updated': (d) => ['cleaning', changed('Changed the cleaning task', d.after)],
  'cleaning.inspected': (d) => ['cleaning', `Inspected the cleaning: ${d.passed ? 'passed' : 'failed'}${d.score != null ? ` (score ${d.score})` : ''}`],
  'cleaner_pay.paid': (d) => ['cleaning', peso(d.amount) ? `Paid the cleaner ${peso(d.amount)}` : 'Paid the cleaner'],
  'quote.created': (d) => ['booking', peso(d.total_amount) ? `Created a quote for ${peso(d.total_amount)}` : 'Created a quote'],
  'gatepass.sent': (d) => ['guest', d.ok === false ? 'Could not send the gate pass by email' : 'Sent the gate pass by email'],
  'calendar.blocked': (d) => ['booking', `Blocked the dates${span(d.start, d.end)}`],
  'owner_portal.block_created': (d) => ['booking', `Blocked the dates from the owner portal${span(d.check_in, d.check_out)}`],
};

// Who did it. Unsigned rows are a guest's own actions, the owner portal's, or automatic.
function whoOf(row) {
  if (row.actor_name) return row.actor_name;
  if (GUEST_ACTIONS.has(row.action)) return 'Guest';
  if (row.action.startsWith('owner_portal.')) return 'Owner';
  return 'BalayHub';
}

// Action → { kind, text }. An action with no entry shows its name, read as a sentence.
function describe(row) {
  const d = row.details || {};
  if (PLAIN[row.action]) {
    const [kind, text] = PLAIN[row.action];
    return { kind, text };
  }
  if (DETAILED[row.action]) {
    const [kind, text] = DETAILED[row.action](d);
    return { kind, text };
  }
  return { kind: 'other', text: words(row.action) };
}

// One activity row: when, who, what, and a kind for filtering.
function item(row) {
  const { kind, text } = describe(row);
  return { at: new Date(row.created_at).toISOString(), who: whoOf(row), text, kind };
}

module.exports = { item, describe, whoOf };
