// Guest reviews (private) and direct-booking discount codes.

import { get, post } from '../api.js';
import { h, peso, fmtDate, field, formModal, emptyState, pageHead, toast, badge } from '../ui.js';
import { state } from '../app.js';

export const stars = (n) => h('span', { class: 'rating', 'aria-label': `${n} out of 5` }, '★'.repeat(n) + '☆'.repeat(5 - n));

export async function reviewsView(el) {
  const { reviews, average, count } = await get('/reviews');
  el.replaceChildren(
    pageHead({ title: 'Guest reviews', sub: count ? `${average} average from ${count} review${count === 1 ? '' : 's'} · private, only your team sees them` : 'Private feedback from your guests', back: { href: '#/guests', label: 'Guests' } }),
    h('div', { class: 'card' },
      reviews.length ? h('ul', { class: 'list' }, reviews.map((r) => h('li', null, h('a', { class: 'row', href: `#/reservations/${r.booking_id}` },
        h('div', { class: 'row__main' },
          h('span', { class: 'row__title' }, stars(r.rating), ' ', r.guest_name || 'Guest'),
          h('span', { class: 'row__sub' }, `${r.unit_name} · ${fmtDate(r.check_in)} – ${fmtDate(r.check_out)}${r.cleanliness ? ` · cleanliness ${r.cleanliness}/5` : ''}`),
          r.comment && h('span', { class: 'row__sub' }, `“${r.comment}”`)),
        h('div', { class: 'row__end' }, h('span', { class: 'muted small' }, fmtDate(r.created_at.slice(0, 10))))))))
        : emptyState({ iconName: 'users', title: 'No reviews yet', text: 'Your thank-you message after check-out includes a private link where guests rate their stay. Turn on the "thank-you the day after check-out" automation in Inbox settings.' })));
}

export async function discountCodesView(el, { rerender }) {
  const { codes } = await get('/discount-codes');
  const add = () => formModal({
    title: 'New discount code', submitText: 'Create code',
    fields: [
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'code', label: 'Code', required: true, maxlength: 20, placeholder: 'e.g. BALIK10', hint: 'Letters, numbers and dashes.' }),
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
  const canManage = ['owner', 'manager'].includes(state.user.role);
  el.replaceChildren(
    pageHead({ title: 'Discount codes', sub: 'For your direct booking page', back: { href: '#/guests', label: 'Guests' },
      actions: canManage && h('button', { class: 'btn btn--primary', type: 'button', onclick: add }, '+ New code') }),
    h('div', { class: 'card' },
      codes.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Code', 'Discount', 'Rules', 'Used', ''].map((t) => h('th', null, t)))),
        h('tbody', null, codes.map((c) => h('tr', null,
          h('td', null, h('strong', null, c.code), c.description && h('div', { class: 'muted small' }, c.description), !c.active && badge('voided', 'Off')),
          h('td', null, c.percent_off ? `${c.percent_off}% off` : `${peso(c.amount_off)} off`),
          h('td', { class: 'small' }, [
            c.min_nights > 1 ? `${c.min_nights}+ nights` : null,
            c.returning_only ? 'returning guests' : null,
            c.valid_from || c.valid_until ? `${c.valid_from ? fmtDate(c.valid_from) : '…'} – ${c.valid_until ? fmtDate(c.valid_until) : '…'}` : null,
          ].filter(Boolean).join(' · ') || 'Anyone'),
          h('td', null, `${c.uses}${c.max_uses ? ` / ${c.max_uses}` : ''}`, Number(c.total_discounted) > 0 && h('div', { class: 'muted small' }, `${peso(c.total_discounted)} given`)),
          h('td', null, canManage && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => toggle(c) }, c.active ? 'Turn off' : 'Turn on')))))))
        : emptyState({ iconName: 'users', title: 'No codes yet', text: 'Reward returning guests or fill quiet weeks: e.g. BALIK10 for 10% off, for returning guests only.' })));
}
