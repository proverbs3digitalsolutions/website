// Refunds on a reservation: the listing's cancellation policy, the refund it suggests,
// the refund log, and (owners and managers) recording and voiding refunds.

import { get, post, ApiError } from '../api.js';
import { h, badge, peso, fmtDate, field, formModal, confirmDialog, toast, todayManila, parseAmount } from '../ui.js';
import { state } from '../app.js';

const METHOD_LABEL = { cash: 'Cash', bank_transfer: 'Bank transfer', gcash: 'GCash', maya: 'Maya', card: 'Card', other: 'Other' };

// The policy's suggested refund. On a live reservation it is only what the policy would refund if cancelled today.
export function suggestionText(s, cancelled) {
  const lead = cancelled ? 'Suggested refund' : 'If cancelled today, suggested refund';
  // After a partial refund, say what is already back and what is still owed.
  const done = Number(s.already_refunded) > 0
    ? ` ${peso(s.already_refunded)} is already refunded, so ${Number(s.remaining) > 0 ? `${peso(s.remaining)} more` : 'nothing more is suggested'}.`
    : '';
  return `${lead}: ${peso(s.amount)} (${s.percent}%). ${s.rule}.${done}`;
}

// What the guest would owe after this refund, so the host is asked first. The balance already counts refunds: any refund that leaves the balance above 0 on a live stay is asked, including a paid-up stay (D-86). A cancelled booking owes nothing (D-77).
export function refundOwedAfter(reservation, amount) {
  if (reservation.status === 'cancelled') return 0;
  const before = Number(reservation.balance); const typed = Number(amount);
  if (!Number.isFinite(typed)) return 0;
  const after = Math.round((before + typed) * 100) / 100;
  return after > 0 ? after : 0;
}

// The server's own sentence (src/routes/refunds.js) for a refund above what is left, so the host sees it before any question.
export function refundCapProblem(amount, { refundable, paid, refunded }) {
  const m = (n) => `₱${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (!(Number(amount) > Number(refundable))) return null;
  const tail = `(${m(paid)} paid, ${m(refunded)} already refunded).`;
  return Number(refundable) > 0 ? `Only ${m(refundable)} is left to refund ${tail}` : `Nothing is left to refund ${tail}`;
}

export async function refundsCard(reservation, rerender) {
  const data = await get(`/reservations/${reservation.booking_id}/refunds`);
  const canManage = state.user.role !== 'staff';
  const cancelled = reservation.status === 'cancelled';

  const recordRefund = () => formModal({
    title: 'Record refund', submitText: 'Save refund', idempotent: true,
    fields: [
      field({ name: 'amount', label: 'Amount refunded', type: 'money', required: true, value: cancelled && Number(data.suggestion?.remaining) > 0 ? data.suggestion.remaining : undefined,
        hint: `Up to ${peso(data.refundable)} is left to refund.` }),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'refund_date', label: 'Date refunded', type: 'date', required: true, value: todayManila(), max: todayManila() }),
        field({ name: 'method', label: 'Method', type: 'select', required: true, value: 'gcash', placeholderOption: false, options: Object.entries(METHOD_LABEL) })),
      field({ name: 'reference_number', label: 'Reference number (optional)', maxlength: 100 }),
      field({ name: 'reason', label: 'Reason', type: 'textarea', required: true, maxlength: 300,
        hint: 'Kept in the refund log. For example: cancelled by guest, 6 days before check-in.' }),
    ],
    onSubmit: async (d, { idempotencyKey }) => {
      // Check the cap first, so no question is asked about a save that cannot succeed. Cancel returns false: nothing is posted and the form stays open with no message.
      const amount = parseAmount(d.amount);
      const tooMuch = refundCapProblem(amount, data);
      // The sentence shows once, at the field; the banner only points to it.
      if (tooMuch) throw new ApiError('Please check the highlighted fields.', { status: 400, fields: { amount: tooMuch } });
      const owed = refundOwedAfter(reservation, amount);
      if (owed > 0) {
        const over = Number(reservation.balance) < 0;
        const ok = await confirmDialog(over
          ? { title: 'Refund more than the overpayment?', text: `The guest overpaid by ${peso(-Number(reservation.balance))}. After this ${peso(amount)} refund they will owe ${peso(owed)}. Record it?`, confirmText: 'Record refund' }
          : { title: 'Refund leaves money owed?', text: `After this ${peso(amount)} refund the guest will owe ${peso(owed)}. Record it?`, confirmText: 'Record refund' });
        if (!ok) return false;
      }
      await post(`/reservations/${reservation.booking_id}/refunds`, d, { idempotencyKey }); toast('Refund recorded.'); rerender();
    },
  });

  const voidRefund = async (r) => {
    const reason = await confirmDialog({
      title: 'Void this refund?', text: `${peso(r.amount)} refunded on ${fmtDate(r.refund_date)}. The record is kept for history.`,
      confirmText: 'Void refund', danger: true, reason: true,
    });
    if (!reason) return;
    try { await post(`/refunds/${r.refund_id}/void`, { reason }); toast('Refund voided.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };

  const policy = data.policy
    ? h('p', null, h('strong', null, data.policy.label), ` · ${data.policy.en}`)
    : h('p', { class: 'muted small' }, 'No cancellation policy set for this listing. Set one in the listing\'s Edit form.');
  const suggestion = data.suggestion
    ? h('div', { class: 'alert alert--info' }, suggestionText(data.suggestion, cancelled))
    : data.policy?.key === 'custom' && h('p', { class: 'muted small' }, 'Custom policy: no automatic amount. Decide the refund from your own wording.');
  const totals = h('p', { class: 'muted small' }, `Paid ${peso(data.paid)} · Refunded ${peso(data.refunded)} · Left to refund ${peso(data.refundable)}`);

  const log = data.refunds.length
    ? h('ul', { class: 'list' }, data.refunds.map((r) => h('li', null, h('div', { class: 'row' },
      h('div', { class: 'row__main' },
        h('span', { class: `row__title${r.voided_at ? ' strike' : ''}` }, `${peso(r.amount)} · ${METHOD_LABEL[r.method] || r.method}`),
        h('span', { class: 'row__sub' }, `${fmtDate(r.refund_date)}${r.reference_number ? ` · Ref ${r.reference_number}` : ''} · ${r.reason}${r.recorded_by_name ? ` · by ${r.recorded_by_name}` : ''}`),
        r.voided_at && h('span', { class: 'row__sub' }, `Voided: ${r.void_reason}`)),
      h('div', { class: 'row__end' }, r.voided_at ? badge('voided', 'Voided') : canManage && h('button', { class: 'btn btn--ghost btn--sm', 'aria-label': `Void refund of ${peso(r.amount)} on ${fmtDate(r.refund_date)}`, onclick: () => voidRefund(r) }, 'Void'))))))
    : h('p', { class: 'muted small' }, 'No refunds recorded yet.');

  return h('section', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Refunds'),
      canManage && h('button', { class: 'btn btn--primary btn--sm', onclick: recordRefund }, 'Record refund')),
    policy, suggestion, totals,
    h('h3', { class: 'subhead', style: { marginTop: '16px' } }, 'Refund log'),
    log);
}
