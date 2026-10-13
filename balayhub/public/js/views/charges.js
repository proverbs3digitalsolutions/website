// Extra charges on a reservation (late check-out, extra guests, damage and so on).
// Each charge raises the booking total, so the balance moves with it. Owners and
// managers add and void charges; staff can see them.

import { get, post } from '../api.js';
import { h, peso, fmtDateTime, field, makeForm, openModal, confirmDialog, toast } from '../ui.js';
import { state } from '../app.js';

const CATEGORY = {
  early_checkin: 'Early check-in',
  late_checkout: 'Late check-out',
  extra_guest: 'Extra guest',
  extra_bed: 'Extra bed',
  airport_transfer: 'Airport transfer',
  damage: 'Damage',
  extra_cleaning: 'Extra cleaning',
  other: 'Other',
};
const label = (c) => CATEGORY[c] || c;
const PRESET_TEXTS = Object.values(CATEGORY);
const inputOf = (wrap) => wrap.querySelector('input, select, textarea');

// Same endpoint and copy behaviour as "Copy payment link" on the reservation page.
async function sendPayLink(reservationId) {
  try {
    const l = await get(`/reservations/${reservationId}/payment-link`);
    if (!l.available) { toast(l.reason, 'error'); return; }
    try { await navigator.clipboard.writeText(l.link); toast(`Payment link for ${peso(l.balance)} copied. Send it to the guest.`); }
    catch { window.prompt('Copy the payment link:', l.link); }
  } catch (err) { toast(err.message, 'error'); }
}

function addCharge(reservationId, rerender) {
  let added = false;
  let modal;
  const cat = field({ name: 'category', label: 'Category', type: 'select', required: true, options: Object.entries(CATEGORY) });
  const desc = field({ name: 'description', label: 'Description', required: true, maxlength: 200, hint: 'Picking a category fills this in. You can type your own.' });
  const qty = field({ name: 'quantity', label: 'Quantity', type: 'number', required: true, min: 1, max: 99, value: 1 });
  const price = field({ name: 'unit_price', label: 'Price per unit', type: 'money', required: true });
  const total = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const catIn = inputOf(cat);
  const descIn = inputOf(desc);
  const qtyIn = inputOf(qty);
  const priceIn = inputOf(price);
  const showTotal = () => {
    const sum = (Number(qtyIn.value) || 0) * (Number(priceIn.value.replace(/[₱,\s]/g, '')) || 0);
    total.textContent = `Charge total: ${peso(sum)}`;
  };
  catIn.addEventListener('change', () => {
    // Only replace the description if it's empty or still a preset, never a custom one.
    if (!descIn.value.trim() || PRESET_TEXTS.includes(descIn.value.trim())) descIn.value = catIn.value === 'other' ? '' : label(catIn.value);
  });
  qtyIn.addEventListener('input', showTotal);
  priceIn.addEventListener('input', showTotal);
  showTotal();

  const form = makeForm({
    submitText: 'Add charge',
    fields: [
      cat,
      desc,
      h('div', { class: 'form-row form-row--2' }, qty, price),
      total,
    ],
    cancel: () => modal.close(),
    onSubmit: async (v) => {
      await post(`/reservations/${reservationId}/charges`, {
        category: v.category, description: v.description, quantity: v.quantity, unit_price: v.unit_price,
      });
      added = true;
      toast('Charge added.');
      rerender();
      modal.close();
    },
  });
  // Offer the pay link only after the dialog has closed, so two dialogs never stack.
  modal = openModal({
    title: 'Add charge',
    body: form,
    onClose: () => { if (added) askToSendPayLink(reservationId); },
  });
}

async function askToSendPayLink(reservationId) {
  const send = await confirmDialog({
    title: 'Send the guest a pay link?',
    text: 'The new balance can be paid online through the private payment link. Copy it now and send it to the guest.',
    confirmText: 'Send pay link',
    cancelText: 'Not now',
  });
  if (send) await sendPayLink(reservationId);
}

export async function chargesCard(reservation, rerender) {
  const id = reservation.booking_id;
  let data;
  try {
    data = await get(`/reservations/${id}/charges`);
  } catch (err) {
    return h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Extra charges')),
      h('p', { class: 'muted small' }, err.message));
  }
  const canEdit = state.user.role !== 'staff' && reservation.status === 'confirmed';

  const voidCharge = async (c) => {
    const reason = await confirmDialog({
      title: 'Void this charge?',
      text: `${label(c.category)}: ${peso(c.amount)}. The line stays on record, but the total and balance go down.`,
      confirmText: 'Void charge',
      danger: true,
      reason: true,
    });
    if (!reason) return;
    try { await post(`/charges/${c.charge_id}/void`, { reason }); toast('Charge voided.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };

  const row = (c) => {
    const voided = Boolean(c.voided_at);
    const units = c.quantity > 1 ? ` · ${c.quantity} × ${peso(c.unit_price)}` : '';
    return h('li', { style: { display: 'flex', gap: '12px', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 0' } },
      h('div', { style: { minWidth: 0 } },
        h('div', { class: voided ? 'strike muted' : undefined }, c.description),
        h('div', { class: 'muted small' }, `${label(c.category)}${units} · ${fmtDateTime(c.created_at)}`),
        voided && h('div', { class: 'muted small' },
          `Voided ${fmtDateTime(c.voided_at)}${c.voided_by_name ? ` by ${c.voided_by_name}` : ''}: ${c.void_reason}`)),
      h('div', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
        h('div', { class: voided ? 'strike muted' : undefined, style: { fontWeight: 700, fontVariantNumeric: 'tabular-nums' } }, peso(c.amount)),
        canEdit && !voided && h('button', {
          class: 'btn btn--secondary btn--sm', type: 'button', 'aria-label': `Void ${c.description}`, onclick: () => voidCharge(c),
        }, 'Void')));
  };

  return h('div', { class: 'card' },
    h('div', { class: 'card__head' },
      h('h2', null, 'Extra charges'),
      canEdit && h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => addCharge(id, rerender) }, 'Add charge')),
    h('p', { class: 'muted small' }, 'Late check-out, extra guests, damage and other extras. Each one adds to the booking total.'),
    data.charges.length
      ? h('ul', { class: 'list' }, data.charges.map(row))
      : h('p', { class: 'muted small' }, 'No extra charges yet.'),
    h('dl', { class: 'dl', style: { marginTop: '12px' } },
      h('dt', null, 'Extras total'), h('dd', null, peso(data.extras_total))),
    reservation.status !== 'confirmed' && h('p', { class: 'muted small' }, 'This reservation is cancelled, so charges cannot be changed.'));
}
