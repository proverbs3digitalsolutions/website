// Multi-calendar: listings down the side, dates across, reservations as bars,
// nightly prices on open nights. Tap an open night to book, block or reprice.

import { get, post, patch, api, qs, ApiError } from '../api.js';
import { h, icon, peso, pesoShort, parseAmount, fmtDate, field, formModal, openModal, confirmDialog, toast, emptyState, label } from '../ui.js';
import { initFilters, filterBar, changed } from '../filters.js';
import { highRateOk } from '../rates.js';
import { state, navigate } from '../app.js';
import { addDays, newReservationModal, CHANNEL_LABEL } from './reservations.js';

const dayName = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', timeZone: 'UTC' });
const dayNum = (d) => Number(d.slice(8, 10));
// The 1st of a month reads "Nov 1", so a month change shows in the day header.
const dayLabel = (d) => (dayNum(d) === 1 ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : dayNum(d));
const monthName = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortPeso = (v) => (v === null || v === undefined ? '' : `₱${Math.round(Number(v)).toLocaleString('en-PH')}`);
// Cells are narrow: from ₱100,000 up a price reads as ₱100K or ₱1.2M. The full amount stays in the cell's title and aria-label.
const compactPeso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 });
const cellPeso = (v) => (Number(v) >= 100000 ? compactPeso.format(Number(v)) : shortPeso(v));
// One sync problem as a line: its channel and link host, so two links on one listing read differently.
const problemLine = (p) => `${CHANNEL_LABEL[p.channel] || 'Calendar'}${p.host ? ` (${p.host})` : ''}: ${p.message}`;

// The grid title: one month, or both months when the shown days run into the next one ("October – November 2026").
export function rangeTitle(start, days) {
  const last = addDays(start, days - 1);
  if (last.slice(0, 7) === start.slice(0, 7)) return monthName(start);
  const first = start.slice(0, 4) === last.slice(0, 4) ? new Date(`${start}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', timeZone: 'UTC' }) : monthName(start);
  return `${first} – ${monthName(last)}`;
}

// A filter value from the link that is not one of the options this person is shown is reset: no chip, and no listing
// hidden for a reason nobody can see. A filter with no options list is left alone.
export function knownFilters(values, options) {
  const out = { ...values };
  for (const [name, list] of Object.entries(options)) if (out[name] && !list.includes(out[name])) out[name] = '';
  return out;
}

// A start date from the link is kept only when it is a complete date from 2000 to 2100 (D-84); anything else is dropped, so the grid
// opens on this week (the D-77 pattern). A date that does not exist (2026-02-30) is kept: the server answers that it was not valid.
export function calendarStart(raw) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw || '')) return null;
  const year = Number(raw.slice(0, 4));
  return year >= 2000 && year <= 2100 ? raw : null;
}

// The booking or block that covers this night of this listing, or null. A night runs from check-in up to check-out, so the
// night of the check-out morning is open for a new check-in.
export function nightTaken(bookings, unitId, date) {
  return bookings.find((b) => b.unit_id === unitId && b.check_in <= date && date < b.check_out) || null;
}

export async function calendarView(el, { query }) {
  const canManage = state.user.role !== 'staff';
  const view = { start: calendarStart(query.start), days: Number(query.days) === 30 ? 30 : 14 };
  // Filters only hide rows (client-side); the grid itself is unchanged.
  const defaults = { q: '', property_id: '', unit_type: '', cleaning: '', avail: '', tag: '' };
  const filters = initFilters('calendar', query, defaults);
  const { listings: meta } = await get('/listings');
  const typeOf = new Map(meta.map((l) => [l.unit_id, l.unit_type]));
  const properties = [...new Map(meta.map((l) => [l.property_id, l.property_name])).entries()];
  const types = [...new Set(meta.map((l) => l.unit_type))];
  let lastData = null;
  // Phase 5: tags (owners and managers), sync warnings per listing, and the bar being dragged.
  let tags = [];
  if (canManage) { try { ({ tags } = await get('/tags')); } catch { tags = []; } }
  let tagUnits = null;
  let problems = new Map();
  let dragging = null;
  async function loadTagUnits() {
    tagUnits = null;
    if (!filters.tag) return;
    try { tagUnits = new Set((await get(`/listings${qs({ tag: filters.tag })}`)).listings.map((l) => l.unit_id)); } catch (err) { toast(err.message, 'error'); }
  }
  async function loadProblems() {
    problems = new Map();
    if (!canManage) return;
    try { for (const p of (await get('/sync-health')).problems) problems.set(p.unit_id, [...(problems.get(p.unit_id) || []), p]); } catch { /* the grid works without it */ }
  }
  // A filter value from the link that this person is not shown as an option is reset before the first load.
  Object.assign(filters, knownFilters(filters, {
    property_id: properties.map(([id]) => id), tag: tags.map((t) => t.tag), unit_type: types, avail: ['open', 'empty', 'booked'], cleaning: ['dirty', 'clean'],
  }));
  await loadTagUnits();
  const grid = h('div', { class: 'cal-scroll' });
  const title = h('strong', { class: 'cal-title' });
  const dateInput = h('input', { class: 'input input--sm', type: 'date', 'aria-label': 'Go to date' });

  async function load() {
    const asked = view.start;
    const [data] = await Promise.all([get(`/calendar${qs({ start: view.start, days: view.days })}`), loadProblems()]);
    // The server quietly shows today for a start that isn't a real date (e.g. 2026-02-30); say so.
    if (asked && asked !== data.start) toast("That date wasn't valid, so we're showing today.");
    view.start = data.start;
    lastData = data;
    title.textContent = rangeTitle(data.start, data.days);
    dateInput.value = data.start;
    render(data);
  }

  // Booked nights per listing inside the shown dates (reservations and blocks).
  function bookedNights(data, unitId) {
    const end = addDays(data.start, data.days);
    return data.bookings.filter((b) => b.unit_id === unitId).reduce((n, b) => {
      const from = b.check_in > data.start ? b.check_in : data.start;
      const to = b.check_out < end ? b.check_out : end;
      return n + Math.max(0, (Date.parse(to) - Date.parse(from)) / 86400000);
    }, 0);
  }
  function matches(l, data) {
    const q = filters.q.toLowerCase();
    if (q && !`${l.unit_name} ${l.property_name}`.toLowerCase().includes(q)) return false;
    if (filters.property_id && l.property_id !== filters.property_id) return false;
    if (filters.tag && tagUnits && !tagUnits.has(l.unit_id)) return false;
    if (filters.unit_type && typeOf.get(l.unit_id) !== filters.unit_type) return false;
    if (filters.cleaning === 'dirty' && l.cleaning_status !== 'dirty') return false;
    if (filters.cleaning === 'clean' && l.cleaning_status === 'dirty') return false;
    if (filters.avail) {
      const booked = bookedNights(data, l.unit_id);
      if (filters.avail === 'open' && booked >= data.days) return false;
      if (filters.avail === 'empty' && booked > 0) return false;
      if (filters.avail === 'booked' && booked === 0) return false;
    }
    return true;
  }

  function render(data) {
    const dates = Array.from({ length: data.days }, (_, i) => addDays(data.start, i));
    history.replaceState(null, '', `#/calendar${qs({ start: view.start, days: view.days === 14 ? '' : view.days, ...changed(filters, defaults) })}`);
    const listings = data.listings.filter((l) => matches(l, data));
    if (!data.listings.length) {
      grid.replaceChildren(emptyState({ iconName: 'building', title: 'No listings yet', text: 'Add a listing to start filling your calendar.', action: canManage && h('a', { class: 'btn btn--primary', href: '#/listings?new=1' }, 'Add listing') }));
      return;
    }
    const rates = new Map(data.rates.map((r) => [`${r.unit_id}|${r.rate_date}`, r.price]));
    const prices = new Map((data.prices || []).map((p) => [`${p.unit_id}|${p.date}`, p]));
    const table = h('div', { class: 'cal', style: { '--cal-days': data.days } });
    table.append(h('div', { class: 'cal-row cal-row--head' },
      h('div', { class: 'cal-side' }, `${listings.length} listing${listings.length === 1 ? '' : 's'}`),
      h('div', { class: 'cal-days' }, dates.map((d) => h('div', {
        class: `cal-day-head${d === data.today ? ' is-today' : ''}${['Sat', 'Sun'].includes(dayName(d)) ? ' is-weekend' : ''}`,
      }, h('span', null, dayName(d)), h('b', null, dayLabel(d)))))));

    for (const l of listings) {
      const cells = dates.map((d) => {
        const p = prices.get(`${l.unit_id}|${d}`);
        const price = p ? p.price : rates.has(`${l.unit_id}|${d}`) ? rates.get(`${l.unit_id}|${d}`) : l.nightly_rate;
        const why = p?.label ? ` (${p.label})` : '';
        return h('button', {
          class: `cal-cell${d < data.today ? ' is-past' : ''}${d === data.today ? ' is-today' : ''}${rates.has(`${l.unit_id}|${d}`) ? ' has-override' : ''}${p && ['holiday', 'season', 'weekend'].includes(p.kind) ? ` is-${p.kind}` : ''}`,
          type: 'button', 'aria-label': `${l.unit_name}, ${fmtDate(d)}, ${shortPeso(price) || 'no rate'}${why}`, title: price ? `${shortPeso(price)}${why}` : null,
          onclick: () => cellMenu(l, d, price, p, rates.has(`${l.unit_id}|${d}`)),
        }, cellPeso(price));
      });
      const bars = data.bookings.filter((b) => b.unit_id === l.unit_id).map((b) => {
        const startIdx = (Date.parse(b.check_in) - Date.parse(data.start)) / 86400000;
        const endIdx = (Date.parse(b.check_out) - Date.parse(data.start)) / 86400000;
        const from = Math.max(startIdx + 0.5, 0);
        const to = Math.min(endIdx + 0.5, data.days);
        if (to <= from) return null;
        const isBlock = b.kind === 'block';
        const locked = !isBlock && b.from_channel;
        return h('button', {
          type: 'button',
          draggable: canManage && !isBlock ? 'true' : null,
          ondragstart: (e) => {
            if (locked) { e.preventDefault(); toast(`This stay comes from ${CHANNEL_LABEL[b.channel] || 'a channel'}, so it can't be moved here. Change it on the channel.`); return; }
            dragging = b; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.booking_id);
          },
          ondragend: () => { dragging = null; grid.querySelectorAll('.is-drop').forEach((x) => x.classList.remove('is-drop')); },
          class: `cal-bar cal-bar--${isBlock ? 'block' : b.channel}${startIdx + 0.5 < 0 ? ' cut-left' : ''}${endIdx + 0.5 > data.days ? ' cut-right' : ''}`,
          style: { left: `calc(${from} * var(--cal-col))`, width: `calc(${to - from} * var(--cal-col) - 3px)` },
          title: isBlock ? `Blocked: ${b.block_reason || ''}` : `${b.guest_name} · ${b.check_in} → ${b.check_out}${locked ? ` · From ${CHANNEL_LABEL[b.channel] || 'a channel'}: change it there` : canManage ? ' · Drag to another listing to move it' : ''}`,
          onclick: (e) => { e.stopPropagation(); openBar(b); },
        }, isBlock ? `🔒 ${b.block_reason || 'Blocked'}` : `${b.guest_name || 'Guest'}${b.num_guests ? ` · ${b.num_guests}` : ''}`);
      });
      const warn = problems.get(l.unit_id) || [];
      // Each problem once: two identical overlap rows from one link show as one line.
      const lines = [...new Set(warn.map(problemLine))];
      const row = h('div', { class: 'cal-row' },
        h('div', { class: 'cal-side' },
          h('a', { href: `#/listings?focus=${l.unit_id}`, class: 'cal-name' }, l.unit_name),
          h('span', { class: 'cal-prop' }, l.property_name),
          h('span', { class: `badge badge--${l.cleaning_status === 'dirty' ? 'overdue' : 'paid'}` }, l.cleaning_status === 'dirty' ? 'Dirty' : 'Clean'),
          lines.length > 0 && h('a', { class: 'badge badge--partial cal-warn', href: `#/listings?focus=${l.unit_id}`, title: lines.join(' '), 'aria-label': `Sync problem on ${l.unit_name}: ${lines.join(' ')}` }, `⚠ ${lines.length > 1 ? `${lines.length} sync problems` : 'Sync problem'}`)),
        h('div', { class: 'cal-days cal-days--body' }, cells, bars));
      if (canManage) {
        const ok = () => dragging && dragging.unit_id !== l.unit_id;
        row.addEventListener('dragover', (e) => { if (ok()) { e.preventDefault(); row.classList.add('is-drop'); } });
        row.addEventListener('dragleave', (e) => { if (!row.contains(e.relatedTarget)) row.classList.remove('is-drop'); });
        row.addEventListener('drop', (e) => { e.preventDefault(); row.classList.remove('is-drop'); if (ok()) moveBar(dragging, l); });
      }
      table.append(row);
    }
    grid.replaceChildren(listings.length ? table : emptyState({ title: 'No results found', text: 'No listing matches these filters. Try removing a filter.' }));
    const todayCell = grid.querySelector('.cal-day-head.is-today');
    if (todayCell) grid.scrollLeft = Math.max(0, todayCell.offsetLeft - 220);
  }

  async function moveBar(b, to) {
    const from = lastData.listings.find((x) => x.unit_id === b.unit_id);
    if (!await confirmDialog({ title: 'Move this reservation?', text: `Move ${b.guest_name || 'this guest'} from ${from?.unit_name || 'this listing'} to ${to.unit_name}? The price stays the same.`, confirmText: 'Move reservation' })) return;
    // err.message is the server's reason: the stay or block in the way, or the field messages (already de-duplicated by api.js).
    try { await patch(`/reservations/${b.booking_id}`, { unit_id: to.unit_id }); toast('Reservation moved.'); } catch (err) { toast(err.message, 'error'); }
    load();
  }

  function cellMenu(listing, date, price, rule, overridden) {
    if (!canManage) { toast('Only owners and managers can change the calendar.'); return; }
    // A night under a booking or block opens that booking or block, never the new-booking sheet.
    const taken = nightTaken(lastData.bookings, listing.unit_id, date);
    if (taken) { openBar(taken); return; }
    const m = openModal({
      title: `${listing.unit_name} · ${fmtDate(date)}`,
      body: h('div', { class: 'form' },
        h('p', { class: 'muted' }, `Nightly price: ${price ? peso(price) : 'not set'}${rule?.label ? ` · ${rule.label}` : ''}`),
        h('button', { class: 'btn btn--primary btn--block', onclick: () => { m.close(); newReservationModal({ unitId: listing.unit_id, checkIn: date, onSaved: load }); } }, icon('plus'), 'New reservation'),
        h('button', { class: 'btn btn--secondary btn--block', onclick: () => { m.close(); blockModal(listing, date); } }, '🔒 Block dates'),
        h('button', { class: 'btn btn--secondary btn--block', onclick: () => { m.close(); priceModal(listing, date, price, overridden); } }, '₱ Set nightly price')),
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

  function priceModal(listing, date, price, overridden) {
    // The box starts empty: a pre-filled price would be saved for every night in the range and stop following the usual rates.
    const now = !price ? 'No price is set for this night yet. Type a price to set it for these nights.'
      : overridden ? `Now ${pesoShort(price)}, set on the calendar. Leave empty to go back to your usual rates.`
        : `Now ${pesoShort(price)} from your usual rates. Type a price to set it for these nights; leave empty to use your usual rates.`;
    formModal({
      title: `Nightly price · ${listing.unit_name}`, submitText: 'Save price',
      fields: [
        h('div', { class: 'form-row form-row--2' },
          field({ name: 'start_date', label: 'From night', type: 'date', required: true, value: date }),
          field({ name: 'end_date', label: 'To night', type: 'date', required: true, value: date })),
        field({ name: 'price', label: 'Price per night', type: 'money', hint: now }),
      ],
      onSubmit: async (d, { form }) => {
        // 0 would make the night free; a blank still clears the price back to the usual rates.
        if (d.price.trim() !== '' && Number(d.price) === 0) {
          const m = 'Price must be greater than zero. Leave it blank to use your usual price.';
          throw new ApiError('Please check the highlighted fields.', { status: 400, code: 'VALIDATION', fields: { price: m } });
        }
        // A price above the ceiling is asked about first; "Change it" keeps this dialog open with the price box focused.
        if (!await highRateOk(parseAmount(d.price))) { form.elements.price.focus(); return false; }
        const res = await api('PUT', '/rates', { ...d, unit_id: listing.unit_id });
        // A blank price clears any set prices in the range; the server says how many it removed.
        if (d.price.trim() === '') toast(res.cleared > 0 ? (res.cleared === 1 ? 'Set prices cleared for 1 night. This night uses your usual rates again.' : `Set prices cleared for ${res.cleared} nights. These nights use your usual rates again.`) : 'No set prices to clear. These nights already use your usual rates.');
        else toast('Price saved.');
        load();
      },
    });
  }

  async function blockMenu(b) {
    if (b.from_channel) { toast('This block comes from a channel calendar. Change it on the channel.'); return; }
    if (!canManage) return;
    if (!await confirmDialog({ title: 'Remove this block?', text: `${b.block_reason || 'Blocked'}: ${addDays(b.check_in, 1) === b.check_out ? `the night of ${fmtDate(b.check_in)}` : `${fmtDate(b.check_in)} to ${fmtDate(addDays(b.check_out, -1))}`}. ${addDays(b.check_in, 1) === b.check_out ? 'The night becomes' : 'The nights become'} available again.`, confirmText: 'Remove block' })) return;
    try { await post(`/blocks/${b.booking_id}/remove`); toast('Block removed.'); load(); } catch (err) { toast(err.message, 'error'); }
  }

  // A bar, or a price cell under one, opens the same action: the block menu, or the reservation.
  function openBar(b) {
    if (b.kind === 'block') blockMenu(b); else navigate(`#/reservations/${b.booking_id}`);
  }

  // An emptied box shows the date the grid is on again, so the box and the grid never disagree. A year still being typed
  // reaches here (0002-12-20 on the way to 2026-12-20): only a complete date from 2000 to 2100 (D-84) moves the grid, and
  // anything else is left in the box as typed. Each change restarts a 400 ms wait (K12), so a year typed digit by digit
  // loads the grid once, for the date the box has settled on.
  dateInput.addEventListener('change', (() => {
    let wait = null;
    return () => {
      clearTimeout(wait);
      wait = setTimeout(() => {
        const year = Number(dateInput.value.slice(0, 4));
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value) && year >= 2000 && year <= 2100) { view.start = dateInput.value; load(); }
        else if (!dateInput.value && lastData) dateInput.value = lastData.start;
      }, 400);
    };
  })());
  const legend = h('div', { class: 'chips cal-legend' },
    ['direct', 'airbnb', 'booking', 'agoda', 'vrbo', 'expedia', 'tripcom'].map((c) => h('span', { class: 'cal-legend__item' }, h('span', { class: `cal-swatch cal-bar--${c}` }), CHANNEL_LABEL[c])),
    h('span', { class: 'cal-legend__item' }, h('span', { class: 'cal-swatch cal-bar--block' }), 'Blocked'),
    h('span', { class: 'cal-legend__item' }, h('span', { class: 'cal-swatch cal-swatch--holiday' }), 'Holiday rate'),
    h('span', { class: 'cal-legend__item' }, h('span', { class: 'cal-swatch cal-swatch--season' }), 'Season rate'));

  el.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' }, h('h1', null, 'Calendar'), h('p', null, canManage ? 'Tap an open night to book, block or change its price' : 'See who is staying and which nights are open. Booking and price changes are for owners and managers.')),
      canManage && h('div', { class: 'page-head__actions' },
        h('a', { class: 'btn btn--secondary', href: '#/pricing' }, '₱ Pricing rules'),
        h('button', { class: 'btn btn--primary', onclick: () => newReservationModal({ onSaved: load }) }, icon('plus'), 'New reservation'))),
    filterBar({
      key: 'calendar', values: filters, defaults, onChange: async () => { await loadTagUnits(); if (lastData) render(lastData); },
      search: { placeholder: 'Search listings' },
      quick: [
        properties.length > 1 && { name: 'property_id', label: 'Property', all: 'All properties', options: properties },
        tags.length > 0 && { name: 'tag', label: 'Tag', all: 'All tags', options: tags.map((t) => [t.tag, `${t.tag} (${t.count})`]) },
        { name: 'avail', label: 'Availability', all: 'Any availability', options: [['open', 'Has open nights'], ['empty', 'No bookings in these dates'], ['booked', 'Has bookings in these dates']] },
      ].filter(Boolean),
      more: [
        types.length > 1 && { name: 'unit_type', label: 'Listing type', all: 'All types', options: types.map((t) => [t, label(t)]) },
        { name: 'cleaning', label: 'Cleaning', all: 'Any', options: [['dirty', 'Needs cleaning'], ['clean', 'Clean']] },
      ].filter(Boolean),
    }),
    h('div', { class: 'toolbar' },
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
