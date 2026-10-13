// Pricing rules: how nightly prices are worked out, seasons, and the PH holiday calendar.

import { get, post } from '../api.js';
import { h, peso, fmtDate, field, formModal, confirmDialog, emptyState, pageHead, toast } from '../ui.js';
import { state } from '../app.js';

export async function pricingView(el, { rerender }) {
  const { listings, seasons, holidays } = await get('/pricing');
  const canManage = ['owner', 'manager'].includes(state.user.role);
  const isOwner = state.user.role === 'owner';

  const addSeason = () => formModal({
    title: 'Add a season', submitText: 'Save season',
    fields: [
      field({ name: 'name', label: 'Name', required: true, maxlength: 80, placeholder: 'e.g. Summer peak, Holy Week, Sinulog' }),
      field({ name: 'unit_id', label: 'Listing', type: 'select', required: !isOwner, placeholderOption: false,
        options: [...(isOwner ? [['', 'All listings']] : []), ...listings.map((l) => [l.unit_id, `${l.unit_name} · ${l.property_name}`])] }),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'start_date', label: 'First night', type: 'date', required: true }),
        field({ name: 'end_date', label: 'Last night', type: 'date', required: true })),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'nightly_rate', label: 'Nightly rate', type: 'money', hint: 'Leave empty to keep the usual rates.' }),
        field({ name: 'min_nights', label: 'Minimum nights', type: 'number', min: 1, max: 60, inputmode: 'numeric', hint: 'For stays that include any of these nights.' })),
    ],
    onSubmit: async (d) => { await post('/pricing/seasons', d); toast('Season saved.'); rerender(); },
  });
  const remove = async (s) => {
    if (!await confirmDialog({ title: `Remove “${s.name}”?`, text: 'Quotes go back to the usual rates for these dates. Existing reservations don\'t change.', confirmText: 'Remove season' })) return;
    try { await post(`/pricing/seasons/${s.season_id}/remove`); toast('Season removed.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };

  const ruleRows = listings.map((l) => h('tr', null,
    h('td', null, h('a', { href: `#/listings?focus=${l.unit_id}` }, l.unit_name), h('div', { class: 'muted small' }, l.property_name)),
    h('td', null, peso(l.nightly_rate)),
    h('td', null, l.weekend_rate ? peso(l.weekend_rate) : '—'),
    h('td', null, l.holiday_rate ? peso(l.holiday_rate) : '—'),
    h('td', null, [l.weekly_discount ? `${l.weekly_discount}% weekly` : null, l.monthly_discount ? `${l.monthly_discount}% monthly` : null].filter(Boolean).join(', ') || '—'),
    h('td', null, String(l.min_nights || 1))));

  el.replaceChildren(
    pageHead({
      title: 'Pricing rules', sub: 'Weekend and holiday rates, seasons and long-stay discounts',
      back: { href: '#/calendar', label: 'Calendar' },
      actions: canManage && h('button', { class: 'btn btn--primary', type: 'button', onclick: addSeason }, '+ Add season'),
    }),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'How a night is priced')),
      h('ol', { class: 'pricing-order' },
        h('li', null, h('strong', null, 'A price you set on the calendar'), ' for that exact night'),
        h('li', null, h('strong', null, 'Holiday rate'), ' on the nights before and during PH holiday long weekends'),
        h('li', null, h('strong', null, 'Season rate'), ' (a season for one listing beats one for all listings)'),
        h('li', null, h('strong', null, 'Weekend rate'), ' on Friday and Saturday nights'),
        h('li', null, h('strong', null, 'Base nightly rate'))),
      h('p', { class: 'muted small' }, 'Then the weekly (7+ nights) or monthly (28+ nights) discount comes off the stay. These rules price new quotes, new reservations and your booking page; existing reservations keep their price. Channel prices (Airbnb, Booking.com…) are set on each channel.')),
    h('div', { class: 'card card--flush' },
      h('div', { class: 'card__head', style: { padding: '16px 16px 0' } }, h('h2', null, 'Listing rates')),
      listings.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Listing', 'Base', 'Weekend', 'Holiday', 'Discounts', 'Min. nights'].map((t) => h('th', null, t)))),
        h('tbody', null, ruleRows)))
        : emptyState({ iconName: 'building', title: 'No listings yet', text: 'Add a listing with a nightly rate first.' }),
      h('p', { class: 'muted small', style: { padding: '0 16px 12px' } }, 'Change these in Listings → Edit → Pricing helpers.')),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Seasons')),
      seasons.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Season', 'Nights', 'Listing', 'Rate', 'Min. nights', ''].map((t) => h('th', null, t)))),
        h('tbody', null, seasons.map((s) => h('tr', null,
          h('td', null, s.name),
          h('td', null, `${fmtDate(s.start_date)} – ${fmtDate(s.end_date)}`),
          h('td', null, s.unit_name || 'All listings'),
          h('td', null, s.nightly_rate ? peso(s.nightly_rate) : '—'),
          h('td', null, s.min_nights ? String(s.min_nights) : '—'),
          h('td', null, canManage && (s.unit_id || isOwner) && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => remove(s) }, 'Remove')))))))
        : h('p', { class: 'muted' }, 'No seasons yet. Add one for peak months (e.g. March to May), local fiestas, or a minimum stay over Holy Week and Christmas.')),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Philippine holidays (next 12 months)')),
      h('p', { class: 'muted small' }, 'Holiday rates use these dates. Some dates (Chinese New Year, Eid) are set each year by proclamation and may move; set a price on the calendar for any night that needs it.'),
      h('ul', { class: 'holiday-list' }, holidays.map((x) => h('li', null, h('span', null, x.name), h('span', { class: 'muted' }, fmtDate(x.date)))))));
}
