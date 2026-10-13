// Add-ons: paid extras guests can add on the booking page and before arrival (owners edit; managers read only).

import { get, post, patch } from '../api.js';
import { h, icon, peso, badge, field, formModal, confirmDialog, emptyState, errorState, pageHead, toast, skeleton } from '../ui.js';
import { state } from '../app.js';

const PRICING = {
  per_stay: 'per stay', per_night: 'per night', per_guest: 'per guest', per_guest_night: 'per guest, per night',
};

function listingChecks(listings, selected = []) {
  return h('fieldset', { class: 'field hp-fieldset', dataset: { field: 'unit_ids' } },
    h('legend', null, 'Offered on'),
    h('p', { class: 'muted small' }, 'Leave all unticked to offer it on every listing.'),
    h('div', { class: 'checks' }, listings.map((l) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', name: 'unit_ids', value: l.unit_id, dataset: { multi: '1' }, checked: selected.includes(l.unit_id) }),
      h('span', null, l.unit_name)))),
    h('div', { class: 'error', role: 'alert' }));
}

function addonModal(a, listings, onSaved) {
  const x = a || {};
  formModal({
    title: a ? `Edit ${a.name}` : 'Add an add-on',
    submitText: a ? 'Save changes' : 'Add add-on',
    fields: [
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'name', label: 'Name', required: true, value: x.name, maxlength: 80, placeholder: 'e.g. Airport pickup' }),
        field({ name: 'name_tl', label: 'Name in Taglish (optional)', value: x.name_tl, maxlength: 80 })),
      field({ name: 'description', label: 'Description', type: 'textarea', value: x.description, maxlength: 300, placeholder: 'e.g. We meet you at NAIA with a sign. Up to 4 people.' }),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'price', label: 'Price', type: 'money', required: true, value: x.price, placeholder: '800' }),
        field({ name: 'pricing', label: 'Charged', type: 'select', required: true, value: x.pricing || 'per_stay', placeholderOption: false, options: Object.entries(PRICING) })),
      field({ name: 'max_quantity', label: 'Most a guest can add', type: 'number', min: 1, max: 20, value: x.max_quantity || 1, inputmode: 'numeric' }),
      listingChecks(listings, x.unit_ids || []),
      field({ name: 'on_booking_page', label: 'Show on my booking page', type: 'checkbox', value: x.on_booking_page ?? true }),
      field({ name: 'before_arrival', label: 'Let guests add it before arrival (on their payment page)', type: 'checkbox', value: x.before_arrival ?? true }),
      a && field({ name: 'active', label: 'Active', type: 'checkbox', value: x.active ?? true }),
    ],
    onSubmit: async (d) => {
      const body = { ...d, max_quantity: Number(d.max_quantity) || 1, unit_ids: d.unit_ids || [] };
      if (a) await patch(`/addons/${a.addon_id}`, body); else await post('/addons', body);
      toast(a ? 'Add-on updated.' : 'Add-on added.');
      onSaved();
    },
  });
}

export async function addonsView(el, { rerender }) {
  const isOwner = state.user.role === 'owner';
  el.replaceChildren(pageHead({ title: 'Add-ons', sub: 'Paid extras guests can add to a stay' }), skeleton(3));
  let addons; let listings;
  try { [{ addons }, { listings }] = await Promise.all([get('/addons'), get('/listings')]); } catch (err) { el.replaceChildren(pageHead({ title: 'Add-ons' }), errorState(err, rerender)); return; }
  const name = (id) => listings.find((l) => l.unit_id === id)?.unit_name || 'a listing';
  const row = (a) => h('li', null, h('div', { class: 'row' },
    h('div', { class: 'row__main' },
      h('span', { class: 'row__title' }, a.name, ' ', !a.active && badge('archived', 'Archived')),
      a.description && h('span', { class: 'row__sub' }, a.description),
      h('span', { class: 'row__sub' }, `${peso(a.price)} ${PRICING[a.pricing] || ''} · up to ${a.max_quantity} · ${a.unit_ids?.length ? a.unit_ids.map(name).join(', ') : 'all listings'}`),
      h('span', { class: 'row__sub' }, [a.on_booking_page && 'On booking page', a.before_arrival && 'Before arrival'].filter(Boolean).join(' · ') || 'Hidden from guests')),
    isOwner && h('div', { class: 'row__end' }, h('div', { class: 'chips' },
      h('button', { class: 'btn btn--secondary btn--sm', onclick: () => addonModal(a, listings, rerender), 'aria-label': `Edit ${a.name}` }, 'Edit'),
      a.active && h('button', { class: 'btn btn--ghost btn--sm', 'aria-label': `Archive ${a.name}`, onclick: async () => {
        if (!await confirmDialog({ title: `Archive ${a.name}?`, text: 'Guests will no longer see it. Past bookings keep their charges.', confirmText: 'Archive' })) return;
        try { await post(`/addons/${a.addon_id}/archive`); toast('Add-on archived.'); rerender(); } catch (err) { toast(err.message, 'error'); }
      } }, 'Archive')))));
  el.replaceChildren(
    pageHead({ title: 'Add-ons', sub: 'Paid extras guests can add to a stay', actions: isOwner && h('button', { class: 'btn btn--primary', onclick: () => addonModal(null, listings, rerender) }, icon('plus'), 'Add add-on') }),
    !isOwner && h('p', { class: 'muted small' }, 'Only the workspace owner can change add-ons.'),
    h('div', { class: 'card' }, addons.length
      ? h('ul', { class: 'list' }, addons.map(row))
      : emptyState({ iconName: 'plus', title: 'No add-ons yet', text: 'Offer airport pickup, early check-in, an extra bed or breakfast, and get paid with the booking.',
        action: isOwner && h('button', { class: 'btn btn--primary', onclick: () => addonModal(null, listings, rerender) }, 'Add your first add-on') })));
}
