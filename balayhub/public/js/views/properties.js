// Screen 4 — Properties & Units.

import { get, post, patch, qs, ApiError } from '../api.js';
import {
  h, icon, peso, badge, label, options, field, formModal, confirmDialog, emptyState, searchBox, pageHead, toast, unitLabel } from '../ui.js';
import { state, navigate } from '../app.js';
import { assignTenantModal } from './tenants.js';

const PROPERTY_TYPES = ['apartment', 'boarding_house', 'condominium', 'house', 'commercial', 'dormitory', 'other'];
const UNIT_TYPES = ['room', 'studio', 'apartment', 'bedspace', 'house', 'commercial_space', 'other'];

function propertyFields(p = {}) {
  return [
    field({ name: 'property_name', label: 'Property name', required: true, value: p.property_name, placeholder: 'e.g. Sampaguita Apartments', maxlength: 120 }),
    field({ name: 'property_type', label: 'Property type', type: 'select', required: true, value: p.property_type, options: options(PROPERTY_TYPES) }),
    field({ name: 'address', label: 'Street address', required: true, value: p.address, placeholder: 'House no., street, barangay', maxlength: 250 }),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'city', label: 'City / municipality', required: true, value: p.city, maxlength: 80 }),
      field({ name: 'province', label: 'Province', required: true, value: p.province, placeholder: 'e.g. Cavite', maxlength: 80 })),
    field({ name: 'postal_code', label: 'Postal code', value: p.postal_code, inputmode: 'numeric', maxlength: 10 }),
    field({ name: 'description', label: 'Notes', type: 'textarea', value: p.description, maxlength: 1000 }),
  ];
}

// A 409 DUPLICATE response becomes a review-and-confirm prompt.
function duplicateError(err, describe, retry) {
  if (!(err instanceof ApiError) || err.code !== 'DUPLICATE') return err;
  err.onRender = (box) => box.append(h('div', { class: 'alert alert--warn' },
    h('p', null, 'Possible duplicate:'),
    h('ul', null, err.data.duplicates.map((d) => h('li', null, describe(d)))),
    h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: retry }, 'It’s different — save anyway')));
  return err;
}

export function newPropertyModal({ onSaved } = {}) {
  let confirmDuplicate = false;
  const modal = formModal({
    title: 'Add property',
    submitText: 'Save property',
    draftKey: 'property-new',
    fields: propertyFields(),
    onSubmit: async (data) => {
      try {
        const res = await post('/properties', { ...data, confirm_duplicate: confirmDuplicate });
        toast('Property added. Now add its units.');
        if (onSaved) onSaved(res.property); else navigate(`#/properties/${res.property.property_id}?addUnit=1`);
      } catch (err) {
        throw duplicateError(err, (d) => h('a', { href: `#/properties/${d.property_id}`, target: '_blank' }, `${d.property_name} — ${d.address}, ${d.city}${d.status === 'archived' ? ' (archived)' : ''}`),
          () => { confirmDuplicate = true; modal.el.querySelector('form').requestSubmit(); });
      }
    },
  });
  return modal;
}

function unitFields(u = {}) {
  return [
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'unit_name', label: 'Unit name or number', required: true, value: u.unit_name, placeholder: 'e.g. 101 or Room A', maxlength: 60 }),
      field({ name: 'unit_type', label: 'Unit type', type: 'select', required: true, value: u.unit_type, options: options(UNIT_TYPES) })),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'monthly_rent', label: 'Monthly rent', type: 'money', required: true, value: u.monthly_rent, placeholder: '8,000' }),
      field({ name: 'security_deposit_amount', label: 'Security deposit', type: 'money', value: u.security_deposit_amount, placeholder: '16,000' })),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'availability', label: 'Availability', type: 'select', value: u.availability || 'available', placeholderOption: false, options: [['available', 'Available to rent'], ['unavailable', 'Not available (renovation, owner use)']] }),
      field({ name: 'availability_date', label: 'Available from', type: 'date', value: u.availability_date })),
  ];
}

function unitModal(property, unit, onSaved) {
  return formModal({
    title: unit ? `Edit unit ${unit.unit_name}` : `Add unit to ${property.property_name}`,
    submitText: unit ? 'Save changes' : 'Save unit',
    draftKey: unit ? null : `unit-new-${property.property_id}`,
    fields: unitFields(unit || {}),
    onSubmit: async (data) => {
      if (unit) await patch(`/units/${unit.unit_id}`, data);
      else await post(`/properties/${property.property_id}/units`, data);
      toast(unit ? 'Unit updated.' : 'Unit added.');
      onSaved();
    },
  });
}

// ---------------------------------------------------------------- list
export async function propertiesView(el, { query }) {
  const isOwner = state.user.role === 'owner';
  const filters = { status: query.status === 'archived' ? 'archived' : 'active', q: query.q || '' };
  const listCard = h('div', { class: 'card' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });

  async function load() {
    history.replaceState(null, '', `#/properties${qs(filters)}`);
    tabs.replaceChildren(
      h('button', { role: 'tab', 'aria-selected': String(filters.status === 'active'), onclick: () => { filters.status = 'active'; load(); } }, 'Active'),
      h('button', { role: 'tab', 'aria-selected': String(filters.status === 'archived'), onclick: () => { filters.status = 'archived'; load(); } }, 'Archived'));
    const { properties } = await get(`/properties${qs(filters)}`);
    listCard.replaceChildren(properties.length
      ? h('ul', { class: 'list' }, properties.map((p) => h('li', null, h('a', { class: 'row', href: `#/properties/${p.property_id}` },
        h('div', { class: 'row__main' },
          h('span', { class: 'row__title' }, p.property_name),
          h('span', { class: 'row__sub' }, `${label(p.property_type)} · ${p.address}, ${p.city}, ${p.province}`)),
        h('div', { class: 'row__end' },
          h('span', { class: 'small' }, `${p.unit_count} unit${p.unit_count === 1 ? '' : 's'}`),
          p.unit_count ? badge(p.occupied_count === p.unit_count ? 'occupied' : 'vacant', `${p.occupied_count} occupied · ${p.unit_count - p.occupied_count} vacant`) : badge('unpaid', 'No units yet'))))))
      : (filters.q
        ? emptyState({ title: 'No results found', text: `Nothing matches “${filters.q}”.`, action: h('button', { class: 'btn btn--secondary', onclick: () => { filters.q = ''; search.querySelector('input').value = ''; load(); } }, 'Clear search') })
        : emptyState({
          iconName: 'building',
          title: filters.status === 'archived' ? 'No archived properties' : (isOwner ? 'No properties yet' : 'No properties assigned to you'),
          text: filters.status === 'archived' ? '' : (isOwner ? 'Add a property — like an apartment building or boarding house — then add its rental units.' : 'Ask the workspace owner to assign you to a property.'),
          action: filters.status === 'active' && isOwner && h('button', { class: 'btn btn--primary', onclick: () => newPropertyModal() }, icon('plus'), 'Add property'),
        })));
  }

  const search = searchBox({ value: filters.q, placeholder: 'Search name, address or city', onSearch: (q) => { filters.q = q; load().catch((e) => toast(e.message, 'error')); } });
  await load();
  el.replaceChildren(
    pageHead({ title: 'Properties', sub: 'Buildings, houses and their rental units', actions: isOwner && h('button', { class: 'btn btn--primary', onclick: () => newPropertyModal() }, icon('plus'), 'Add property') }),
    h('div', { class: 'toolbar' }, search, tabs),
    listCard);

  if (query.new && isOwner) newPropertyModal();
}

// ---------------------------------------------------------------- detail
export async function propertyDetailView(el, { params, query, rerender }) {
  const { property, units } = await get(`/properties/${params.id}`);
  const role = state.user.role;
  const canManage = role !== 'staff';
  const isOwner = role === 'owner';
  const archived = property.status === 'archived';
  const active = units.filter((u) => u.status === 'active');
  const occupied = active.filter((u) => u.occupancy_status === 'occupied').length;

  const editProperty = () => formModal({
    title: 'Edit property', submitText: 'Save changes', fields: propertyFields(property),
    onSubmit: async (data) => { await patch(`/properties/${property.property_id}`, data); toast('Property updated.'); rerender(); },
  });
  const archiveProperty = async () => {
    if (!await confirmDialog({ title: 'Archive this property?', text: 'It will be hidden from lists and new records, but its payment and expense history stays in your reports. You can restore it later.', confirmText: 'Archive', danger: true })) return;
    try { await post(`/properties/${property.property_id}/archive`); toast('Property archived.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  const restoreProperty = async () => {
    try { await post(`/properties/${property.property_id}/restore`); toast('Property restored.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  const addUnit = () => unitModal(property, null, rerender);

  const unitRow = (u) => {
    const actions = [];
    if (canManage && u.status === 'active' && !archived) {
      if (u.occupancy_status === 'vacant') actions.push(h('button', { class: 'btn btn--primary btn--sm', onclick: () => assignTenantModal({ unit: { ...u, property_name: property.property_name }, onSaved: rerender }) }, 'Assign Tenant'));
      actions.push(h('button', { class: 'btn btn--ghost btn--sm', onclick: () => unitModal(property, u, rerender) }, 'Edit'));
      if (u.occupancy_status !== 'occupied') {
        actions.push(h('button', {
          class: 'btn btn--ghost btn--sm',
          onclick: async () => {
            if (!await confirmDialog({ title: `Archive unit ${u.unit_name}?`, text: 'Its history is kept. You can restore it later.', confirmText: 'Archive', danger: true })) return;
            try { await post(`/units/${u.unit_id}/archive`); toast('Unit archived.'); rerender(); } catch (err) { toast(err.message, 'error'); }
          },
        }, 'Archive'));
      }
    }
    if (canManage && u.status === 'archived' && !archived) {
      actions.push(h('button', { class: 'btn btn--ghost btn--sm', onclick: async () => { try { await post(`/units/${u.unit_id}/restore`); toast('Unit restored.'); rerender(); } catch (err) { toast(err.message, 'error'); } } }, 'Restore'));
    }
    return h('li', null, h('div', { class: 'row' },
      h('div', { class: 'row__main' },
        h('span', { class: 'row__title' }, unitLabel(u.unit_name), ' ', badge(u.occupancy_status)),
        h('span', { class: 'row__sub' }, `${label(u.unit_type)} · ${peso(u.monthly_rent)}/month${Number(u.security_deposit_amount) ? ` · deposit ${peso(u.security_deposit_amount)}` : ''}`),
        u.tenant_name && h('span', { class: 'row__sub' }, 'Tenant: ', h('a', { href: `#/tenants/${u.tenant_id}` }, u.tenant_name))),
      h('div', { class: 'row__end' }, h('div', { class: 'chips' }, actions))));
  };

  el.replaceChildren(
    pageHead({
      title: property.property_name,
      sub: `${label(property.property_type)} · ${property.address}, ${property.city}, ${property.province}${property.postal_code ? ` ${property.postal_code}` : ''}`,
      back: { href: '#/properties', label: 'Properties' },
      actions: [
        canManage && !archived && h('button', { class: 'btn btn--primary', onclick: addUnit }, icon('plus'), 'Add unit'),
        canManage && !archived && h('button', { class: 'btn btn--secondary', onclick: editProperty }, 'Edit'),
        isOwner && !archived && h('button', { class: 'btn btn--danger', onclick: archiveProperty }, 'Archive'),
        isOwner && archived && h('button', { class: 'btn btn--secondary', onclick: restoreProperty }, 'Restore'),
      ],
    }),
    archived && h('div', { class: 'alert alert--warn', style: { marginBottom: '16px' } }, 'This property is archived. Restore it to add units or tenants.'),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Units'), h('div', { class: 'stat__value' }, active.length)),
      h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Occupied'), h('div', { class: 'stat__value' }, occupied)),
      h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Vacant'), h('div', { class: 'stat__value' }, active.filter((u) => u.occupancy_status === 'vacant').length)),
      h('a', { class: 'stat', href: `#/rent?property_id=${property.property_id}&status=outstanding` }, h('div', { class: 'stat__label' }, 'Rent roll'), h('div', { class: 'stat__value' }, peso(active.filter((u) => u.occupancy_status === 'occupied').reduce((s, u) => s + Number(u.monthly_rent), 0))), h('div', { class: 'stat__sub' }, 'list rent of occupied units'))),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Units')),
      units.length ? h('ul', { class: 'list' }, units.map(unitRow))
        : emptyState({ title: 'No units yet', text: 'Add each rentable room, apartment or space so you can assign tenants and track rent.', action: canManage && !archived && h('button', { class: 'btn btn--primary', onclick: addUnit }, icon('plus'), 'Add unit') })),
    property.description && h('div', { class: 'card' }, h('h2', null, 'Notes'), h('p', { style: { marginTop: '8px', whiteSpace: 'pre-wrap' } }, property.description)),
  );

  if (query.addUnit && canManage) {
    history.replaceState(null, '', `#/properties/${property.property_id}`);
    addUnit();
  }
}
