// Reservations: saved views, list, detail (check-in/out, payments), new reservation.

import { get, post, patch, qs, ApiError } from '../api.js';
import {
  h, icon, peso, fmtDate, fmtDateTime, badge, options, field, formModal, confirmDialog, emptyState, searchBox, toast, todayManila, manilaDay, openModal,
} from '../ui.js';
import { state, navigate } from '../app.js';
import { initFilters, filterBar, rememberFilters, changed } from '../filters.js';
import { messageGuest } from './inbox.js';
import { copyText } from './quotes.js';
import { checkinCard } from './checkin.js';
import { stars } from './guestcare.js';
import { gatepassCard } from './gatepass.js';
import { depositCard } from './deposits.js';
import { chargesCard } from './charges.js';
import { refundsCard } from './refunds.js';
import { proofsCard } from './proofs.js';

const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
// "VIP", "Returning guest · 3rd stay", "Do not rebook"
export function guestBadges(r) {
  return [
    r.guest_vip && badge('paid', 'VIP'),
    r.previous_stays > 0 && badge('active', `Returning · ${ordinal(r.previous_stays + 1)} stay`),
    r.guest_do_not_rebook && badge('overdue', 'Do not rebook'),
  ].filter(Boolean);
}

// " · 2 holiday nights, 1 weekend night" for a quote.
function nightsNote(q) {
  const count = (k) => q.nights.filter((n) => n.kind === k).length;
  const parts = [['holiday', 'holiday'], ['season', 'season'], ['weekend', 'weekend']]
    .map(([k, w]) => [count(k), w]).filter(([n]) => n > 0).map(([n, w]) => `${n} ${w} night${n > 1 ? 's' : ''}`);
  return parts.length ? ` · includes ${parts.join(', ')}` : '';
}

// Pure money/edit helpers (no DOM), unit-tested in test/qa-r2-reservations-view.test.js.
// Overpaid means still owed back: the surplus minus refunds already recorded.
export function overpaidAfterRefunds(balance, refunded) {
  return Math.max(0, Math.round((-Number(balance) - Number(refunded || 0)) * 100) / 100);
}
// Only the fields the host actually changed, so the activity log isn't noisy.
export function changedFields(orig, d) {
  const same = (a, b) => (a === '' || a == null || b === '' || b == null) ? (a ?? '') === (b ?? '')
    : (!isNaN(a) && !isNaN(b) ? Number(a) === Number(b) : String(a) === String(b));
  return Object.fromEntries(Object.entries(d).filter(([k, v]) => !same(orig[k], v)));
}
// The channel fee to send on save. The server refuses a fee on a direct booking and ignores a blank one, so a direct booking that still has a stored fee is sent as 0 to clear it.
export function channelFeeToSave(channel, storedFee, typedFee) {
  return channel === 'direct' && Number(storedFee) > 0 ? '0' : typedFee;
}
// What a money box should hold after a quote. A box the host typed in keeps their number. An untouched box takes the quote for a
// specific listing, but stays empty for a room type (the server picks the listing later and prices it itself), and is emptied when
// there is no quote, so an old suggestion is never sent.
export function boxValue({ typed, mode, suggestion, current }) {
  if (typed) return current;
  return mode === 'type' || suggestion == null ? '' : String(suggestion);
}
// Offer "Use ₱X from your rates" when the host's own number differs from the quote for the chosen listing.
export function offerRate({ typed, mode, suggestion, current }) {
  return Boolean(typed) && mode !== 'type' && suggestion != null && Number(String(current).replace(/,/g, '')) !== Number(suggestion);
}
// Cancelled-booking alert wording. A suggestion comes from the cancellation policy. With no policy, or a Custom one, nothing is suggested, so the text says what is still held.
export function refundAlertText({ suggestion, refundable, paid, policy }) {
  if (suggestion) {
    const said = `Cancelled: policy suggests refunding ${peso(suggestion.amount)} of ${peso(paid)} paid.`;
    if (!(Number(suggestion.already_refunded) > 0)) return said;
    const more = Number(suggestion.remaining) > 0 ? `so ${peso(suggestion.remaining)} more.` : 'so nothing more is suggested.';
    return `${said} ${peso(suggestion.already_refunded)} is already refunded, ${more}`;
  }
  const note = policy?.key === 'custom' ? 'A Custom policy has no automatic suggestion.' : 'No cancellation policy is set, so no refund is suggested.';
  return `Cancelled: ${peso(refundable)} of ${peso(paid)} paid is still held. ${note}`;
}

export const CHANNEL_LABEL = { direct: 'Direct', airbnb: 'Airbnb', booking: 'Booking.com', agoda: 'Agoda', vrbo: 'Vrbo', expedia: 'Expedia', tripcom: 'Trip.com', other: 'Other' };
export const SOURCE_LABEL = { facebook: 'Facebook', instagram: 'Instagram', messenger: 'Messenger', viber: 'Viber', tiktok: 'TikTok', google: 'Google', whatsapp: 'WhatsApp', email: 'Email', referral: 'Referral', quote: 'Quote', other: 'Other' };
const METHOD_LABEL = { cash: 'Cash', bank_transfer: 'Bank transfer', gcash: 'GCash', maya: 'Maya', card: 'Card', channel_payout: 'Channel payout', other: 'Other' };
// Channel payouts only come from a channel booking, so a direct booking's method list leaves them out.
export function paymentMethodOptions(channel) {
  return Object.entries(METHOD_LABEL).filter(([k]) => k !== 'channel_payout' || channel !== 'direct');
}

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

// A direct booking has no channel fee, so the fee box is hidden while Booked through is Direct. Switching to Direct empties it.
function syncChannelFee(form, switched) {
  const direct = form.elements.channel.value === 'direct';
  if (switched && direct) form.elements.channel_fee.value = '';
  form.querySelector('[data-field=channel_fee]').hidden = direct;
}

// ---------------------------------------------------------------- new reservation
export async function newReservationModal({ unitId, checkIn, onSaved } = {}) {
  let listings;
  try { ({ listings } = await get('/listings')); } catch (err) { toast(err.message, 'error'); return; }
  if (!listings.length) {
    openModal({ title: 'No listings yet', body: h('div', { class: 'form' }, h('p', null, 'Add a listing first.'), h('a', { class: 'btn btn--primary', href: '#/listings?new=1' }, 'Add listing')) });
    return;
  }
  const start = checkIn || todayManila();
  // "Any free room of type": property + room type pairs (Phase 5). Quietly skipped if none are set up.
  let roomTypes = [];
  if (!unitId) { try { ({ room_types: roomTypes } = await get('/room-types')); } catch { roomTypes = []; } }
  const propName = new Map(listings.map((l) => [l.property_id, l.property_name]));
  const quoteBox = h('div', { class: 'alert alert--info', 'aria-live': 'polite' }, 'Choose a listing and dates to see the price.');
  let quoted = null;
  // Rate-card price on offer when the host typed a different amount.
  const useRate = h('button', { class: 'btn btn--secondary btn--sm', type: 'button', hidden: true });
  const modal = formModal({
    title: 'New reservation',
    submitText: 'Save reservation',
    draftKey: unitId ? null : 'reservation-new',
    fields: [
      roomTypes.length > 0 && field({ name: 'pick_mode', label: 'Book', type: 'select', value: 'unit', placeholderOption: false, options: [['unit', 'A specific listing'], ['type', 'Any free room of a type']] }),
      field({ name: 'unit_id', label: 'Listing', type: 'select', required: true, value: unitId, options: listings.map((l) => [l.unit_id, `${l.unit_name} — ${l.property_name}`]) }),
      roomTypes.length > 0 && field({ name: 'room_pick', label: 'Room type', type: 'select', options: roomTypes.map((t) => [`${t.property_id}|${t.room_type}`, `${t.room_type} · ${propName.get(t.property_id) || 'Property'} (${t.count})`]), hint: 'BalayHub picks the first free listing of this type for these dates.' }),
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
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'other_fees', label: 'Other fees', type: 'money', placeholder: '0' }),
        field({ name: 'channel_fee', label: 'Channel fee / commission', type: 'money', placeholder: '0', hint: 'What Airbnb, Booking.com, Agoda or another channel keeps.' })),
      field({ name: 'notes', label: 'Notes', type: 'textarea', maxlength: 1000, placeholder: 'Arrival time, special requests…' }),
      field({ name: 'send_confirmation', label: 'Email a booking confirmation to the guest (needs their email)', type: 'checkbox', value: true }),
    ],
    onSubmit: async (data) => {
      if (!data.guest_email) data.send_confirmation = false;
      if (data.pick_mode === 'type') {
        const [property_id, ...rt] = String(data.room_pick || '').split('|');
        if (!property_id) throw new ApiError('Choose a room type.', { status: 400, fields: { room_pick: 'Choose a room type.' } });
        Object.assign(data, { property_id, room_type: rt.join('|') });
        delete data.unit_id;
      }
      delete data.pick_mode; delete data.room_pick;
      const res = await post('/reservations', data);
      if (res.confirmation && !res.confirmation.sent) toast(`Reservation saved, but the confirmation was not emailed: ${res.confirmation.error}`, 'error');
      else toast(`Reservation ${res.reservation.confirmation_code} saved${res.confirmation?.sent ? ' and confirmation emailed' : ''}.`);
      if (res.reservation.guest_do_not_rebook) toast(`Heads up: ${res.reservation.guest_name || 'this guest'} is marked "Do not rebook" in Guests.`, 'error');
      if (onSaved) onSaved(res.reservation); else navigate(`#/reservations/${res.reservation.booking_id}`);
    },
  });
  const form = modal.el.querySelector('form');
  const typeMode = () => form.elements.pick_mode?.value === 'type';
  // For a room-type booking the price hint uses the first listing of that type, when listings say their type.
  const quoteUnit = () => {
    if (!typeMode()) return form.elements.unit_id.value;
    const [pid, ...rt] = String(form.elements.room_pick.value).split('|');
    return listings.find((l) => l.property_id === pid && l.room_type === rt.join('|'))?.unit_id || '';
  };
  const syncMode = () => {
    if (!form.elements.pick_mode) return;
    const t = typeMode();
    form.querySelector('[data-field=unit_id]').hidden = t;
    form.querySelector('[data-field=room_pick]').hidden = !t;
    form.elements.unit_id.required = !t;
    form.elements.room_pick.required = t;
  };
  syncMode();
  // A box counts as typed once the host puts something in it; a refresh then leaves it alone (a draft restored into the form counts too).
  const MONEY = ['accommodation_total', 'cleaning_fee'];
  const typed = Object.fromEntries(MONEY.map((n) => [n, form.elements[n].value.trim() !== '']));
  form.addEventListener('input', (e) => { if (MONEY.includes(e.target.name)) { typed[e.target.name] = e.target.value.trim() !== ''; if (!typed[e.target.name]) refreshQuote(); } });
  let rate = null;
  // Writes the quote (or nothing, when q is null) into the boxes that are not the host's, and offers the rate-card price for the rest.
  const applyQuote = (q) => {
    const mode = typeMode() ? 'type' : 'unit';
    rate = q && !q.missing_rates ? q : null;
    const sugg = { accommodation_total: rate ? rate.accommodation_total : null, cleaning_fee: q ? q.cleaning_fee : null };
    let offer = false;
    for (const n of MONEY) {
      const box = form.elements[n];
      offer = offer || offerRate({ typed: typed[n], mode, suggestion: sugg[n], current: box.value });
      box.value = boxValue({ typed: typed[n], mode, suggestion: sugg[n], current: box.value });
    }
    useRate.hidden = !offer;
    if (offer) useRate.textContent = `Use ${peso(sugg.accommodation_total)}${Number(sugg.cleaning_fee) ? ` + ${peso(sugg.cleaning_fee)} cleaning` : ''} from your rates`;
  };
  useRate.addEventListener('click', () => {
    for (const n of MONEY) { form.elements[n].value = rate[n]; typed[n] = false; }
    useRate.hidden = true;
  });
  quoteBox.after(useRate);
  form.addEventListener('change', (e) => { if (e.target.name === 'channel') syncChannelFee(form, true); });
  syncChannelFee(form, false);
  let seq = 0;
  async function refreshQuote(e) {
    if (e?.target.name === 'pick_mode') syncMode();
    if (e && !['unit_id', 'check_in', 'check_out', 'pick_mode', 'room_pick'].includes(e.target.name)) return;
    const { check_in: ci, check_out: co } = Object.fromEntries(['check_in', 'check_out'].map((k) => [k, form.elements[k].value]));
    const u = quoteUnit();
    if (e?.target.name === 'check_in' && ci && (!co || co <= ci)) form.elements.check_out.value = addDays(ci, 1);
    const coNow = form.elements.check_out.value;
    if (!u) { applyQuote(null); quoteBox.textContent = typeMode() ? 'The price is not suggested for this room type. Enter the total yourself, or leave it empty to use each listing\'s price.' : 'Choose a listing to see the price.'; return; }
    if (!ci || !coNow || coNow <= ci) { applyQuote(null); quoteBox.textContent = 'Check-out must be after check-in.'; return; }
    const mySeq = ++seq;
    try {
      const q = await get(`/reservations/quote${qs({ unit_id: u, check_in: ci, check_out: coNow })}`);
      if (mySeq !== seq) return;
      quoted = q;
      const nights = q.nights.length;
      const guide = typeMode() ? ` From about ${peso(q.accommodation_total)}${Number(q.cleaning_fee) ? ` + ${peso(q.cleaning_fee)} cleaning` : ''} (first listing of this type). Each room is priced from the listing BalayHub picks; leave the boxes empty to use that price.` : '';
      quoteBox.textContent = typeMode() && !q.missing_rates ? `${nights} night${nights > 1 ? 's' : ''}.${guide}` : q.missing_rates
        ? `${nights} night${nights > 1 ? 's' : ''}. This listing has no nightly rate for some nights — enter the total yourself.`
        : `${nights} night${nights > 1 ? 's' : ''} · ${peso(q.accommodation_total)} for the stay${q.discount_pct ? ` (after ${q.discount_label})` : ''}${Number(q.cleaning_fee) ? ` + ${peso(q.cleaning_fee)} cleaning` : ''}${q.max_guests ? ` · up to ${q.max_guests} guests` : ''}${nightsNote(q)}${q.min_nights > nights ? ` · Note: minimum stay is ${q.min_nights} nights${q.min_nights_reason ? ` during ${q.min_nights_reason}` : ''}.` : ''}`;
      applyQuote(q);
    } catch (err) { if (mySeq === seq) { applyQuote(null); quoteBox.textContent = err.message; } }
  }
  form.addEventListener('change', refreshQuote);
  refreshQuote();
  return quoted;
}

// ---------------------------------------------------------------- list
export async function reservationsView(el, { query }) {
  const canManage = !['staff', 'cleaner'].includes(state.user.role);
  const defaults = { view: 'upcoming', q: '', channel: '', property_id: '', unit_id: '', payment: '', guest: '', from: '', to: '', out_from: '', out_to: '', min_nights: '', min_guests: '', checkin_form: '', sort: '' };
  const filters = initFilters('reservations', query, defaults);
  if (!VIEWS.some(([v]) => v === filters.view)) filters.view = 'upcoming';
  const [{ properties }, { units }] = await Promise.all([get('/properties'), get('/units')]);
  const listBox = h('div', { class: 'card' });
  const viewSelect = h('select', { class: 'input', 'aria-label': 'Saved view' }, VIEWS.map(([v, t]) => h('option', { value: v, selected: v === filters.view }, t)));
  const exportLink = h('a', { class: 'btn btn--secondary', download: '' }, 'Export CSV');
  const side = h('nav', { class: 'saved-views', 'aria-label': 'Saved views' });
  const stUnits = units.filter((u) => u.nightly_rate !== null && u.nightly_rate !== undefined);

  async function load() {
    history.replaceState(null, '', `#/reservations${qs(changed(filters, { ...defaults, view: '' }))}`);
    // Same query as the list below, so the export matches what is on screen. view is always sent, once.
    exportLink.href = `/api/reservations/export${qs(changed(filters, { ...defaults, view: '' }))}`;
    viewSelect.value = filters.view;
    side.replaceChildren(...VIEWS.map(([v, t]) => h('button', { type: 'button', 'aria-current': v === filters.view ? 'true' : null, onclick: () => { filters.view = v; rememberFilters('reservations', filters); load(); } }, t)));
    const { reservations } = await get(`/reservations${qs(changed(filters, { ...defaults, view: '' }))}`);
    const filtered = Object.keys(changed(filters, defaults)).some((k) => k !== 'view' && k !== 'sort');
    if (!reservations.length) {
      listBox.replaceChildren(emptyState({
        iconName: 'inbox',
        title: filtered ? 'No results found' : 'Nothing here yet',
        text: filtered ? 'Try removing a filter or choosing another view.' : 'Reservations you add, or import from Airbnb/Booking.com, appear here.',
        action: !filtered && canManage && h('button', { class: 'btn btn--primary', onclick: () => newReservationModal({ onSaved: load }) }, icon('plus'), 'New reservation'),
      }));
      return;
    }
    const total = reservations.filter((r) => r.status === 'confirmed').reduce((s, r) => s + Number(r.total_amount), 0);
    const due = reservations.filter((r) => r.status === 'confirmed').reduce((s, r) => s + Math.max(0, Number(r.balance)), 0);
    listBox.replaceChildren(
      h('p', { class: 'muted small' }, `Showing ${reservations.length} reservation${reservations.length === 1 ? '' : 's'}${canManage ? ` · ${peso(total)} booked · ${peso(due)} still to collect` : ''}`),
      h('div', { class: 'table-wrap res-table' }, h('table', { class: 'table' },
        // Money sits right after the dates. On a phone each row is a card (D-80), so Check-out and Listing show there; Channel and Code hide.
        h('thead', null, h('tr', null,
          h('th', null, 'Check-in'), h('th', null, 'Check-out'),
          h('th', { class: 'num' }, 'Total'), h('th', { class: 'num' }, 'Balance'),
          h('th', null, 'Guest'), h('th', null, 'Listing'),
          h('th', { class: 'col-sm-hide' }, 'Channel'), h('th', { class: 'col-sm-hide' }, 'Code'))),
        h('tbody', null, reservations.map((r) => h('tr', { class: 'row-link', onclick: () => navigate(`#/reservations/${r.booking_id}`) },
          h('td', null, h('a', { href: `#/reservations/${r.booking_id}` }, fmtDate(r.check_in)), h('div', { class: 'muted small' }, `${r.nights} night${r.nights > 1 ? 's' : ''}`)),
          h('td', null, fmtDate(r.check_out)),
          h('td', { class: 'num' }, peso(r.total_amount)),
          h('td', { class: `num${Number(r.balance) > 0 && r.status === 'confirmed' ? ' amount--neg' : ''}` }, r.status === 'confirmed' ? peso(r.balance) : '—'),
          h('td', null, h('strong', null, r.guest_name || r.guest_label || 'Guest'), r.guest_vip ? ' ⭐' : null, r.status === 'cancelled' ? [' ', badge('voided', 'Cancelled')] : null,
            r.num_guests ? h('div', { class: 'muted small' }, `${r.num_guests} guest${r.num_guests > 1 ? 's' : ''}`) : null),
          h('td', null, r.unit_name, h('div', { class: 'muted small' }, r.property_name)),
          h('td', { class: 'col-sm-hide' }, channelBadge(r.channel)),
          h('td', { class: 'small col-sm-hide' }, r.confirmation_code)))))));
  }
  viewSelect.addEventListener('change', () => { filters.view = viewSelect.value; rememberFilters('reservations', filters); load(); });
  const bar = filterBar({
    key: 'reservations', values: filters, defaults, onChange: load,
    extra: h('div', { class: 'res-view-select' }, viewSelect),
    search: { placeholder: 'Search guest, code or listing' },
    quick: [
      { name: 'channel', label: 'Channel', all: 'All channels', options: Object.entries(CHANNEL_LABEL) },
      properties.length > 1 && { name: 'property_id', label: 'Property', all: 'All properties', options: properties.map((p) => [p.property_id, p.property_name]) },
    ].filter(Boolean),
    more: [
      { name: 'unit_id', label: 'Listing', all: 'All listings', options: stUnits.map((u) => [u.unit_id, `${u.unit_name}${properties.length > 1 ? ` · ${u.property_name || ''}` : ''}`]) },
      { name: 'from', keys: ['from', 'to'], label: 'Check-in between', type: 'daterange' },
      { name: 'out', keys: ['out_from', 'out_to'], label: 'Check-out between', type: 'daterange' },
      canManage && { name: 'payment', label: 'Payment', all: 'Any', options: [['unpaid', 'Not paid yet'], ['partial', 'Partly paid'], ['paid', 'Fully paid']] },
      { name: 'guest', label: 'Guest', all: 'Any guest', options: [['first', 'First-time guests'], ['repeat', 'Repeat guests'], ['vip', 'VIP guests']] },
      canManage && { name: 'checkin_form', label: 'Check-in form', all: 'Any', options: [['missing', 'Not filled in yet'], ['done', 'Filled in']] },
      { name: 'min_nights', label: 'Nights (at least)', type: 'number', min: 1 },
      { name: 'min_guests', label: 'Guests (at least)', type: 'number', min: 1 },
      { name: 'sort', label: 'Sort by', all: 'Default for this view', options: [['checkin', 'Check-in (soonest first)'], ['checkin_desc', 'Check-in (latest first)'], ['checkout', 'Check-out'], ['created', 'Newest bookings'], ['total', 'Highest total'], ['balance', 'Biggest balance']] },
    ].filter(Boolean),
  });
  await load();
  el.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' }, h('h1', null, 'Reservations'), h('p', null, 'Every stay, from booking to check-out')),
      h('div', { class: 'page-head__actions' },
        canManage && h('button', { class: 'btn btn--primary', onclick: () => newReservationModal({ onSaved: load }) }, icon('plus'), 'New reservation'),
        exportLink)),
    h('div', { class: 'res-layout' },
      h('aside', { class: 'card res-side' }, h('h3', { class: 'subhead' }, 'Saved views'), side),
      h('div', null, bar, listBox)));
  if (query.new && canManage) newReservationModal({ onSaved: load });
}

// ---------------------------------------------------------------- damage and lost-and-found cards (owners and managers)
const DAMAGE_STATUS = { open: ['overdue', 'Open'], charged: ['paid', 'Charged'], deducted: ['partial', 'Deduct from deposit'], waived: ['voided', 'Waived'] };
const LOST_STATUS = { held: ['partial', 'Held'], returned: ['paid', 'Returned'], disposed: ['voided', 'Disposed'] };
const FOUND_NEXT = [['held', 'Held'], ['returned', 'Returned'], ['disposed', 'Disposed']];

async function damageCard(r, rerender) {
  const d = await get(`/reservations/${r.booking_id}/damage`);
  const reports = d.reports || [];
  if (!reports.length) return null;
  const run = async (path, body, msg) => { try { await post(path, body); toast(msg); rerender(); } catch (err) { toast(err.message, 'error'); } };
  const charge = (x) => formModal({
    title: 'Charge the guest for damage', submitText: 'Add charge',
    fields: [
      h('p', { class: 'muted small' }, x.description),
      field({ name: 'amount', label: 'Amount', type: 'money', required: true, value: x.estimated_cost || '' }),
      field({ name: 'description', label: 'Description on the charge', required: true, maxlength: 200, value: `Damage: ${x.description}`.slice(0, 200) }),
    ],
    onSubmit: async (v) => { await post(`/damage-reports/${x.report_id}/charge`, v); toast('Charge added to the booking.'); rerender(); },
  });
  const waive = (x) => formModal({
    title: 'Waive this damage report', submitText: 'Waive',
    fields: [field({ name: 'note', label: 'Note (optional)', type: 'textarea', maxlength: 500 })],
    onSubmit: async (v) => { await post(`/damage-reports/${x.report_id}/waive`, v); toast('Damage report waived.'); rerender(); },
  });
  const deduct = async (x) => {
    if (!await confirmDialog({ title: 'Deduct from the deposit?', text: 'The amount is pre-filled when you return the deposit. Nothing is taken until you do.', confirmText: 'Deduct from deposit' })) return;
    run(`/damage-reports/${x.report_id}/deduct`, {}, 'Marked to deduct from the deposit.');
  };
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Damage reports'), h('span', { class: 'muted small' }, `${reports.length} report${reports.length === 1 ? '' : 's'}`)),
    h('ul', { class: 'list' }, reports.map((x) => {
      const [cls, text] = DAMAGE_STATUS[x.status] || ['voided', x.status];
      return h('li', null, h('div', { class: 'row' },
        h('div', { class: 'row__main' },
          h('span', { class: 'row__title' }, x.description),
          h('span', { class: 'row__sub' }, `${x.estimated_cost ? `Estimated ${peso(x.estimated_cost)} · ` : ''}${fmtDate(manilaDay(x.created_at))}${x.resolution_note ? ` · ${x.resolution_note}` : ''}`)),
        h('div', { class: 'row__end' }, badge(cls, text))),
      x.status === 'open' && h('div', { class: 'chips', style: { margin: '4px 0 10px' } },
        h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => charge(x) }, 'Charge the guest'),
        h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => deduct(x) }, 'Deduct from deposit'),
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => waive(x) }, 'Waive')));
    })));
}

async function lostFoundCard(r, rerender) {
  const d = await get(`/reservations/${r.booking_id}/lost-found`);
  const items = d.items || [];
  if (!items.length) return null;
  const setStatus = async (x, status) => {
    if (status === x.status) return;
    try { await patch(`/lost-found/${x.item_id}`, { status }); toast('Updated.'); rerender(); } catch (err) { toast(err.message, 'error'); rerender(); }
  };
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Lost and found')),
    h('ul', { class: 'list' }, items.map((x) => {
      const [cls, text] = LOST_STATUS[x.status] || ['voided', x.status];
      return h('li', null, h('div', { class: 'row' },
        h('div', { class: 'row__main' },
          h('span', { class: 'row__title' }, x.description),
          h('span', { class: 'row__sub' }, `${x.found_where ? `${x.found_where} · ` : ''}Found ${fmtDate(x.found_on)}${x.status_note ? ` · ${x.status_note}` : ''}`)),
        h('div', { class: 'row__end' }, badge(cls, text),
          h('select', { class: 'select', 'aria-label': `Status of ${x.description}`, onchange: (e) => setStatus(x, e.target.value) },
            FOUND_NEXT.map(([v, t]) => h('option', { value: v, selected: v === x.status }, t))))));
    })));
}

// ---------------------------------------------------------------- activity log and move (Phase 5)
async function activityCard(r) {
  const { items } = await get(`/reservations/${r.booking_id}/activity`);
  const body = h('div');
  let all = false;
  const paint = () => {
    const shown = all ? items : items.slice(0, 10);
    body.replaceChildren(
      shown.length ? h('ul', { class: 'list act-list' }, shown.map((i) => h('li', { class: `act-item act-item--${i.kind}` },
        h('span', { class: 'act-item__text' }, i.text),
        h('span', { class: 'row__sub' }, `${i.who || 'System'} · ${fmtDateTime(i.at)}`)))) : h('p', { class: 'muted small' }, 'Nothing has happened on this booking yet.'),
      items.length > 10 && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-expanded': String(all), onclick: () => { all = !all; paint(); } }, all ? 'Show fewer' : `Show all ${items.length}`));
  };
  paint();
  return h('div', { class: 'card' }, h('div', { class: 'card__head' }, h('h2', null, 'Activity')), body);
}

async function moveModal(r, rerender) {
  let listings;
  try { ({ listings } = await get('/listings')); } catch (err) { toast(err.message, 'error'); return; }
  const others = listings.filter((l) => l.unit_id !== r.unit_id)
    .sort((a, b) => (b.property_id === r.property_id) - (a.property_id === r.property_id));
  if (!others.length) { toast('There is no other active listing to move to.', 'error'); return; }
  formModal({
    title: 'Move to another listing', submitText: 'Move reservation',
    fields: [
      h('p', { class: 'muted small' }, `${r.unit_name} · ${fmtDate(r.check_in)} – ${fmtDate(r.check_out)}. The dates and the price stay the same.`),
      field({ name: 'unit_id', label: 'Move to', type: 'select', required: true, placeholderOption: false, options: others.map((l) => [l.unit_id, `${l.unit_name} — ${l.property_name}`]) }),
    ],
    onSubmit: async (d) => { await patch(`/reservations/${r.booking_id}`, { unit_id: d.unit_id }); toast('Reservation moved.'); rerender(); },
  });
}

// ---------------------------------------------------------------- detail
export async function reservationDetailView(el, { params, rerender }) {
  const { reservation: r, payments } = await get(`/reservations/${params.id}`);
  const canManage = !['staff', 'cleaner'].includes(state.user.role);
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
      // Below 0 the guest overpaid: the same figure, and wording, as the page (net of refunds already recorded).
      h('div', { class: 'alert alert--info' }, Number(r.balance) < 0
        ? (overpaidAfterRefunds(r.balance, heldInfo?.refunded) > 0 ? `Guest overpaid by ${peso(overpaidAfterRefunds(r.balance, heldInfo?.refunded))}.` : 'Nothing more is owed on this booking.')
        : `Balance: ${peso(r.balance)} of ${peso(r.total_amount)}${Number(r.channel_fee) > 0 && !r.channel_fee_ignored ? ` (after the ${peso(r.channel_fee)} channel fee)` : ''}`),
      field({ name: 'amount', label: 'Amount received', type: 'money', required: true, value: Number(r.balance) > 0 ? r.balance : '' }),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'payment_date', label: 'Date received', type: 'date', required: true, value: today, max: today }),
        field({ name: 'payment_method', label: 'Method', type: 'select', required: true, value: r.channel === 'direct' ? 'gcash' : 'channel_payout', placeholderOption: false, options: paymentMethodOptions(r.channel) })),
      field({ name: 'reference_number', label: 'Reference no.', maxlength: 100 }),
      // Channel payouts come from Airbnb/Booking.com, not the guest: no guest receipt by default.
      r.guest_email && field({ name: 'send_receipt', label: `Email a receipt to ${r.guest_email}`, type: 'checkbox', value: r.channel === 'direct' }),
    ],
    onSubmit: async (d, { idempotencyKey }) => {
      if (d.payment_method === 'channel_payout') d.send_receipt = false;
      const res = await post(`/reservations/${r.booking_id}/payments`, d, { idempotencyKey });
      if (res.receipt && !res.receipt.sent) toast(`Payment saved, but the receipt was not emailed: ${res.receipt.error}`, 'error');
      else toast(res.receipt?.sent ? 'Payment saved and receipt emailed.' : 'Payment saved.');
      rerender();
    },
  });

  const editDetails = () => {
    const modal = formModal({
      title: 'Edit reservation', submitText: 'Save changes',
      fields: [
        r.ical_feed_id && h('p', { class: 'muted small' }, `Dates come from ${CHANNEL_LABEL[r.channel]} and update automatically. You can add the amounts here.`),
        r.channel_fee_ignored && h('p', { class: 'muted small' }, `Direct bookings have no channel fee. Saving this form removes the ${peso(r.channel_fee)} fee that is stored on it.`),
        !r.ical_feed_id && h('div', { class: 'form-row form-row--2' },
          field({ name: 'check_in', label: 'Check-in', type: 'date', required: true, value: r.check_in }),
          field({ name: 'check_out', label: 'Check-out', type: 'date', required: true, value: r.check_out })),
        h('div', { class: 'form-row form-row--2' },
          field({ name: 'num_guests', label: 'Number of guests', type: 'number', min: 1, max: 50, value: r.num_guests }),
          field({ name: 'channel', label: 'Booked through', type: 'select', value: r.channel, placeholderOption: false, options: Object.entries(CHANNEL_LABEL) })),
        h('div', { class: 'form-row form-row--2' },
          field({ name: 'accommodation_total', label: 'Accommodation total', type: 'money', value: r.accommodation_total }),
          field({ name: 'cleaning_fee', label: 'Cleaning fee', type: 'money', value: r.cleaning_fee, hint: 'Leave blank for 0.' })),
        h('div', { class: 'form-row form-row--2' },
          field({ name: 'other_fees', label: 'Other fees', type: 'money', value: r.other_fees, hint: 'Leave blank for 0.' }),
          field({ name: 'channel_fee', label: 'Channel fee / commission', type: 'money', value: r.channel_fee, hint: 'What the channel keeps. Used in owner statements. Leave blank for 0.' })),
        field({ name: 'notes', label: 'Notes', type: 'textarea', value: r.notes, maxlength: 1000 }),
      ],
      onSubmit: async (d) => {
        d.channel_fee = channelFeeToSave(d.channel, r.channel_fee, d.channel_fee);
        const changes = changedFields(r, d);
        // The server says whether it wrote anything (a blank fee is stored as 0, which can be no change at all).
        const saved = Object.keys(changes).length ? await patch(`/reservations/${r.booking_id}`, changes) : { changed: false };
        toast(saved.changed ? 'Reservation updated.' : 'No changes to save.'); rerender();
      },
    });
    const form = modal.el.querySelector('form');
    form.addEventListener('change', (e) => { if (e.target.name === 'channel') syncChannelFee(form, true); });
    syncChannelFee(form, false);
  };

  const cancel = async () => {
    const reason = await confirmDialog({ title: 'Cancel this reservation?', text: 'The dates become available again. Payments stay on record. Record any money you give back in the Refunds card.', confirmText: 'Cancel reservation', cancelText: 'Keep reservation', danger: true, reason: true });
    if (!reason) return;
    try { await post(`/reservations/${r.booking_id}/cancel`, { reason }); toast('Reservation cancelled.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };

  const voidPayment = async (p) => {
    const reason = await confirmDialog({ title: 'Void this payment?', text: `${peso(p.amount)} on ${fmtDate(p.payment_date)}. The record is kept for history.`, confirmText: 'Void payment', danger: true, reason: true });
    if (!reason) return;
    try { await post(`/booking-payments/${p.payment_id}/void`, { reason }); toast('Payment voided.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };

  const checkin = canManage && r.status === 'confirmed' ? await checkinCard(r.booking_id, rerender) : null;
  const gatepass = canManage && r.status === 'confirmed' && r.check_out >= todayManila() ? await gatepassCard(r.booking_id, rerender) : null;
  const deposit = await depositCard(r, rerender);
  // Money cards sit under Payment. A card that fails to load is skipped, so the page still opens.
  const card = (build) => build(r, rerender).catch(() => null);
  const charges = await card(chargesCard);
  const proofs = canManage ? await card(proofsCard) : null;
  const refunds = await card(refundsCard);
  const damage = canManage ? await card(damageCard) : null;
  const lostFound = canManage ? await card(lostFoundCard) : null;
  const activity = canManage ? await activityCard(r).catch(() => null) : null;
  const grp = r.group;
  // Overpaid and "You keep" apply to live bookings only. A cancelled booking that still holds money points to the Refunds card instead.
  const heldInfo = canManage && (!confirmed || Number(r.balance) < 0) ? await get(`/reservations/${r.booking_id}/refunds`).catch(() => null) : null;
  const overpaid = canManage && confirmed && heldInfo ? overpaidAfterRefunds(r.balance, heldInfo.refunded) : 0;
  // A cancelled booking owes back what the cancellation policy suggests, not everything paid.
  const sug = heldInfo?.suggestion;
  // With no suggestion (no policy, or Custom) the alert still says what is held, so it shows then too.
  const showRefundAlert = heldInfo && !confirmed && Number(heldInfo.refundable) > 0 && (!sug || Number(sug.amount) > 0);
  const nonRefundable = heldInfo && !confirmed && Number(heldInfo.refundable) > 0 && sug && !(Number(sug.amount) > 0);
  // A stored fee on a direct booking is ignored here too, so "You keep" matches the balance.
  const keep = Number(r.total_amount) - (r.channel_fee_ignored ? 0 : Number(r.channel_fee));
  const feeSaved = r.channel === 'direct' ? Math.round(keep * 15) / 100 : 0;

  // Scrolls to the Refunds card; the links keep the #refunds-card anchor.
  const goRefunds = (e) => { e.preventDefault(); document.getElementById('refunds-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  // Private link where the guest pays the balance online (host's PayMongo).
  const copyPayLink = async () => {
    try {
      const l = await get(`/reservations/${r.booking_id}/payment-link`);
      if (!l.available) { toast(l.reason, 'error'); return; }
      await copyText(l.link, `Payment link for ${peso(l.balance)} copied. Send it to the guest.`, 'Copy the payment link');
    } catch (err) { toast(err.message, 'error'); }
  };

  const copyGuideLink = async () => {
    try {
      const { url } = await post(`/reservations/${r.booking_id}/guide-link`);
      await copyText(url, 'Guidebook link copied. Send it to the guest.', 'Copy the guidebook link');
    } catch (err) { toast(err.message, 'error'); }
  };
  const emailReceipt = async (p) => {
    try { await post(`/booking-payments/${p.payment_id}/send-receipt`); toast(`Receipt emailed to ${r.guest_email}.`); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  const emailConfirmation = async () => {
    try { await post(`/reservations/${r.booking_id}/send-confirmation`); toast(`Confirmation emailed to ${r.guest_email}.`); } catch (err) { toast(err.message, 'error'); }
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
        canManage && confirmed && !r.ical_feed_id && !r.checked_out_at && h('button', { class: 'btn btn--secondary', onclick: () => moveModal(r, rerender) }, 'Move to another listing'),
        canManage && confirmed && !r.ical_feed_id && !r.checked_out_at && h('button', { class: 'btn btn--danger', onclick: cancel }, 'Cancel'))),
    !confirmed && h('div', { class: 'alert alert--error', style: { marginBottom: '16px' } }, `Cancelled ${fmtDateTime(r.cancelled_at)}${r.cancel_reason ? `: ${r.cancel_reason}` : ''}`),
    h('div', { class: 'grid grid--2' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Stay'), h('div', { class: 'chips' }, stayState, channelBadge(r.channel), grp && h('a', { class: 'badge badge--active', href: `#/groups/${grp.group_id}` }, `Group: ${grp.name}`))),
          h('dl', { class: 'dl' },
            h('dt', null, 'Listing'), h('dd', null, `${r.unit_name}, ${r.property_name}`),
            h('dt', null, 'Check-in'), h('dd', null, fmtDate(r.check_in), r.checked_in_at ? h('div', { class: 'muted small' }, `Checked in ${fmtDateTime(r.checked_in_at)}`) : null),
            h('dt', null, 'Check-out'), h('dd', null, fmtDate(r.check_out), r.checked_out_at ? h('div', { class: 'muted small' }, `Checked out ${fmtDateTime(r.checked_out_at)}`) : null),
            h('dt', null, 'Guests'), h('dd', null, r.num_guests ? String(r.num_guests) : '—'),
            r.source && [h('dt', null, 'Source'), h('dd', null, SOURCE_LABEL[r.source] || r.source)],
            canManage && r.rules_accepted_at && [h('dt', null, 'House rules'), h('dd', null, `House rules accepted on ${fmtDateTime(r.rules_accepted_at)}`,
              r.rules_text && h('details', { class: 'hp-rules' }, h('summary', null, 'Show the accepted text'), h('p', null, r.rules_text)))],
            r.notes && [h('dt', null, 'Notes'), h('dd', { style: { whiteSpace: 'pre-wrap' } }, r.notes)])),
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Guest'), r.guest_id && h('a', { href: `#/guests/${r.guest_id}` }, 'Guest profile')),
          guestBadges(r).length > 0 && h('div', { class: 'chips', style: { marginBottom: '10px' } }, guestBadges(r)),
          h('dl', { class: 'dl' },
            h('dt', null, 'Name'), h('dd', null, guestName),
            !r.limited && [h('dt', null, 'Mobile'), h('dd', null, r.guest_phone ? h('a', { href: `tel:${r.guest_phone.replace(/[^\d+]/g, '')}` }, r.guest_phone) : '—'),
              h('dt', null, 'Email'), h('dd', null, r.guest_email ? h('a', { href: `mailto:${r.guest_email}` }, r.guest_email) : '—')]),
          canManage && confirmed && r.guest_email && h('button', { class: 'btn btn--secondary btn--sm', style: { marginTop: '12px' }, onclick: emailConfirmation }, 'Email booking confirmation'),
          canManage && confirmed && h('button', { class: 'btn btn--secondary btn--sm', style: { marginTop: '12px' }, onclick: copyGuideLink }, 'Copy guidebook link'),
          r.ical_feed_id && h('p', { class: 'muted small', style: { marginTop: '10px' } }, `Imported from ${CHANNEL_LABEL[r.channel]}. Guest details stay on ${CHANNEL_LABEL[r.channel]}.`)),
        r.review && h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Guest review'), h('span', { class: 'muted small' }, 'Private')),
          h('p', null, stars(r.review.rating), ` ${r.review.rating}/5`, r.review.cleanliness ? h('span', { class: 'muted small' }, ` · cleanliness ${r.review.cleanliness}/5`) : null),
          r.review.comment && h('p', { style: { whiteSpace: 'pre-wrap' } }, `“${r.review.comment}”`)),
        checkin, gatepass, deposit, damage, lostFound, activity),
      h('div', { class: 'stack' },
        h('div', { class: 'card', id: 'payment-card' },
          overpaid > 0 && h('div', { class: 'alert alert--warn', role: 'alert', style: { marginBottom: '12px' } },
            `Guest overpaid by ${peso(overpaid)} — `,
            h('a', { href: '#refunds-card', onclick: goRefunds }, 'record a refund')),
          confirmed && r.channel_fee_ignored && h('div', { class: 'alert alert--warn', role: 'alert', style: { marginBottom: '12px' } },
            `This direct booking has a ${peso(r.channel_fee)} channel fee. Direct bookings don't have one, so the guest is asked for the full amount. Edit the booking to clear it, or change Booked through.`),
          showRefundAlert && h('div', { class: 'alert alert--warn', role: 'alert', style: { marginBottom: '12px' } },
            `${refundAlertText({ suggestion: sug, refundable: heldInfo.refundable, paid: heldInfo.paid, policy: heldInfo.policy })} `,
            h('a', { href: '#refunds-card', onclick: goRefunds }, 'See the Refunds card.')),
          nonRefundable && h('div', { class: 'alert alert--info', style: { marginBottom: '12px' } }, 'Cancelled: non-refundable, nothing is due back.'),
          h('div', { class: 'card__head' }, h('h2', null, 'Payment'), h('div', { class: 'chips' },
            canManage && confirmed && Number(r.balance) > 0 && h('button', { class: 'btn btn--secondary btn--sm', onclick: copyPayLink }, 'Copy payment link'),
            confirmed && h('button', { class: 'btn btn--primary btn--sm', onclick: recordPayment }, 'Record payment'))),
          h('dl', { class: 'dl' },
            h('dt', null, 'Accommodation'), h('dd', null, peso(r.accommodation_total)),
            h('dt', null, 'Cleaning fee'), h('dd', null, peso(r.cleaning_fee)),
            Number(r.other_fees) > 0 && [h('dt', null, 'Other fees'), h('dd', null, peso(r.other_fees))],
            Number(r.extras_total) > 0 && [h('dt', null, 'Extras'), h('dd', null, peso(r.extras_total))],
            h('dt', null, 'Total'), h('dd', null, h('strong', null, peso(r.total_amount))),
            Number(r.channel_fee) > 0 && !r.channel_fee_ignored && [h('dt', null, 'Channel fee'), h('dd', { class: 'muted' }, `− ${peso(r.channel_fee)}`)],
            h('dt', null, 'Paid'), h('dd', null, peso(r.amount_paid)),
            confirmed ? [h('dt', null, 'Balance'), h('dd', { class: Number(r.balance) > 0 ? 'amount--neg' : '' }, h('strong', null, peso(r.balance)))]
              : [h('dt', null, 'Balance'), h('dd', { class: 'muted' }, 'Cancelled — not owed')]),
          canManage && confirmed && h('div', { class: 'keep-line' },
            h('div', null, 'You keep ', h('strong', null, peso(keep))),
            feeSaved > 0 && h('div', { class: 'keep-line__save' }, `No channel fee — about ${peso(feeSaved)} saved vs a 15% channel fee on this stay's total`),
            r.channel !== 'direct' && Number(r.channel_fee) === 0 && h('div', { class: 'muted small' }, 'Enter the channel fee (Edit) to see what you keep.')),
          h('h3', { class: 'subhead', style: { marginTop: '16px' } }, 'Payments'),
          payments.length ? h('ul', { class: 'list' }, payments.map((p) => h('li', null, h('div', { class: 'row' },
            h('div', { class: 'row__main' },
              h('span', { class: `row__title${p.voided_at ? ' strike' : ''}` }, `${peso(p.amount)} · ${METHOD_LABEL[p.payment_method]}`),
              h('span', { class: 'row__sub' }, `${fmtDate(p.payment_date)}${p.reference_number ? ` · Ref ${p.reference_number}` : ''} · by ${p.recorded_by_name}${p.receipt_number ? ` · ${p.receipt_number}` : ''}${p.receipt_sent_at ? ' · receipt emailed' : ''}`),
              p.voided_at && h('span', { class: 'row__sub' }, `Voided: ${p.void_reason}`)),
            h('div', { class: 'row__end' }, p.voided_at ? badge('voided', 'Voided') : h('div', { class: 'chips' },
              h('a', { class: 'btn btn--ghost btn--sm', href: `#/receipts/${p.payment_id}` }, 'Receipt'),
              canManage && r.guest_email && h('button', { class: 'btn btn--ghost btn--sm', onclick: () => emailReceipt(p) }, p.receipt_sent_at ? 'Email again' : 'Email'),
              canManage && h('button', { class: 'btn btn--ghost btn--sm', onclick: () => voidPayment(p) }, 'Void')))))))
            : h('p', { class: 'muted small' }, 'No payments recorded yet.')),
        charges, proofs, refunds && h('div', { id: 'refunds-card' }, refunds))));
}

// ---------------------------------------------------------------- printable receipt
export async function receiptView(el, { params }) {
  const { receipt: r } = await get(`/booking-payments/${params.id}/receipt`);
  el.replaceChildren(
    h('a', { class: 'back no-print', href: `#/reservations/${r.booking_id}` }, '‹ Reservation'),
    h('div', { class: 'page-head no-print' },
      h('div', { class: 'page-head__title' }, h('h1', null, `Receipt ${r.receipt_number}`)),
      h('div', { class: 'page-head__actions' }, h('button', { class: 'btn btn--primary', onclick: () => window.print() }, 'Print / save as PDF'))),
    h('div', { class: 'card receipt' },
      r.voided_at && h('div', { class: 'alert alert--error' }, `VOIDED ${fmtDateTime(r.voided_at)}: ${r.void_reason || ''}`),
      h('div', { class: 'receipt__head' },
        h('div', null, h('h2', null, r.workspace_name), h('div', { class: 'muted small' }, r.property_name)),
        h('div', { class: 'receipt__no' }, h('div', { class: 'subhead' }, 'Acknowledgement receipt'), h('strong', null, r.receipt_number))),
      h('dl', { class: 'dl' },
        h('dt', null, 'Received from'), h('dd', null, r.guest_name),
        h('dt', null, 'Amount'), h('dd', null, h('strong', { class: 'receipt__amount' }, peso(r.amount))),
        h('dt', null, 'Date received'), h('dd', null, fmtDate(r.payment_date)),
        h('dt', null, 'Payment method'), h('dd', null, `${METHOD_LABEL[r.payment_method] || r.payment_method}${r.reference_number ? ` · Ref. ${r.reference_number}` : ''}`),
        h('dt', null, 'For'), h('dd', null, `${r.unit_name}, ${fmtDate(r.check_in)} – ${fmtDate(r.check_out)} (booking ${r.confirmation_code})`),
        h('dt', null, 'Booking total'), h('dd', null, peso(r.total_amount)),
        Number(r.adjustments) > 0 && [h('dt', null, 'Adjustments (settled through the booking channel)'), h('dd', null, `-${peso(r.adjustments)}`)],
        h('dt', null, 'Remaining balance'), h('dd', null, peso(Math.max(0, Number(r.balance_after)))),
        h('dt', null, 'Received by'), h('dd', null, r.recorded_by_name || '—')),
      h('p', { class: 'muted small', style: { marginTop: '18px' } }, 'This is an acknowledgement receipt for your records, not a BIR official receipt.')));
}
