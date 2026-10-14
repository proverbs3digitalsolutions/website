// Guest reviews (private) and direct-booking discount codes.

import { get, post, qs } from '../api.js';
import { h, peso, fmtDate, manilaDay, field, formModal, emptyState, pageHead, toast, badge } from '../ui.js';
import { state } from '../app.js';
import { initFilters, filterBar, changed } from '../filters.js';

export const stars = (n) => h('span', { class: 'rating', 'aria-label': `${n} out of 5` }, '★'.repeat(n) + '☆'.repeat(5 - n));

export async function reviewsView(el, { query = {} } = {}) {
  const defaults = { q: '', rating: '', property_id: '', unit_id: '', from: '', to: '', has_comment: '', sort: '' };
  const filters = initFilters('reviews', query, defaults);
  const { listings } = await get('/listings');
  const properties = [...new Map(listings.map((l) => [l.property_id, l.property_name])).entries()];
  const head = h('div');
  const listBox = h('div', { class: 'card' });

  async function load() {
    history.replaceState(null, '', `#/reviews${qs(changed(filters, defaults))}`);
    const { reviews, average, count, matched, matched_average: matchedAvg } = await get(`/reviews${qs(changed(filters, defaults))}`);
    const filtered = Object.keys(changed(filters, defaults)).some((k) => k !== 'sort');
    head.replaceChildren(pageHead({ title: 'Guest reviews', sub: count ? `${average} average from ${count} review${count === 1 ? '' : 's'} · private, only your team sees them` : 'Private feedback from your guests', back: { href: '#/guests', label: 'Guests' } }));
    if (!reviews.length) {
      listBox.replaceChildren(filtered
        ? emptyState({ iconName: 'users', title: 'No results found', text: 'No review matches these filters. Try removing a filter.' })
        : emptyState({ iconName: 'users', title: 'No reviews yet', text: state.user.role === 'owner' ? 'Your thank-you message after check-out includes a private link where guests rate their stay. Turn on the "thank-you the day after check-out" automation in Inbox settings.' : 'Reviews from your guests show here.' }));
      return;
    }
    listBox.replaceChildren(
      filtered ? h('p', { class: 'muted small' }, `Showing ${matched} of ${count} review${count === 1 ? '' : 's'} · ${matchedAvg} average`) : '',
      h('ul', { class: 'list' }, reviews.map((r) => h('li', null, h('a', { class: 'row', href: `#/reservations/${r.booking_id}` },
        h('div', { class: 'row__main' },
          h('span', { class: 'row__title' }, stars(r.rating), ' ', r.guest_name || 'Guest'),
          h('span', { class: 'row__sub' }, `${r.unit_name}${properties.length > 1 ? ` · ${r.property_name}` : ''} · ${fmtDate(r.check_in)} – ${fmtDate(r.check_out)}${r.cleanliness ? ` · cleanliness ${r.cleanliness}/5` : ''}`),
          r.comment && h('span', { class: 'row__sub' }, `“${r.comment}”`)),
        h('div', { class: 'row__end' }, h('span', { class: 'muted small' }, fmtDate(manilaDay(r.created_at)))))))));
  }
  const bar = filterBar({
    key: 'reviews', values: filters, defaults, onChange: load,
    search: { placeholder: 'Search guest, listing or comment' },
    quick: [
      { name: 'rating', label: 'Rating', all: 'Any rating', options: [['low', '3 stars or less'], ['high', '4 stars or more'], ['5', '5 stars'], ['4', '4 stars'], ['3', '3 stars'], ['2', '2 stars'], ['1', '1 star']] },
      listings.length > 1 && { name: 'unit_id', label: 'Listing', all: 'All listings', options: listings.map((l) => [l.unit_id, `${l.unit_name}${properties.length > 1 ? ` · ${l.property_name}` : ''}`]) },
    ].filter(Boolean),
    more: [
      properties.length > 1 && { name: 'property_id', label: 'Property', all: 'All properties', options: properties },
      { name: 'date', keys: ['from', 'to'], label: 'Reviewed between', type: 'daterange' },
      { name: 'has_comment', label: 'Has a written comment', type: 'check' },
      { name: 'sort', label: 'Sort by', all: 'Newest first', options: [['oldest', 'Oldest first'], ['lowest', 'Lowest rating first'], ['highest', 'Highest rating first'], ['checkin', 'Most recent stay']] },
    ].filter(Boolean),
  });
  await load();
  el.replaceChildren(head, bar, listBox);
}

export async function discountCodesView(el, { rerender, query = {} }) {
  const defaults = { q: '', status: '', type: '', returning: '', sort: '' };
  const filters = initFilters('discount-codes', query, defaults);
  const add = () => formModal({
    title: 'New discount code', submitText: 'Create code',
    fields: [
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'code', label: 'Code', required: true, maxlength: 20, placeholder: 'e.g. BALIK10', hint: 'Letters, numbers and dashes. No spaces.' }),
        field({ name: 'description', label: 'Note for you (optional)', maxlength: 120, placeholder: 'e.g. Returning guests 2026' })),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'percent_off', label: 'Percent off', type: 'number', min: 1, max: 90, inputmode: 'numeric', hint: 'Fill in this or the amount.' }),
        field({ name: 'amount_off', label: 'Or amount off (₱)', type: 'money' })),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'valid_from', label: 'Valid from (booking date)', type: 'date' }),
        field({ name: 'valid_until', label: 'Valid until', type: 'date' })),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'min_nights', label: 'Minimum nights', type: 'number', min: 1, max: 60, value: 1, inputmode: 'numeric' }),
        field({ name: 'max_uses', label: 'Maximum uses (optional)', type: 'number', min: 1, inputmode: 'numeric' })),
      field({ name: 'returning_only', label: 'Only for returning guests (email of a past stay)', type: 'checkbox' }),
      h('p', { class: 'muted small' }, 'Codes work on your direct booking page and come off the accommodation (not the cleaning fee).'),
    ],
    onSubmit: async (d) => {
      if (!d.percent_off) delete d.percent_off;
      if (!d.amount_off) delete d.amount_off;
      await post('/discount-codes', d);
      toast('Code created. Share it with your guests.');
      rerender();
    },
  });
  const toggle = async (c) => {
    try { await post(`/discount-codes/${c.code_id}/active`, { active: !c.active }); toast(c.active ? 'Code turned off.' : 'Code turned on.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  // Codes apply to the whole workspace, so only the owner can change them.
  const canManage = state.user.role === 'owner';
  // Why a code can't be used right now (or nothing if it can).
  const stateBadge = (c) => (!c.active ? badge('voided', 'Off') : c.expired ? badge('overdue', 'Expired') : c.used_up ? badge('partial', 'Used up')
    : c.scheduled ? badge('unpaid', `Starts ${fmtDate(c.valid_from)}`) : null);
  const codeTable = (codes) => h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, ['Code', 'Discount', 'Rules', 'Used', ''].map((t) => h('th', null, t)))),
    h('tbody', null, codes.map((c) => h('tr', null,
      h('td', null, h('strong', null, c.code), c.description && h('div', { class: 'muted small' }, c.description), stateBadge(c)),
      h('td', null, c.percent_off ? `${c.percent_off}% off` : `${peso(c.amount_off)} off`),
      h('td', { class: 'small' }, [
        c.min_nights > 1 ? `${c.min_nights}+ nights` : null,
        c.returning_only ? 'returning guests' : null,
        c.valid_from || c.valid_until ? `${c.valid_from ? fmtDate(c.valid_from) : '…'} – ${c.valid_until ? fmtDate(c.valid_until) : '…'}` : null,
      ].filter(Boolean).join(' · ') || 'Anyone'),
      h('td', null, `${c.uses}${c.max_uses ? ` / ${c.max_uses}` : ''}`, Number(c.total_discounted) > 0 && h('div', { class: 'muted small' }, `${peso(c.total_discounted)} given`)),
      h('td', null, canManage && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => toggle(c) }, c.active ? 'Turn off' : 'Turn on')))))));
  const listBox = h('div', { class: 'card' });
  const welcomeBox = h('div');

  async function load() {
    history.replaceState(null, '', `#/discount-codes${qs(changed(filters, defaults))}`);
    const { codes, total } = await get(`/discount-codes${qs(changed(filters, defaults))}`);
    const filtered = Object.keys(changed(filters, defaults)).some((k) => k !== 'sort');
    if (!codes.length) {
      listBox.replaceChildren(filtered
        ? emptyState({ iconName: 'users', title: 'No results found', text: 'No code matches these filters. Try removing a filter.' })
        : emptyState({ iconName: 'users', title: 'No codes yet', text: 'Reward returning guests or fill quiet weeks: e.g. BALIK10 for 10% off, for returning guests only.' }));
      return;
    }
    listBox.replaceChildren(
      filtered ? h('p', { class: 'muted small' }, `Showing ${codes.length} of ${total} code${total === 1 ? '' : 's'}`) : '',
      codeTable(codes));
  }
  const bar = filterBar({
    key: 'discount-codes', values: filters, defaults, onChange: load,
    search: { placeholder: 'Search code or note' },
    quick: [
      { name: 'status', label: 'Status', all: 'All codes', options: [['active', 'Usable now'], ['scheduled', 'Not started yet'], ['expired', 'Expired'], ['used_up', 'Used up'], ['off', 'Turned off']] },
    ],
    more: [
      { name: 'type', label: 'Discount type', all: 'Any', options: [['percent', 'Percent off'], ['amount', 'Amount off (₱)']] },
      { name: 'returning', label: 'Returning guests only', type: 'check' },
      { name: 'sort', label: 'Sort by', all: 'Active first, newest', options: [['newest', 'Newest first'], ['code', 'Code (A–Z)'], ['most_used', 'Most used'], ['ending', 'Ending soonest']] },
    ],
  });
  // Automatic welcome codes (issued to one returning guest each) sit apart from the host's own codes.
  const loadWelcome = async () => {
    try {
      const { codes } = await get('/discount-codes?issued=yes');
      welcomeBox.replaceChildren(codes.length ? h('details', { class: 'card' },
        h('summary', null, `Automatic welcome codes (${codes.length})`),
        h('p', { class: 'muted small' }, 'Made for returning guests by BalayHub. They do not count toward your limit.'),
        codeTable(codes)) : '');
    } catch { welcomeBox.replaceChildren(); }
  };
  await Promise.all([load(), loadWelcome()]);
  el.replaceChildren(
    pageHead({ title: 'Discount codes', sub: 'For your direct booking page', back: { href: '#/guests', label: 'Guests' },
      actions: canManage && h('button', { class: 'btn btn--primary', type: 'button', onclick: add }, '+ New code') }),
    !canManage && h('p', { class: 'muted small' }, 'Only the workspace owner can change these.'),
    bar, listBox, welcomeBox);
}
