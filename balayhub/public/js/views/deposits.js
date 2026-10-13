// Security deposit card on a reservation, and the Home reminder for deposits to return.

import { get, post, uploadFile } from '../api.js';
import { h, peso, fmtDate, fmtDateTime, field, formModal, confirmDialog, toast, badge, todayManila } from '../ui.js';
import { state } from '../app.js';

const METHODS = [['cash', 'Cash'], ['gcash', 'GCash'], ['maya', 'Maya'], ['bank_transfer', 'Bank transfer'], ['card', 'Card'], ['other', 'Other']];
const label = (m) => METHODS.find(([k]) => k === m)?.[1] || m;
const STATUS = { held: ['partial', 'Held'], refunded: ['paid', 'Returned'], partly_refunded: ['paid', 'Partly returned'], kept: ['overdue', 'Kept'] };

export async function depositCard(r, rerender) {
  let d;
  try { d = await get(`/reservations/${r.booking_id}/deposit`); } catch { return null; }
  const dep = d.deposit;
  const isManager = state.user.role !== 'staff';
  const sent = (res, what) => toast(res.receipt ? (res.receipt.sent ? `${what} Email sent to ${res.receipt.to}.` : `${what} Email not sent: ${res.receipt.error}`) : what);

  const record = () => formModal({
    title: 'Security deposit received', submitText: 'Save',
    fields: [
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'amount', label: 'Amount', type: 'money', required: true, value: d.suggested || '' }),
        field({ name: 'received_date', label: 'Date received', type: 'date', required: true, value: todayManila() })),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'method', label: 'Method', type: 'select', required: true, value: 'cash', placeholderOption: false, options: METHODS }),
        field({ name: 'reference_number', label: 'Reference (optional)', maxlength: 100 })),
      r.guest_email && field({ name: 'send_receipt', label: `Email an acknowledgement to ${r.guest_email}`, type: 'checkbox', value: true }),
    ],
    onSubmit: async (v) => { sent(await post(`/reservations/${r.booking_id}/deposit`, v), 'Deposit recorded.'); rerender(); },
  });

  const settle = () => {
    const dedInput = field({ name: 'deduction_amount', label: 'Deduction for damage / missing items', type: 'money', value: '0', hint: `Deposit: ${peso(dep.amount)}. Leave 0 to return it all.` });
    const refundLine = h('p', { class: 'small' });
    const update = () => {
      const ded = Math.min(Number(dedInput.querySelector('input').value.replace(/,/g, '')) || 0, Number(dep.amount));
      refundLine.textContent = `Return to guest: ${peso(Number(dep.amount) - ded)}`;
    };
    dedInput.querySelector('input').addEventListener('input', update);
    update();
    formModal({
      title: 'Return the deposit', submitText: 'Save',
      fields: [
        dedInput,
        field({ name: 'deduction_reason', label: 'Reason (the guest sees this)', type: 'textarea', maxlength: 1000, placeholder: 'e.g. Broken drinking glass (₱150) and late check-out (₱300).' }),
        refundLine,
        h('div', { class: 'form-row form-row--2' },
          field({ name: 'refund_method', label: 'Returned by', type: 'select', value: dep.method === 'card' ? 'bank_transfer' : dep.method, placeholderOption: false, options: METHODS }),
          field({ name: 'refund_reference', label: 'Reference (optional)', maxlength: 100 })),
        h('p', { class: 'muted small' }, 'Damage photos: use "Add photo" on the deposit card (before or after saving).'),
        r.guest_email && field({ name: 'send_receipt', label: `Email the summary to ${r.guest_email}`, type: 'checkbox', value: true }),
      ],
      onSubmit: async (v) => { sent(await post(`/reservations/${r.booking_id}/deposit/settle`, v), 'Deposit settled.'); rerender(); },
    });
  };
  const reopen = async () => {
    if (!await confirmDialog({ title: 'Undo the return?', text: 'The deposit goes back to "Held" so you can record the return again. Emails already sent are not recalled.', confirmText: 'Undo' })) return;
    try { await post(`/reservations/${r.booking_id}/deposit/reopen`); toast('Back to held.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  const upload = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'input', 'aria-label': 'Damage photo' });

  if (!dep) {
    if (r.status !== 'confirmed') return null;
    return h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Security deposit'), badge('voided', 'None')),
      h('p', { class: 'muted small' }, 'Took a refundable deposit (e.g. ₱1,000)? Record it so you remember to return it after check-out.'),
      h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: record }, 'Record deposit'));
  }
  const [cls, text] = STATUS[dep.status];
  const due = dep.status === 'held' && (r.check_out <= todayManila() || Boolean(r.checked_out_at));
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Security deposit'), badge(due ? 'overdue' : cls, due ? 'To return' : text)),
    h('dl', { class: 'dl' },
      h('dt', null, 'Received'), h('dd', null, `${peso(dep.amount)} · ${label(dep.method)} · ${fmtDate(dep.received_date)}${dep.reference_number ? ` · ref. ${dep.reference_number}` : ''}`),
      Number(dep.deduction_amount) > 0 && [h('dt', null, 'Deducted'), h('dd', null, peso(dep.deduction_amount), h('div', { class: 'muted small', style: { whiteSpace: 'pre-wrap' } }, dep.deduction_reason))],
      dep.refund_amount !== null && [h('dt', null, 'Returned'), h('dd', null, `${peso(dep.refund_amount)}${Number(dep.refund_amount) > 0 ? ` · ${label(dep.refund_method)}${dep.refund_reference ? ` · ref. ${dep.refund_reference}` : ''}` : ''}`, h('div', { class: 'muted small' }, fmtDateTime(dep.settled_at)))]),
    dep.files.length > 0 && h('div', { class: 'gc__ids' }, dep.files.map((f) => h('a', { href: `/api/files/${f.file_id}`, target: '_blank', rel: 'noopener' }, h('img', { src: `/api/files/${f.file_id}`, alt: f.file_name, loading: 'lazy' })))),
    h('div', { class: 'chips', style: { marginTop: '12px' } },
      dep.status === 'held' && isManager && h('button', { class: `btn ${due ? 'btn--primary' : 'btn--secondary'} btn--sm`, type: 'button', onclick: settle }, 'Return deposit'),
      dep.status !== 'held' && state.user.role === 'owner' && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: reopen }, 'Undo')),
    h('div', { class: 'form', style: { marginTop: '10px' } },
      h('label', { class: 'small muted' }, 'Damage / condition photos'), upload,
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: async (e) => {
        if (!upload.files[0]) { toast('Choose a photo first.', 'error'); return; }
        e.target.disabled = true;
        try { await uploadFile('deposit', dep.deposit_id, upload.files[0]); toast('Photo added.'); rerender(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
      } }, 'Add photo')));
}

// Home: deposits still held after check-out.
export async function depositsDueCard() {
  let d;
  try { d = await get('/deposits/due'); } catch { return null; }
  if (!d.deposits.length) return null;
  const total = d.deposits.reduce((s, x) => s + Number(x.amount), 0);
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Deposits to return'), h('span', { class: 'muted small' }, peso(total))),
    h('ul', { class: 'list' }, d.deposits.map((x) => h('li', null, h('a', { class: 'row', href: `#/reservations/${x.booking_id}` },
      h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, x.guest_name || 'Guest'), h('span', { class: 'row__sub' }, `${x.unit_name} · checked out ${fmtDate(x.check_out)}`)),
      h('div', { class: 'row__end' }, h('span', { class: 'amount' }, peso(x.amount))))))));
}
