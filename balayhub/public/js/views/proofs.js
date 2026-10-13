// Guest payment proofs on a reservation: the host checks each screenshot, then
// confirms it (which records the payment) or rejects it with a reason.

import { get, post } from '../api.js';
import { h, toast, field, formModal, badge, fmtDateTime } from '../ui.js';

const METHOD = { gcash: 'GCash', maya: 'Maya', bank_transfer: 'Bank transfer', other: 'Other' };
const STATUS = { pending: ['open', 'To check'], confirmed: ['paid', 'Confirmed'], rejected: ['voided', 'Rejected'] };
const peso = (v) => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Returns the card, or null for staff (the server keeps payment proofs from them).
export async function proofsCard(reservation, rerender) {
  let proofs;
  try {
    ({ proofs } = await get(`/reservations/${encodeURIComponent(reservation.booking_id)}/proofs`));
  } catch (err) {
    if (err.status === 403) return null;
    throw err;
  }
  const toCheck = proofs.filter((p) => p.status === 'pending').length;
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Payment proofs'),
      toCheck ? badge('open', `${toCheck} to check`) : null),
    h('p', { class: 'muted small' }, 'Guests send a screenshot of a GCash, Maya or bank payment from their payment page. Check it against your account, then confirm or reject it.'),
    proofs.length
      ? proofs.map((p) => proofRow(p, rerender))
      : h('p', { class: 'muted small' }, 'No payment proofs yet.'));
}

function proofRow(p, rerender) {
  const [status, text] = STATUS[p.status] || [p.status, p.status];
  const shots = (p.files || []).map((f) => (f.mime_type === 'application/pdf'
    ? h('a', { class: 'btn btn--secondary btn--sm', href: `/api/files/${f.file_id}`, target: '_blank', rel: 'noopener' }, 'Open PDF')
    : h('a', { href: `/api/files/${f.file_id}`, target: '_blank', rel: 'noopener' },
      h('img', { src: `/api/files/${f.file_id}`, alt: 'Payment proof', loading: 'lazy',
        style: { width: '100%', maxHeight: '360px', objectFit: 'contain', borderRadius: '10px', border: '1px solid var(--line)' } }))));
  const actions = p.status === 'pending' && h('div', { class: 'chips' },
    p.booking_status === 'confirmed' && h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => confirmProof(p, rerender) }, 'Confirm payment'),
    h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => rejectProof(p, rerender) }, 'Reject'));
  return h('div', { class: 'proof', style: { display: 'grid', gap: '8px', paddingTop: '12px', borderTop: '1px solid var(--line)' } },
    h('div', { class: 'chips' }, h('strong', null, peso(p.amount)), badge(status, text)),
    h('dl', { class: 'dl' },
      h('dt', null, 'Method'), h('dd', null, METHOD[p.method] || p.method),
      p.reference_number && [h('dt', null, 'Reference'), h('dd', null, p.reference_number)],
      p.payer_name && [h('dt', null, 'Payer'), h('dd', null, p.payer_name)],
      h('dt', null, 'Sent'), h('dd', null, fmtDateTime(p.submitted_at)),
      p.status === 'rejected' && [h('dt', null, 'Reason'), h('dd', null, p.reject_reason)]),
    shots.length ? shots : h('p', { class: 'muted small' }, 'No screenshot was attached.'),
    actions);
}

function confirmProof(p, rerender) {
  formModal({
    title: 'Confirm this payment',
    submitText: 'Record payment',
    fields: [
      h('p', { class: 'small' }, `This records ${peso(p.amount)} by ${METHOD[p.method] || p.method} on the reservation and lowers the balance. Check the screenshot first.`),
      field({ name: 'send_receipt', label: 'Email a receipt to the guest', type: 'checkbox', value: true }),
    ],
    onSubmit: async (d) => {
      const r = await post(`/payment-proofs/${encodeURIComponent(p.proof_id)}/confirm`, { send_receipt: Boolean(d.send_receipt) });
      toast(r.receipt && !r.receipt.sent ? `Payment recorded, but the receipt was not sent: ${r.receipt.error}` : 'Payment recorded.');
      rerender();
    },
  });
}

function rejectProof(p, rerender) {
  formModal({
    title: 'Reject this payment proof',
    submitText: 'Reject',
    fields: [
      h('p', { class: 'small' }, 'Say why, so the guest knows what to fix. The reason is emailed to the guest if they have an email address.'),
      field({ name: 'reason', label: 'Reason', type: 'textarea', required: true, maxlength: 300, hint: 'For example: the amount does not match, or the reference number is missing.' }),
    ],
    onSubmit: async (d) => {
      await post(`/payment-proofs/${encodeURIComponent(p.proof_id)}/reject`, { reason: d.reason });
      toast('Proof rejected.');
      rerender();
    },
  });
}
