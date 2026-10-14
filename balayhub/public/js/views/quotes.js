// Quotes: a price prepared for an inquiry, sent as a private link the guest accepts and pays.

import { get, post, qs, ApiError } from '../api.js';
import { h, icon, peso, fmtDate, fmtDateTime, badge, field, makeForm, openModal, confirmDialog, emptyState, errorState, pageHead, toast, skeleton, todayManila, parseAmount } from '../ui.js';
import { initFilters, filterBar, rememberFilters, changed, apiFilters } from '../filters.js';

const STATUS = { open: 'Open', paid: 'Paid', expired: 'Expired', cancelled: 'Cancelled' };
const STATUS_BADGE = { open: 'open', paid: 'paid', expired: 'archived', cancelled: 'voided' };
const statusBadge = (s) => badge(STATUS_BADGE[s] || 'archived', STATUS[s] || s);
// The date means different things by status: an open link expires; a paid or cancelled quote only has a valid-until date.
export const expiryLabel = (status) => (status === 'open' ? 'Expires' : status === 'expired' ? 'Expired' : 'Valid until');
const quoteUrl = (q) => q.url;
// An empty box is 0; text that is not an amount (or is negative) is NaN, so it can never pass as a PHP 0 price.
const money = (v) => {
  const s = String(v ?? '').trim();
  if (s === '') return 0;
  const n = parseAmount(s);
  return n < 0 ? NaN : n;
};
const nightsBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
// The stay must run at least one night. A blank date is the required check's job, so it gives no message here.
export const datesProblem = (ci, co) => (ci && co && !(nightsBetween(ci, co) > 0) ? 'Check-out must be after check-in.' : null);
// The rate-card price for a quote: null when a night has no nightly rate, or the price is not above 0. Never filled in or offered as PHP 0.
export const rateStay = (p) => (p.missing_rates || !(Number(p.accommodation_total) > 0) ? null : p.accommodation_total);
// Offer the rate-card price when the Accommodation box holds something else. A box that is not an amount ("1,5") counts as different.
export const rateOffer = (typed, stay) => Number(stay) > 0 && parseAmount(typed) !== Number(stay);
// The most guests a listing takes, or null when the listing has no limit set.
export const guestLimit = (listings, unitId) => listings.find((l) => l.unit_id === unitId)?.max_guests || null;

// Shared by the host pages (quotes, reservations, listings, charges, check-in). If the browser blocks the clipboard,
// the text opens selected in a read-only box, so the host can copy it by hand.
export async function copyText(text, msg = 'Link copied.', title = 'Copy the link') {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch {
    const box = h(text.includes('\n') ? 'textarea' : 'input', { class: 'input', readonly: true, value: text, 'aria-label': 'Text to copy' });
    openModal({ title, body: h('div', { class: 'form' }, box, h('p', { class: 'muted small' }, 'Press Ctrl+C (Cmd+C on a Mac) to copy it.')) });
    box.select();
  }
}

function addonCost(a, nights, guests, qty) {
  const mult = { per_stay: 1, per_night: nights, per_guest: guests, per_guest_night: nights * guests }[a.pricing] || 1;
  return Math.round(Number(a.price) * mult * qty * 100) / 100;
}

async function newQuoteModal(listings, onSaved) {
  let addons = [];
  try { ({ addons } = await get('/addons')); } catch { /* add-ons are optional */ }
  addons = addons.filter((a) => a.active);
  const preview = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const totalLine = h('p', { class: 'hp-total', 'aria-live': 'polite' });
  const addonBox = h('div', { class: 'stack' });
  const picks = new Map(); // addon_id -> qty input

  const fields = [
    field({ name: 'unit_id', label: 'Listing', type: 'select', required: true, options: listings.map((l) => [l.unit_id, l.unit_name]), value: listings.length === 1 ? listings[0].unit_id : '' }),
    h('div', { class: 'form-row form-row--3' },
      field({ name: 'check_in', label: 'Check-in', type: 'date', required: true, min: todayManila() }),
      field({ name: 'check_out', label: 'Check-out', type: 'date', required: true, min: todayManila() }),
      field({ name: 'num_guests', label: 'Guests', type: 'number', required: true, min: 1, max: 50, value: 2, inputmode: 'numeric' })),
    h('div', { class: 'form-row form-row--3' },
      field({ name: 'guest_name', label: 'Guest name', required: true, maxlength: 120 }),
      field({ name: 'guest_email', label: 'Guest email', type: 'email', hint: 'Needed to email the link.' }),
      field({ name: 'guest_phone', label: 'Guest mobile', type: 'tel' })),
    preview,
    h('div', { class: 'form-row form-row--3' },
      field({ name: 'accommodation_total', label: 'Accommodation', type: 'money', required: true }),
      field({ name: 'cleaning_fee', label: 'Cleaning fee', type: 'money' }),
      field({ name: 'discount_amount', label: 'Discount', type: 'money', hint: 'Taken off the total.' })),
    // The error slot shows the server's add-on message (for example, a quantity over the limit) next to the list.
    addons.length > 0 && h('fieldset', { class: 'field hp-fieldset', dataset: { field: 'addons' } }, h('legend', null, 'Add-ons'), addonBox, h('div', { class: 'error', role: 'alert' })),
    totalLine,
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'pay_type', label: 'Guest pays', type: 'select', value: 'full', placeholderOption: false, options: [['full', 'Full amount'], ['deposit', 'Deposit (as set on the listing)']] }),
      field({ name: 'expires_in_hours', label: 'Valid for (hours)', type: 'number', min: 1, max: 336, value: 48, inputmode: 'numeric', hint: 'Up to 14 days (336 hours).' })),
    field({ name: 'note', label: 'Note for the guest', type: 'textarea', maxlength: 1000, placeholder: 'e.g. Includes the airport pickup we talked about.' }),
    h('p', { class: 'muted small' }, 'The dates are not held until the guest pays.'),
  ];

  let modal;
  const form = makeForm({
    fields, submitText: 'Create quote', cancel: () => modal.close(),
    // The date check runs with the required check, so a blank Accommodation box can't hide it.
    check: (d) => { const msg = datesProblem(d.check_in, d.check_out); return msg ? { check_out: msg } : null; },
    onSubmit: async (d) => {
      const cap = guestLimit(listings, d.unit_id);
      if (cap && Number(d.num_guests) > cap) { const m = `This listing allows up to ${cap} guests.`; throw new ApiError(m, { status: 400, fields: { num_guests: m } }); }
      // An empty box means the 48-hour default; anything typed must be 1 to 336 (0 is not silently replaced).
      const hours = String(d.expires_in_hours).trim() === '' ? 48 : Number(d.expires_in_hours);
      if (!(Number.isInteger(hours) && hours >= 1 && hours <= 336)) { const m = 'Hours must be between 1 and 336 (14 days).'; throw new ApiError(m, { status: 400, fields: { expires_in_hours: m } }); }
      // The amounts go to the server as typed, so it can name a box that is not an amount instead of saving PHP 0.
      const amt = (v) => String(v ?? '').trim() || undefined;
      const selections = [...picks].map(([addon_id, input]) => ({ addon_id, quantity: Number(input.value) || 0 })).filter((s) => s.quantity > 0);
      const body = {
        unit_id: d.unit_id, check_in: d.check_in, check_out: d.check_out, num_guests: Number(d.num_guests),
        guest_name: d.guest_name, guest_email: d.guest_email || undefined, guest_phone: d.guest_phone || undefined,
        accommodation_total: amt(d.accommodation_total), cleaning_fee: amt(d.cleaning_fee), discount_amount: amt(d.discount_amount),
        addons: selections, pay_type: d.pay_type, expires_in_hours: hours, note: d.note || undefined,
      };
      const r = await post('/quotes', body);
      toast('Quote created.');
      modal.close();
      onSaved(r.quote);
    },
  });
  modal = openModal({ title: 'New quote', wide: true, body: form });
  const el = (n) => form.elements[n];
  // The Guests box stops at the listing's most guests (50 when the listing has no limit).
  const fitGuests = () => { el('num_guests').max = String(guestLimit(listings, el('unit_id').value) || 50); };

  const guests = () => Number(el('num_guests').value) || 1;
  const nights = () => nightsBetween(el('check_in').value, el('check_out').value);
  function drawTotal() {
    const n = Math.max(nights(), 0);
    let add = 0;
    for (const a of addons) add += addonCost(a, n, guests(), Number(picks.get(a.addon_id)?.value) || 0);
    // An empty Accommodation box has no total yet (a listing with no nightly rate leaves it empty for the host to type).
    const stayBox = el('accommodation_total').value.trim();
    const total = (stayBox === '' ? NaN : money(stayBox)) + money(el('cleaning_fee').value) + add - money(el('discount_amount').value);
    totalLine.textContent = Number.isNaN(total) ? 'Total for the guest: -' : `Total for the guest: ${peso(Math.max(total, 0))}${add ? ` (add-ons ${peso(add)})` : ''}`;
  }
  function drawAddons() {
    const unit = el('unit_id').value;
    picks.clear();
    addonBox.replaceChildren(...addons.filter((a) => !a.unit_ids?.length || a.unit_ids.includes(unit)).map((a) => {
      const qty = h('input', { class: 'input hp-qty', type: 'number', min: 0, max: a.max_quantity, value: 0, inputmode: 'numeric', 'aria-label': `${a.name} quantity` });
      // Clamp as the host types, so the box never holds more than the add-on allows (or a negative count).
      qty.addEventListener('input', () => {
        if (Number(qty.value) > a.max_quantity) qty.value = a.max_quantity;
        if (Number(qty.value) < 0) qty.value = 0;
        drawTotal();
      });
      picks.set(a.addon_id, qty);
      return h('div', { class: 'hp-addon' }, h('span', null, h('strong', null, a.name), h('span', { class: 'muted small' }, ` ${peso(a.price)}`)), qty);
    }));
    if (!picks.size) addonBox.replaceChildren(h('p', { class: 'muted small' }, 'No add-ons for this listing.'));
  }
  // Once the host types a price, a date change keeps it; the rate-card price is offered as a button instead.
  let edited = false; let rate = null;
  const useRate = h('button', { class: 'btn btn--secondary btn--sm', type: 'button', hidden: true, onclick: () => {
    el('accommodation_total').value = rate.accommodation_total ?? ''; el('cleaning_fee').value = rate.cleaning_fee ?? '';
    edited = false; useRate.hidden = true; drawTotal();
  } });
  preview.after(useRate);
  async function loadPreview() {
    // The offer belongs to the dates on screen; it stays hidden if the check fails or there are no dates.
    useRate.hidden = true;
    const unit = el('unit_id').value;
    if (!unit || !el('check_in').value || !el('check_out').value || nights() < 1) { preview.textContent = ''; drawTotal(); return; }
    preview.textContent = 'Checking the price…';
    try {
      const p = await get(`/units/${unit}/price-preview${qs({ check_in: el('check_in').value, check_out: el('check_out').value, guests: guests() })}`);
      rate = p;
      const stay = rateStay(p);
      if (edited) {
        useRate.hidden = !rateOffer(el('accommodation_total').value, stay);
        if (!useRate.hidden) useRate.textContent = `Use rate-card price ${peso(stay)}`;
      } else {
        // With no rate for some nights the box stays empty for the host to type an amount.
        el('accommodation_total').value = stay ?? '';
        el('cleaning_fee').value = p.cleaning_fee ?? '';
      }
      const warn = p.available ? '' : ' Warning: these dates are already booked, so this quote cannot be created.';
      preview.textContent = p.missing_rates
        ? `This listing has no nightly rate for some nights. Enter the total yourself.${warn}`
        : `Price from your rates: ${nights()} night${nights() === 1 ? '' : 's'}, ${peso(p.accommodation_total)} plus ${peso(p.cleaning_fee)} cleaning. You can change the amounts.${warn}`;
      preview.setAttribute('role', 'status');
    } catch (e) { preview.textContent = `Couldn't price these dates: ${e.message} Enter the amounts yourself.`; }
    drawTotal();
  }
  for (const n of ['unit_id', 'check_in', 'check_out', 'num_guests']) el(n).addEventListener('change', () => { if (n === 'unit_id') { drawAddons(); fitGuests(); } loadPreview(); });
  for (const n of ['accommodation_total', 'cleaning_fee', 'discount_amount']) el(n).addEventListener('input', () => { if (n !== 'discount_amount') edited = true; drawTotal(); });
  fitGuests(); drawAddons(); drawTotal();
}

export async function quotesView(el, { query, rerender }) {
  const defaults = { status: '' };
  const filters = initFilters('quotes', query, defaults);
  const box = h('div', { class: 'card' }, skeleton(3));
  let listings = [];
  async function load() {
    history.replaceState(null, '', `#/quotes${qs(changed(filters, defaults))}`);
    rememberFilters('quotes', filters);
    box.replaceChildren(skeleton(3));
    try {
      const { quotes } = await get(`/quotes${qs(apiFilters(filters))}`);
      box.replaceChildren(quotes.length ? h('ul', { class: 'list' }, quotes.map((q) => h('li', null, h('a', { class: 'row', href: `#/quotes/${q.quote_id}` },
        h('div', { class: 'row__main' },
          h('span', { class: 'row__title' }, q.guest_name || 'Guest', ' · ', q.unit_name || ''),
          h('span', { class: 'row__sub' }, `${fmtDate(q.check_in)} – ${fmtDate(q.check_out)}`),
          q.status === 'open' && q.expires_at && h('span', { class: 'row__sub' }, `Expires ${fmtDateTime(q.expires_at)}`)),
        h('div', { class: 'row__end' }, h('span', { class: 'amount' }, peso(q.total_amount)), statusBadge(q.status))))))
        : emptyState({ iconName: 'file', title: filters.status ? 'No results found' : 'No quotes yet', text: filters.status ? 'Try another status.' : 'Answer an inquiry from Facebook, Messenger or Viber with a price and a link the guest can pay.' }));
    } catch (err) { box.replaceChildren(errorState(err, load)); }
  }
  const bar = filterBar({ key: 'quotes', values: filters, defaults, onChange: load, quick: [{ name: 'status', label: 'Status', all: 'All quotes', options: Object.entries(STATUS) }] });
  try { ({ listings } = await get('/listings')); } catch { /* the button reports it */ }
  const create = () => (listings.length ? newQuoteModal(listings, (q) => { location.hash = `#/quotes/${q.quote_id}`; }) : toast('Add a listing first.', 'error'));
  el.replaceChildren(
    pageHead({ title: 'Quotes', sub: 'Prices you send to guests who ask first', actions: h('button', { class: 'btn btn--primary', onclick: create }, icon('plus'), 'New quote') }),
    bar, box);
  await load();
  if (query.new) create();
}

export async function quoteDetailView(el, { params, rerender }) {
  let q;
  try { ({ quote: q } = await get(`/quotes/${params.id}`)); } catch (err) { el.replaceChildren(h('a', { class: 'back', href: '#/quotes' }, '‹ Quotes'), errorState(err, rerender)); return; }
  const url = quoteUrl(q);
  const open = q.status === 'open';
  const act = async (fn, msg) => { try { await fn(); toast(msg); rerender(); } catch (err) { toast(err.message, 'error'); } };
  const out = h('input', { class: 'input', readonly: true, value: url, 'aria-label': 'Quote link' });
  const addons = Array.isArray(q.addons) ? q.addons : [];
  el.replaceChildren(
    h('a', { class: 'back', href: '#/quotes' }, '‹ Quotes'),
    pageHead({ title: `Quote for ${q.guest_name || 'guest'}`, sub: `${q.unit_name || ''} · ${fmtDate(q.check_in)} – ${fmtDate(q.check_out)}` }),
    h('div', { class: 'grid grid--2' },
      h('div', { class: 'card' },
        h('div', { class: 'card__head' }, h('h2', null, 'Quote'), statusBadge(q.status)),
        h('dl', { class: 'dl' },
          h('dt', null, 'Guests'), h('dd', null, String(q.num_guests)),
          h('dt', null, 'Accommodation'), h('dd', null, peso(q.accommodation_total)),
          h('dt', null, 'Cleaning'), h('dd', null, peso(q.cleaning_fee)),
          addons.map((a) => [h('dt', null, `${a.name}${a.quantity > 1 ? ` × ${a.quantity}` : ''}`), h('dd', null, peso(a.amount))]),
          Number(q.discount_amount) > 0 && [h('dt', null, 'Discount'), h('dd', null, `− ${peso(q.discount_amount)}`)],
          h('dt', null, 'Total'), h('dd', null, h('strong', null, peso(q.total_amount))),
          h('dt', null, 'Guest pays'), h('dd', null, q.pay_type === 'deposit' ? 'A deposit now, the rest later' : 'The full amount'),
          h('dt', null, expiryLabel(q.status)), h('dd', null, fmtDateTime(q.expires_at)),
          q.guest_email && [h('dt', null, 'Email'), h('dd', null, q.guest_email)],
          q.guest_phone && [h('dt', null, 'Mobile'), h('dd', null, q.guest_phone)],
          q.note && [h('dt', null, 'Note'), h('dd', { style: { whiteSpace: 'pre-wrap' } }, q.note)])),
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h2', null, 'Guest link'),
          q.status === 'paid' && q.booking_id
            ? h('p', null, 'Paid. ', h('a', { href: `#/reservations/${q.booking_id}` }, 'Open the reservation'))
            : open ? [
              h('p', { class: 'muted small' }, 'Send this to the guest. The dates are held only once they pay.'),
              h('div', { class: 'hp-copy' }, out, h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => copyText(url) }, 'Copy')),
              h('div', { class: 'chips hp-actions' },
                q.guest_email && h('button', { class: 'btn btn--secondary btn--sm', onclick: () => act(() => post(`/quotes/${q.quote_id}/send`), `Quote emailed to ${q.guest_email}.`) }, 'Send by email'),
                h('button', { class: 'btn btn--danger btn--sm', onclick: async () => {
                  if (!await confirmDialog({ title: 'Cancel this quote?', text: 'The link stops working. This can\'t be undone.', confirmText: 'Cancel quote', cancelText: 'Keep it', danger: true })) return;
                  act(() => post(`/quotes/${q.quote_id}/cancel`), 'Quote cancelled.');
                } }, 'Cancel quote')),
              !q.guest_email && h('p', { class: 'muted small' }, 'No email on this quote, so copy the link and send it on Messenger or Viber.')]
              : h('p', { class: 'muted' }, q.status === 'expired' ? 'This quote expired. Create a new one if the guest is still interested.' : 'This quote was cancelled.')))));
}
