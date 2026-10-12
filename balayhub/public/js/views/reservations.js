// Reservations: saved views, list, detail (check-in/out, payments), new reservation.

import { get, post, patch, qs } from '../api.js';
import {
  h, icon, peso, fmtDate, fmtDateTime, badge, options, field, formModal, confirmDialog, emptyState, searchBox, toast, todayManila, openModal,
} from '../ui.js';
import { state, navigate } from '../app.js';
import { messageGuest } from './inbox.js';

export const CHANNEL_LABEL = { direct: 'Direct', airbnb: 'Airbnb', booking: 'Booking.com', agoda: 'Agoda', other: 'Other' };
const METHOD_LABEL = { cash: 'Cash', bank_transfer: 'Bank transfer', gcash: 'GCash', maya: 'Maya', card: 'Card', channel_payout: 'Channel payout', other: 'Other' };

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const channelBadge = (c) => h('span', { class: `badge badge--ch-${c}` }, CHANNEL_LABEL[c] || c);

const VIEWS = [
  ['upcoming', 'Upcoming bookings'],
  ['hosting', 'Currently hosting'],
  ['arrivals_today', 'Check-ins today'],
  ['departures_today', 'Check-outs today'],
  ['arrivals_tomorrow', 'Check-ins tomorrow'],
  ['departures_tomorrow', 'Check-outs tomorrow'],
  ['unpaid', 'Upcoming unpaid'],
  ['past', 'Past stays'],
  ['cancelled', 'Cancelled'],
  ['recent', 'Recently created'],
  ['all', 'All reservations'],
];

// ---------------------------------------------------------------- new reservation
export async function newReservationModal({ unitId, checkIn, onSaved } = {}) {
  let listings;
  try { ({ listings } = await get('/listings')); } catch (err) { toast(err.message, 'error'); return; }
  if (!listings.length) {
    openModal({ title: 'No listings yet', body: h('div', { class: 'form' }, h('p', null, 'Add a listing first.'), h('a', { class: 'btn btn--primary', href: '#/listings?new=1' }, 'Add listing')) });
    return;
  }
  const start = checkIn || todayManila();
  const quoteBox = h('div', { class: 'alert alert--info', 'aria-live': 'polite' }, 'Choose a listing and dates to see the price.');
  let quoted = null;
  const modal = formModal({
    title: 'New reservation',
    submitText: 'Save reservation',
    draftKey: unitId ? null : 'reservation-new',
    fields: [
      field({ name: 'unit_id', label: 'Listing', type: 'select', required: true, value: unitId, options: listings.map((l) => [l.unit_id, `${l.unit_name} — ${l.property_name}`]) }),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'check_in', label: 'Check-in', type: 'date', required: true, value: start }),
        field({ name: 'check_out', label: 'Check-out', type: 'date', required: true, value: addDays(start, 1) })),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'guest_name', label: 'Guest name', required: true, maxlength: 120 }),
        field({ name: 'num_guests', label: 'Number of guests', type: 'number', min: 1, max: 50, value: 2, inputmode: 'numeric' })),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'guest_phone', label: 'Guest mobile', type: 'tel', inputmode: 'tel', placeholder: '0917 123 4567' }),
        field({ name: 'guest_email', label: 'Guest email', type: 'email' })),
      field({ name: 'channel', label: 'Booked through', type: 'select', value: 'direct', placeholderOption: false, options: Object.entries(CHANNEL_LABEL) }),
      quoteBox,
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'accommodation_total', label: 'Accommodation total', type: 'money', hint: 'Filled in from your nightly rates. You can change it.' }),
        field({ name: 'cleaning_fee', label: 'Cleaning fee', type: 'money' })),
      field({ name: 'other_fees', label: 'Other fees', type: 'money', placeholder: '0' }),
      field({ name: 'notes', label: 'Notes', type: 'textarea', maxlength: 1000, placeholder: 'Arrival time, special requests…' }),
    ],
    onSubmit: async (data) => {
      const res = await post('/reservations', data);
      toast(`Reservation ${res.reservation.confirmation_code} saved.`);
      if (onSaved) onSaved(res.reservation); else navigate(`#/reservations/${res.reservation.booking_id}`);
    },
  });
  const form = modal.el.querySelector('form');
  let seq = 0;
  async function refreshQuote(e) {
    if (e && !['unit_id', 'check_in', 'check_out'].includes(e.target.name)) return;
    const { unit_id: u, check_in: ci, check_out: co } = Object.fromEntries(['unit_id', 'check_in', 'check_out'].map((k) => [k, form.elements[k].value]));
    if (e?.target.name === 'check_in' && ci && (!co || co <= ci)) form.elements.check_out.value = addDays(ci, 1);
    const coNow = form.elements.check_out.value;
    if (!u || !ci || !coNow || coNow <= ci) { quoteBox.textContent = 'Check-out must be after check-in.'; return; }
    const mySeq = ++seq;
    try {
      const q = await get(`/reservations/quote${qs({ unit_id: u, check_in: ci, check_out: coNow })}`);
      if (mySeq !== seq) return;
      quoted = q;
      const nights = q.nights.length;
      quoteBox.textContent = q.missing_rates
        ? `${nights} night${nights > 1 ? 's' : ''}. This listing has no nightly rate for some nights — enter the total yourself.`
        : `${nights} night${nights > 1 ? 's' : ''} · ${peso(q.accommodation_total)} for the stay${Number(q.cleaning_fee) ? ` + ${peso(q.cleaning_fee)} cleaning` : ''}${q.max_guests ? ` · up to ${q.max_guests} guests` : ''}`;
      if (!q.missing_rates) form.elements.accommodation_total.value = q.accommodation_total;
      form.elements.cleaning_fee.value = q.cleaning_fee;
    } catch (err) { quoteBox.textContent = err.message; }
  }
  form.addEventListener('change', refreshQuote);
  refreshQuote();
  return quoted;
}

// ---------------------------------------------------------------- list
export async function reservationsView(el, { query }) {
  const canManage = state.user.role !== 'staff';
  const filters = { view: VIEWS.some(([v]) => v === query.view) ? query.view : 'upcoming', q: query.q || '', channel: query.channel || '' };
  const listBox = h('div', { class: 'card' });
  const viewSelect = h('select', { class: 'input', 'aria-label': 'Saved view' }, VIEWS.map(([v, t]) => h('option', { value: v, selected: v === filters.view }, t)));
  const channelSelect = h('select', { class: 'input', 'aria-label': 'Channel' }, h('option', { value: '' }, 'All channels'),
    Object.entries(CHANNEL_LABEL).map(([v, t]) => h('option', { value: v, selected: v === filters.channel }, t)));
  const exportLink = h('a', { class: 'btn btn--secondary', download: '' }, 'Export CSV');
  const side = h('nav', { class: 'saved-views', 'aria-label': 'Saved views' });

  async function load() {
    history.replaceState(null, '', `#/reservations${qs({ view: filters.view === 'upcoming' ? '' : filters.view, q: filters.q, channel: filters.channel })}`);
    exportLink.href = `/api/reservations/export${qs(filters)}`;
    viewSelect.value = filters.view;
    side.replaceChildren(...VIEWS.map(([v, t]) => h('button', { type: 'button', 'aria-current': v === filters.view ? 'true' : null, onclick: () => { filters.view = v; load(); } }, t)));
    const { reservations } = await get(`/reservations${qs(filters)}`);
    if (!reservations.length) {
      listBox.replaceChildren(emptyState({
        iconName: 'inbox',
        title: filters.q || filters.channel ? 'No results found' : 'Nothing here yet',
        text: filters.q || filters.channel ? 'Try clearing the search or channel filter.' : 'Reservations you add, or import from Airbnb/Booking.com, appear here.',
        action: (filters.q || filters.channel) ? h('button', { class: 'btn btn--secondary', onclick: () => { filters.q = ''; filters.channel = ''; channelSelect.value = ''; search.querySelector('input').value = ''; load(); } }, 'Clear filters')
          : canManage && h('button', { class: 'btn btn--primary', onclick: () => newReservationModal({ onSaved: load }) }, icon('plus'), 'New reservation'),
      }));
      return;
    }
    listBox.replaceChildren(
      h('p', { class: 'muted small' }, `Showing ${reservations.length} reservation${reservations.length === 1 ? '' : 's'}`),
      h('div', { class: 'table-wrap res-table' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Check-in', 'Check-out', 'Guest', 'Listing', 'Channel', 'Code'].map((t) => h('th', null, t)), h('th', { class: 'num' }, 'Total'), h('th', { class: 'num' }, 'Balance'))),
        h('tbody', null, reservations.map((r) => h('tr', { class: 'row-link', tabindex: 0, onclick: () => navigate(`#/reservations/${r.booking_id}`), onkeydown: (e) => { if (e.key === 'Enter') navigate(`#/reservations/${r.booking_id}`); } },
          h('td', null, fmtDate(r.check_in), h('div', { class: 'muted small' }, `${r.nights} night${r.nights > 1 ? 's' : ''}`)),
          h('td', null, fmtDate(r.check_out)),
          h('td', null, h('strong', null, r.guest_name || r.guest_label || 'Guest'), r.num_guests ? h('div', { class: 'muted small' }, `${r.num_guests} guest${r.num_guests > 1 ? 's' : ''}`) : null),
          h('td', null, r.unit_name, h('div', { class: 'muted small' }, r.property_name)),
          h('td', null, channelBadge(r.channel), r.status === 'cancelled' ? [' ', badge('voided', 'Cancelled')] : null),
          h('td', { class: 'small' }, r.confirmation_code),
          h('td', { class: 'num' }, peso(r.total_amount)),
          h('td', { class: `num${Number(r.balance) > 0 && r.status === 'confirmed' ? ' amount--neg' : ''}` }, r.status === 'confirmed' ? peso(r.balance) : '—')))))));
  }
  viewSelect.addEventListener('change', () => { filters.view = viewSelect.value; load(); });
  channelSelect.addEventListener('change', () => { filters.channel = channelSelect.value; load(); });
  const search = searchBox({ value: filters.q, placeholder: 'Search guest, code or listing', onSearch: (q) => { filters.q = q; load(); } });
  await load();
  el.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' }, h('h1', null, 'Reservations'), h('p', null, 'Every stay, from booking to check-out')),
      h('div', { class: 'page-head__actions' },
        canManage && h('button', { class: 'btn btn--primary', onclick: () => newReservationModal({ onSaved: load }) }, icon('plus'), 'New reservation'),
        exportLink)),
    h('div', { class: 'res-layout' },
      h('aside', { class: 'card res-side' }, h('h3', { class: 'subhead' }, 'Saved views'), side),
      h('div', null,
        h('div', { class: 'toolbar' }, h('div', { class: 'res-view-select' }, viewSelect), search, channelSelect),
        listBox)));
  if (query.new && canManage) newReservationModal({ onSaved: load });
}

// ---------------------------------------------------------------- detail
export async function reservationDetailView(el, { params, rerender }) {
  const { reservation: r, payments } = await get(`/reservations/${params.id}`);
  const canManage = state.user.role !== 'staff';
  const confirmed = r.status === 'confirmed';
  const today = todayManila();
  const guestName = r.guest_name || r.guest_label || 'Guest';

  const act = async (action, msg) => {
    try { await post(`/reservations/${r.booking_id}/stay-status`, { action }); toast(msg); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  const stayButtons = [];
  if (confirmed) {
    if (!r.checked_in_at && r.check_in <= today) stayButtons.push(h('button', { class: 'btn btn--primary', onclick: () => act('check_in', 'Guest checked in.') }, 'Check in'));
    if (r.checked_in_at && !r.checked_out_at) stayButtons.push(h('button', { class: 'btn btn--primary', onclick: () => act('check_out', 'Checked out. Listing marked for cleaning.') }, 'Check out'));
    if (r.checked_in_at && !r.checked_out_at) stayButtons.push(h('button', { class: 'btn btn--ghost btn--sm', onclick: () => act('undo_check_in', 'Check-in undone.') }, 'Undo check-in'));
    if (r.checked_out_at) stayButtons.push(h('button', { class: 'btn btn--ghost btn--sm', onclick: () => act('undo_check_out', 'Check-out undone.') }, 'Undo check-out'));
  }
  const stayState = !confirmed ? badge('voided', 'Cancelled')
    : r.checked_out_at ? badge('paid', 'Checked out') : r.checked_in_at ? badge('active', 'In house') : r.check_in > today ? badge('unpaid', 'Upcoming') : badge('partial', 'Not checked in');

  const recordPayment = () => formModal({
    title: 'Record payment', submitText: 'Save payment', idempotent: true,
    fields: [
      h('div', { class: 'alert alert--info' }, `Balance: ${peso(r.balance)} of ${peso(r.total_amount)}`),
      field({ name: 'amount', label: 'Amount received', type: 'money', required: true, value: Number(r.balance) > 0 ? r.balance : '' }),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'payment_date', label: 'Date received', type: 'date', required: true, value: today, max: today }),
        field({ name: 'payment_method', label: 'Method', type: 'select', required: true, value: r.channel === 'direct' ? 'gcash' : 'channel_payout', placeholderOption: false, options: Object.entries(METHOD_LABEL) })),
      field({ name: 'reference_number', label: 'Reference no.', maxlength: 100 }),
    ],
    onSubmit: async (d, { idempotencyKey }) => { await post(`/reservations/${r.booking_id}/payments`, d, { idempotencyKey }); toast('Payment saved.'); rerender(); },
  });

  const editDetails = () => formModal({
    title: 'Edit reservation', submitText: 'Save changes',
    fields: [
      r.ical_feed_id && h('p', { class: 'muted small' }, `Dates come from ${CHANNEL_LABEL[r.channel]} and update automatically. You can add the amounts here.`),
      !r.ical_feed_id && h('div', { class: 'form-row form-row--2' },
        field({ name: 'check_in', label: 'Check-in', type: 'date', required: true, value: r.check_in }),
        field({ name: 'check_out', label: 'Check-out', type: 'date', required: true, value: r.check_out })),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'num_guests', label: 'Number of guests', type: 'number', min: 1, max: 50, value: r.num_guests }),
        field({ name: 'channel', label: 'Booked through', type: 'select', value: r.channel, placeholderOption: false, options: Object.entries(CHANNEL_LABEL) })),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'accommodation_total', label: 'Accommodation total', type: 'money', value: r.accommodation_total }),
        field({ name: 'cleaning_fee', label: 'Cleaning fee', type: 'money', value: r.cleaning_fee })),
      field({ name: 'other_fees', label: 'Other fees', type: 'money', value: r.other_fees }),
      field({ name: 'notes', label: 'Notes', type: 'textarea', value: r.notes, maxlength: 1000 }),
    ],
    onSubmit: async (d) => { await patch(`/reservations/${r.booking_id}`, d); toast('Reservation updated.'); rerender(); },
  });

  const cancel = async () => {
    const reason = await confirmDialog({ title: 'Cancel this reservation?', text: 'The dates become available again. Payments stay on record; refund them outside BalayHub and void them here if needed.', confirmText: 'Cancel reservation', danger: true, reason: true });
    if (!reason) return;
    try { await post(`/reservations/${r.booking_id}/cancel`, { reason }); toast('Reservation cancelled.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };

  const voidPayment = async (p) => {
    const reason = await confirmDialog({ title: 'Void this payment?', text: `${peso(p.amount)} on ${fmtDate(p.payment_date)}. The record is kept for history.`, confirmText: 'Void payment', danger: true, reason: true });
    if (!reason) return;
    try { await post(`/booking-payments/${p.payment_id}/void`, { reason }); toast('Payment voided.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };

  el.replaceChildren(
    h('a', { class: 'back', href: '#/reservations' }, '‹ Reservations'),
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' },
        h('h1', null, `${guestName} · ${r.unit_name}`),
        h('p', null, `${fmtDate(r.check_in)} – ${fmtDate(r.check_out)} · ${r.nights} night${r.nights > 1 ? 's' : ''} · ${r.confirmation_code}`)),
      h('div', { class: 'page-head__actions' }, stayButtons,
        canManage && h('button', { class: 'btn btn--secondary', onclick: () => messageGuest(r.booking_id, navigate) }, icon('inbox'), 'Message guest'),
        canManage && confirmed && h('button', { class: 'btn btn--secondary', onclick: editDetails }, 'Edit'),
        canManage && confirmed && !r.ical_feed_id && h('button', { class: 'btn btn--danger', onclick: cancel }, 'Cancel'))),
    !confirmed && h('div', { class: 'alert alert--error', style: { marginBottom: '16px' } }, `Cancelled ${fmtDateTime(r.cancelled_at)}${r.cancel_reason ? `: ${r.cancel_reason}` : ''}`),
    h('div', { class: 'grid grid--2' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Stay'), h('div', { class: 'chips' }, stayState, channelBadge(r.channel))),
          h('dl', { class: 'dl' },
            h('dt', null, 'Listing'), h('dd', null, `${r.unit_name}, ${r.property_name}`),
            h('dt', null, 'Check-in'), h('dd', null, fmtDate(r.check_in), r.checked_in_at ? h('div', { class: 'muted small' }, `Checked in ${fmtDateTime(r.checked_in_at)}`) : null),
            h('dt', null, 'Check-out'), h('dd', null, fmtDate(r.check_out), r.checked_out_at ? h('div', { class: 'muted small' }, `Checked out ${fmtDateTime(r.checked_out_at)}`) : null),
            h('dt', null, 'Guests'), h('dd', null, r.num_guests ? String(r.num_guests) : '—'),
            r.notes && [h('dt', null, 'Notes'), h('dd', { style: { whiteSpace: 'pre-wrap' } }, r.notes)])),
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Guest'), r.guest_id && h('a', { href: `#/guests/${r.guest_id}` }, 'Guest profile')),
          h('dl', { class: 'dl' },
            h('dt', null, 'Name'), h('dd', null, guestName),
            !r.limited && [h('dt', null, 'Mobile'), h('dd', null, r.guest_phone ? h('a', { href: `tel:${r.guest_phone.replace(/[^\d+]/g, '')}` }, r.guest_phone) : '—'),
              h('dt', null, 'Email'), h('dd', null, r.guest_email ? h('a', { href: `mailto:${r.guest_email}` }, r.guest_email) : '—')]),
          r.ical_feed_id && h('p', { class: 'muted small', style: { marginTop: '10px' } }, `Imported from ${CHANNEL_LABEL[r.channel]}. Guest details stay on ${CHANNEL_LABEL[r.channel]}.`))),
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Payment'), confirmed && h('button', { class: 'btn btn--primary btn--sm', onclick: recordPayment }, 'Record payment')),
          h('dl', { class: 'dl' },
            h('dt', null, 'Accommodation'), h('dd', null, peso(r.accommodation_total)),
            h('dt', null, 'Cleaning fee'), h('dd', null, peso(r.cleaning_fee)),
            Number(r.other_fees) > 0 && [h('dt', null, 'Other fees'), h('dd', null, peso(r.other_fees))],
            h('dt', null, 'Total'), h('dd', null, h('strong', null, peso(r.total_amount))),
            h('dt', null, 'Paid'), h('dd', null, peso(r.amount_paid)),
            h('dt', null, 'Balance'), h('dd', { class: Number(r.balance) > 0 ? 'amount--neg' : '' }, h('strong', null, peso(r.balance)))),
          h('h3', { class: 'subhead', style: { marginTop: '16px' } }, 'Payments'),
          payments.length ? h('ul', { class: 'list' }, payments.map((p) => h('li', null, h('div', { class: 'row' },
            h('div', { class: 'row__main' },
              h('span', { class: `row__title${p.voided_at ? ' strike' : ''}` }, `${peso(p.amount)} · ${METHOD_LABEL[p.payment_method]}`),
              h('span', { class: 'row__sub' }, `${fmtDate(p.payment_date)}${p.reference_number ? ` · Ref ${p.reference_number}` : ''} · by ${p.recorded_by_name}`),
              p.voided_at && h('span', { class: 'row__sub' }, `Voided: ${p.void_reason}`)),
            h('div', { class: 'row__end' }, p.voided_at ? badge('voided', 'Voided') : (canManage && h('button', { class: 'btn btn--ghost btn--sm', onclick: () => voidPayment(p) }, 'Void')))))))
            : h('p', { class: 'muted small' }, 'No payments recorded yet.')))));
}
