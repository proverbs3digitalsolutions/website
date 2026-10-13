// Refunds on a reservation: the listing's cancellation policy, the refund it suggests,
// the refund log, and (owners and managers) recording and voiding refunds.

import { get, post } from '../api.js';
import { h, badge, peso, fmtDate, field, formModal, confirmDialog, toast, todayManila } from '../ui.js';
import { state } from '../app.js';

const METHOD_LABEL = { cash: 'Cash', bank_transfer: 'Bank transfer', gcash: 'GCash', maya: 'Maya', card: 'Card', other: 'Other' };

export async function refundsCard(reservation, rerender) {
  const data = await get(`/reservations/${reservation.booking_id}/refunds`);
  const canManage = state.user.role !== 'staff';

  const recordRefund = () => formModal({
    title: 'Record refund', submitText: 'Save refund', idempotent: true,
    fields: [
      field({ name: 'amount', label: 'Amount refunded', type: 'money', required: true, value: data.suggestion?.amount,
        hint: `Up to ${peso(data.refundable)} is left to refund.` }),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'refund_date', label: 'Date refunded', type: 'date', required: true, value: todayManila(), max: todayManila() }),
        field({ name: 'method', label: 'Method', type: 'select', required: true, value: 'gcash', placeholderOption: false, options: Object.entries(METHOD_LABEL) })),
      field({ name: 'reference_number', label: 'Reference number (optional)', maxlength: 100 }),
      field({ name: 'reason', label: 'Reason', type: 'textarea', required: true, maxlength: 300,
        hint: 'Kept in the refund log. For example: cancelled by guest, 6 days before check-in.' }),
    ],
    onSubmit: async (d, { idempotencyKey }) => { await post(`/reservations/${reservation.booking_id}/refunds`, d, { idempotencyKey }); toast('Refund recorded.'); rerender(); },
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
    ? h('div', { class: 'alert alert--info' }, `Suggested refund: ${peso(data.suggestion.amount)} (${data.suggestion.percent}%). ${data.suggestion.rule}.`)
    : data.policy?.key === 'custom' && h('p', { class: 'muted small' }, 'Custom policy: no automatic amount. Decide the refund from your own wording.');
  const totals = h('p', { class: 'muted small' }, `Paid ${peso(data.paid)} · Refunded ${peso(data.refunded)} · Left to refund ${peso(data.refundable)}`);

  const log = data.refunds.length
    ? h('ul', { class: 'list' }, data.refunds.map((r) => h('li', null, h('div', { class: 'row' },
      h('div', { class: 'row__main' },
        h('span', { class: `row__title${r.voided_at ? ' strike' : ''}` }, `${peso(r.amount)} · ${METHOD_LABEL[r.method] || r.method}`),
        h('span', { class: 'row__sub' }, `${fmtDate(r.refund_date)}${r.reference_number ? ` · Ref ${r.reference_number}` : ''} · ${r.reason}${r.recorded_by_name ? ` · by ${r.recorded_by_name}` : ''}`),
        r.voided_at && h('span', { class: 'row__sub' }, `Voided: ${r.void_reason}`)),
      h('div', { class: 'row__end' }, r.voided_at ? badge('voided', 'Voided') : canManage && h('button', { class: 'btn btn--ghost btn--sm', onclick: () => voidRefund(r) }, 'Void'))))))
    : h('p', { class: 'muted small' }, 'No refunds recorded yet.');

  return h('section', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Refunds'),
      canManage && h('button', { class: 'btn btn--primary btn--sm', onclick: recordRefund }, 'Record refund')),
    policy, suggestion, totals,
    h('h3', { class: 'subhead', style: { marginTop: '16px' } }, 'Refund log'),
    log);
}
