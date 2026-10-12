// Multi-calendar: listings down the side, dates across, reservations as bars,
// nightly prices on open nights. Tap an open night to book, block or reprice.

import { get, post, api, qs } from '../api.js';
import { h, icon, peso, fmtDate, field, formModal, openModal, confirmDialog, toast, emptyState, searchBox } from '../ui.js';
import { state, navigate } from '../app.js';
import { addDays, newReservationModal, CHANNEL_LABEL } from './reservations.js';

const dayName = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', timeZone: 'UTC' });
const dayNum = (d) => Number(d.slice(8, 10));
const monthName = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortPeso = (v) => (v === null || v === undefined ? '' : `₱${Math.round(Number(v)).toLocaleString('en-PH')}`);

export async function calendarView(el, { query }) {
  const canManage = state.user.role !== 'staff';
  const view = { start: query.start || null, days: Number(query.days) === 30 ? 30 : 14, q: query.q || '' };
  const grid = h('div', { class: 'cal-scroll' });
  const title = h('strong', { class: 'cal-title' });
  const dateInput = h('input', { class: 'input input--sm', type: 'date', 'aria-label': 'Go to date' });

  async function load() {
    const data = await get(`/calendar${qs({ start: view.start, days: view.days })}`);
    view.start = data.start;
    history.replaceState(null, '', `#/calendar${qs({ start: view.start, days: view.days === 14 ? '' : view.days, q: view.q })}`);
    title.textContent = monthName(data.start);
    dateInput.value = data.start;
    render(data);
  }

  function render(data) {
    const dates = Array.from({ length: data.days }, (_, i) => addDays(data.start, i));
    const listings = data.listings.filter((l) => !view.q || `${l.unit_name} ${l.property_name}`.toLowerCase().includes(view.q.toLowerCase()));
    if (!data.listings.length) {
      grid.replaceChildren(emptyState({ iconName: 'building', title: 'No listings yet', text: 'Add a listing to start filling your calendar.', action: canManage && h('a', { class: 'btn btn--primary', href: '#/listings?new=1' }, 'Add listing') }));
      return;
    }
    const rates = new Map(data.rates.map((r) => [`${r.unit_id}|${r.rate_date}`, r.price]));
    const table = h('div', { class: 'cal', style: { '--cal-days': data.days } });
    table.append(h('div', { class: 'cal-row cal-row--head' },
      h('div', { class: 'cal-side' }, `${listings.length} listing${listings.length === 1 ? '' : 's'}`),
      h('div', { class: 'cal-days' }, dates.map((d) => h('div', {
        class: `cal-day-head${d === data.today ? ' is-today' : ''}${['Sat', 'Sun'].includes(dayName(d)) ? ' is-weekend' : ''}`,
      }, h('span', null, dayName(d)), h('b', null, dayNum(d)))))));

    for (const l of listings) {
      const cells = dates.map((d) => {
        const price = rates.has(`${l.unit_id}|${d}`) ? rates.get(`${l.unit_id}|${d}`) : l.nightly_rate;
        return h('button', {
          class: `cal-cell${d < data.today ? ' is-past' : ''}${d === data.today ? ' is-today' : ''}${rates.has(`${l.unit_id}|${d}`) ? ' has-override' : ''}`,
          type: 'button', 'aria-label': `${l.unit_name}, ${fmtDate(d)}, ${shortPeso(price) || 'no rate'}`,
          onclick: () => cellMenu(l, d, price),
        }, shortPeso(price));
      });
      const bars = data.bookings.filter((b) => b.unit_id === l.unit_id).map((b) => {
        const startIdx = (Date.parse(b.check_in) - Date.parse(data.start)) / 86400000;
        const endIdx = (Date.parse(b.check_out) - Date.parse(data.start)) / 86400000;
        const from = Math.max(startIdx + 0.5, 0);
        const to = Math.min(endIdx + 0.5, data.days);
        if (to <= from) return null;
        const isBlock = b.kind === 'block';
        return h('button', {
          type: 'button',
          class: `cal-bar cal-bar--${isBlock ? 'block' : b.channel}${startIdx + 0.5 < 0 ? ' cut-left' : ''}${endIdx + 0.5 > data.days ? ' cut-right' : ''}`,
          style: { left: `calc(${from} * var(--cal-col))`, width: `calc(${to - from} * var(--cal-col) - 3px)` },
          title: isBlock ? `Blocked: ${b.block_reason || ''}` : `${b.guest_name} · ${b.check_in} → ${b.check_out}`,
          onclick: (e) => { e.stopPropagation(); if (isBlock) blockMenu(b); else navigate(`#/reservations/${b.booking_id}`); },
        }, isBlock ? `🔒 ${b.block_reason || 'Blocked'}` : `${b.guest_name || 'Guest'}${b.num_guests ? ` · ${b.num_guests}` : ''}`);
      });
      table.append(h('div', { class: 'cal-row' },
        h('div', { class: 'cal-side' },
          h('a', { href: `#/listings?focus=${l.unit_id}`, class: 'cal-name' }, l.unit_name),
          h('span', { class: 'cal-prop' }, l.property_name),
          h('span', { class: `badge badge--${l.cleaning_status === 'dirty' ? 'overdue' : 'paid'}` }, l.cleaning_status === 'dirty' ? 'Dirty' : 'Clean')),
        h('div', { class: 'cal-days cal-days--body' }, cells, bars)));
    }
    grid.replaceChildren(listings.length ? table : emptyState({ title: 'No results found', text: `No listing matches “${view.q}”.` }));
    const todayCell = grid.querySelector('.cal-day-head.is-today');
    if (todayCell) grid.scrollLeft = Math.max(0, todayCell.offsetLeft - 220);
  }

  function cellMenu(listing, date, price) {
    if (!canManage) { toast('Only owners and managers can change the calendar.'); return; }
    const m = openModal({
      title: `${listing.unit_name} · ${fmtDate(date)}`,
      body: h('div', { class: 'form' },
        h('p', { class: 'muted' }, `Nightly price: ${price ? peso(price) : 'not set'}`),
        h('button', { class: 'btn btn--primary btn--block', onclick: () => { m.close(); newReservationModal({ unitId: listing.unit_id, checkIn: date, onSaved: load }); } }, icon('plus'), 'New reservation'),
        h('button', { class: 'btn btn--secondary btn--block', onclick: () => { m.close(); blockModal(listing, date); } }, '🔒 Block dates'),
        h('button', { class: 'btn btn--secondary btn--block', onclick: () => { m.close(); priceModal(listing, date, price); } }, '₱ Set nightly price')),
    });
  }

  function blockModal(listing, date) {
    formModal({
      title: `Block ${listing.unit_name}`, submitText: 'Block dates',
      fields: [
        h('div', { class: 'form-row form-row--2' },
          field({ name: 'start_date', label: 'First blocked night', type: 'date', required: true, value: date }),
          field({ name: 'end_date', label: 'Last blocked night', type: 'date', required: true, value: date })),
        field({ name: 'reason', label: 'Reason', placeholder: 'e.g. Owner stay, repairs', maxlength: 200 }),
        h('p', { class: 'muted small' }, 'Blocked nights also show as unavailable on Airbnb/Booking.com once they read your BalayHub calendar link.'),
      ],
      onSubmit: async (d) => { await post('/blocks', { ...d, unit_id: listing.unit_id }); toast('Dates blocked.'); load(); },
    });
  }

  function priceModal(listing, date, price) {
    formModal({
      title: `Nightly price · ${listing.unit_name}`, submitText: 'Save price',
      fields: [
        h('div', { class: 'form-row form-row--2' },
          field({ name: 'start_date', label: 'From night', type: 'date', required: true, value: date }),
          field({ name: 'end_date', label: 'To night', type: 'date', required: true, value: date })),
        field({ name: 'price', label: 'Price per night', type: 'money', value: price, hint: `Leave empty to use the listing's base rate (${listing.nightly_rate ? peso(listing.nightly_rate) : 'not set'}).` }),
      ],
      onSubmit: async (d) => { await api('PUT', '/rates', { ...d, unit_id: listing.unit_id }); toast('Price saved.'); load(); },
    });
  }

  async function blockMenu(b) {
    if (b.from_channel) { toast('This block comes from a channel calendar. Change it on the channel.'); return; }
    if (!canManage) return;
    if (!await confirmDialog({ title: 'Remove this block?', text: `${b.block_reason || 'Blocked'}: ${fmtDate(b.check_in)} to ${fmtDate(addDays(b.check_out, -1))}. The nights become available again.`, confirmText: 'Remove block' })) return;
    try { await post(`/blocks/${b.booking_id}/remove`); toast('Block removed.'); load(); } catch (err) { toast(err.message, 'error'); }
  }

  dateInput.addEventListener('change', () => { if (dateInput.value) { view.start = dateInput.value; load(); } });
  const legend = h('div', { class: 'chips cal-legend' },
    ['direct', 'airbnb', 'booking', 'agoda'].map((c) => h('span', { class: 'cal-legend__item' }, h('span', { class: `cal-swatch cal-bar--${c}` }), CHANNEL_LABEL[c])),
    h('span', { class: 'cal-legend__item' }, h('span', { class: 'cal-swatch cal-bar--block' }), 'Blocked'));

  el.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' }, h('h1', null, 'Multi-calendar'), h('p', null, 'Tap an open night to book, block or change its price')),
      canManage && h('div', { class: 'page-head__actions' }, h('button', { class: 'btn btn--primary', onclick: () => newReservationModal({ onSaved: load }) }, icon('plus'), 'New reservation'))),
    h('div', { class: 'toolbar' },
      searchBox({ value: view.q, placeholder: 'Search listings', onSearch: (q) => { view.q = q; load(); } }),
      h('div', { class: 'chips' },
        h('button', { class: 'btn btn--secondary btn--sm', 'aria-label': 'Earlier', onclick: () => { view.start = addDays(view.start, -7); load(); } }, '‹'),
        title,
        h('button', { class: 'btn btn--secondary btn--sm', 'aria-label': 'Later', onclick: () => { view.start = addDays(view.start, 7); load(); } }, '›'),
        h('button', { class: 'btn btn--ghost btn--sm', onclick: () => { view.start = null; load(); } }, 'Today'),
        dateInput,
        h('select', { class: 'input input--sm', 'aria-label': 'Days shown', onchange: (e) => { view.days = Number(e.target.value); load(); } },
          h('option', { value: 14, selected: view.days === 14 }, '14 days'), h('option', { value: 30, selected: view.days === 30 }, '30 days')))),
    legend,
    h('div', { class: 'card card--flush' }, grid));
  await load();
}
