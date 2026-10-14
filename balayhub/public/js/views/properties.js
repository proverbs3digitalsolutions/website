// Screen 4 — Properties & Units.

import { get, post, patch, qs, ApiError } from '../api.js';
import {
  h, icon, peso, badge, label, options, field, formModal, confirmDialog, emptyState, pageHead, toast, todayManila, unitLabel } from '../ui.js';
import { state, navigate } from '../app.js';
import { initFilters, filterBar, rememberFilters, changed } from '../filters.js';
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
    h('button', { class: 'btn btn--secondary', type: 'button', onclick: retry }, 'It’s different — save anyway')));
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
  const stayOnly = state.user.business_type === 'short_term';
  return [
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'unit_name', label: 'Unit name or number', required: true, value: u.unit_name, placeholder: 'e.g. 101 or Room A', maxlength: 60 }),
      field({ name: 'unit_type', label: 'Unit type', type: 'select', required: true, value: u.unit_type, options: options(UNIT_TYPES) })),
    h('div', { class: stayOnly ? 'form-row' : 'form-row form-row--2' },
      !stayOnly && field({ name: 'monthly_rent', label: 'Monthly rent', type: 'money', required: true, value: u.monthly_rent, placeholder: '8,000' }),
      field({ name: 'security_deposit_amount', label: 'Security deposit', type: 'money', value: u.security_deposit_amount, placeholder: '16,000' })),
    // A new unit with no nightly rate is an unpriced listing the edit form then refuses to save.
    !u.unit_id && state.user.business_type !== 'long_term' && h('div', { class: 'form-row' },
      field({ name: 'nightly_rate', label: 'Base nightly rate (₱)', type: 'money', required: true, placeholder: '2,500' })),
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
  const stayOnly = state.user.business_type === 'short_term';
  const defaults = { status: 'active', q: '', type: '', city: '', occupancy: '', sort: '' };
  const filters = initFilters('properties', query, defaults);
  if (filters.status !== 'archived') filters.status = 'active';
  // Occupancy is a long-term idea: a link to it in a short-term workspace is ignored, and so is the vacant-units sort.
  if (stayOnly) filters.occupancy = '';
  if (stayOnly && filters.sort === 'vacant') filters.sort = '';
  const listCard = h('div', { class: 'card' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  // City choices come from every property this person can see, active or archived.
  const [{ properties: activeAll }, { properties: archivedAll }] = await Promise.all([get('/properties'), get('/properties?status=archived')]);
  const cities = [...new Map([...activeAll, ...archivedAll].map((p) => [p.city.trim().toLowerCase(), p.city.trim()])).values()].sort((a, b) => a.localeCompare(b));

  async function load() {
    history.replaceState(null, '', `#/properties${qs(changed(filters, defaults))}`);
    tabs.replaceChildren(...[['active', 'Active'], ['archived', 'Archived']].map(([s, t]) => h('button', {
      role: 'tab', 'aria-selected': String(filters.status === s),
      onclick: () => { filters.status = s; rememberFilters('properties', filters); load(); },
    }, t)));
    const { properties } = await get(`/properties${qs(changed(filters, defaults))}`);
    const filtered = Object.keys(changed(filters, defaults)).some((k) => k !== 'status' && k !== 'sort');
    listCard.replaceChildren(properties.length
      ? [filtered && h('p', { class: 'muted small' }, `Showing ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'}`),
        h('ul', { class: 'list' }, properties.map((p) => h('li', null, h('a', { class: 'row', href: `#/properties/${p.property_id}` },
          h('div', { class: 'row__main' },
            h('span', { class: 'row__title' }, p.property_name),
            h('span', { class: 'row__sub' }, `${label(p.property_type)} · ${p.address}, ${p.city}, ${p.province}`)),
          h('div', { class: 'row__end' },
            h('span', { class: 'small' }, `${p.unit_count} unit${p.unit_count === 1 ? '' : 's'}`),
            p.unit_count ? !stayOnly && badge(p.occupied_count === p.unit_count ? 'occupied' : 'vacant', `${p.occupied_count} occupied · ${p.unit_count - p.occupied_count} vacant`) : badge('unpaid', 'No units yet'))))))]
      : (filtered
        ? emptyState({ title: 'No results found', text: 'No property matches these filters. Try removing a filter.', action: h('button', { class: 'btn btn--secondary', onclick: () => { Object.assign(filters, defaults); rememberFilters('properties', filters); renderBar(); load(); } }, 'Clear filters') })
        : emptyState({
          iconName: 'building',
          title: filters.status === 'archived' ? 'No archived properties' : (isOwner ? 'No properties yet' : 'No properties assigned to you'),
          text: filters.status === 'archived' ? '' : (isOwner ? 'Add a property — like an apartment building or boarding house — then add its rental units.' : 'Ask the workspace owner to assign you to a property.'),
          action: filters.status === 'active' && isOwner && h('button', { class: 'btn btn--primary', onclick: () => newPropertyModal() }, icon('plus'), 'Add property'),
        })));
  }

  const barBox = h('div');
  // The bar is rebuilt when filters are reset from outside it (so its inputs match).
  function renderBar() {
    barBox.replaceChildren(filterBar({
      key: 'properties', values: filters, defaults, onChange: () => load().catch((e) => toast(e.message, 'error')),
      search: { placeholder: 'Search name, address, city or province' },
      quick: [
        { name: 'type', label: 'Type', all: 'All types', options: PROPERTY_TYPES.map((t) => [t, label(t)]) },
        ...(stayOnly ? [] : [{ name: 'occupancy', label: 'Occupancy', all: 'Any occupancy', options: [['vacant', 'Has vacant units'], ['full', 'Fully occupied'], ['no_units', 'No units yet']] }]),
      ],
      more: [
        cities.length > 1 && { name: 'city', label: 'City / municipality', all: 'All cities', options: cities.map((c) => [c, c]) },
        { name: 'sort', label: 'Sort by', all: 'Name (A–Z)', options: [['city', 'City'], ['units', 'Most units'], ...(stayOnly ? [] : [['vacant', 'Most vacant units']]), ['newest', 'Newest added']] },
      ].filter(Boolean),
    }));
  }
  renderBar();
  await load();
  el.replaceChildren(
    pageHead({ title: 'Properties', sub: 'Buildings, houses and their rental units', actions: isOwner && h('button', { class: 'btn btn--primary', onclick: () => newPropertyModal() }, icon('plus'), 'Add property') }),
    tabs, barBox,
    listCard);

  if (query.new && isOwner) newPropertyModal();
}

// ---------------------------------------------------------------- detail
export async function propertyDetailView(el, { params, query, rerender }) {
  const { property, units } = await get(`/properties/${params.id}`);
  const role = state.user.role;
  const canManage = role !== 'staff';
  const isOwner = role === 'owner';
  const stayOnly = state.user.business_type === 'short_term';
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
      if (!stayOnly && u.occupancy_status === 'vacant') actions.push(h('button', { class: 'btn btn--primary', 'aria-label': `Assign tenant to unit ${u.unit_name}`, onclick: () => assignTenantModal({ unit: { ...u, property_name: property.property_name }, onSaved: rerender }) }, 'Assign Tenant'));
      actions.push(h('button', { class: 'btn btn--ghost btn--sm', 'aria-label': `Edit unit ${u.unit_name}`, onclick: () => unitModal(property, u, rerender) }, 'Edit'));
      if (u.occupancy_status !== 'occupied') {
        actions.push(h('button', {
          class: 'btn btn--ghost btn--sm',
          'aria-label': `Archive unit ${u.unit_name}`,
          onclick: async () => {
            if (!await confirmDialog({ title: `Archive unit ${u.unit_name}?`, text: 'Its history is kept. You can restore it later.', confirmText: 'Archive', danger: true })) return;
            try { await post(`/units/${u.unit_id}/archive`); toast('Unit archived.'); rerender(); } catch (err) { toast(err.message, 'error'); }
          },
        }, 'Archive'));
      }
    }
    if (canManage && u.status === 'archived' && !archived) {
      actions.push(h('button', { class: 'btn btn--ghost btn--sm', 'aria-label': `Restore unit ${u.unit_name}`, onclick: async () => { try { await post(`/units/${u.unit_id}/restore`); toast('Unit restored.'); rerender(); } catch (err) { toast(err.message, 'error'); } } }, 'Restore'));
    }
    return h('li', null, h('div', { class: 'row' },
      h('div', { class: 'row__main' },
        h('span', { class: 'row__title' }, unitLabel(u.unit_name), ' ', !(stayOnly && ['vacant', 'occupied'].includes(u.occupancy_status)) && badge(u.occupancy_status)),
        h('span', { class: 'row__sub' }, `${label(u.unit_type)}${stayOnly ? '' : u.lease_rent == null ? ` · ${peso(u.monthly_rent)}/month` : ` · ${peso(u.lease_rent)}/month (lease)${Number(u.lease_rent) !== Number(u.monthly_rent) ? ` · listed ${peso(u.monthly_rent)}` : ''}`}${Number(u.security_deposit_amount) ? ` · deposit ${peso(u.security_deposit_amount)}` : ''}`),
        u.tenant_name && h('span', { class: 'row__sub' }, 'Tenant: ', h('a', { href: `#/tenants/${u.tenant_id}` }, u.tenant_name))),
      h('div', { class: 'row__end' }, h('div', { class: 'chips' }, actions))));
  };

  // Unit filters (client-side: one property's units are already loaded). Shown
  // once a property has enough units for filtering to help.
  const unitDefaults = { uq: '', occupancy: '', unit_type: '', usort: '' };
  const showUnitFilters = units.length > 4;
  const uf = initFilters('property-units', query, unitDefaults);
  uf.uq = query.uq || ''; // a unit search belongs to one property; status, type and sort carry over
  const unitList = h('div');
  const soon = (() => { const d = new Date(`${todayManila()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 60); return d.toISOString().slice(0, 10); })();
  const byName = (a, b) => a.unit_name.localeCompare(b.unit_name, undefined, { numeric: true });
  function renderUnits() {
    if (!showUnitFilters) { unitList.replaceChildren(h('ul', { class: 'list' }, units.map(unitRow))); return; }
    history.replaceState(null, '', `#/properties/${property.property_id}${qs(changed(uf, unitDefaults))}`);
    const q = uf.uq.toLowerCase();
    const shown = units.filter((u) => (!q || u.unit_name.toLowerCase().includes(q) || (u.tenant_name || '').toLowerCase().includes(q))
      && (!uf.unit_type || u.unit_type === uf.unit_type)
      && (!uf.occupancy || (uf.occupancy === 'ending' ? u.occupancy_status === 'occupied' && u.lease_end_date && u.lease_end_date <= soon : u.occupancy_status === uf.occupancy)));
    const sorters = {
      rent_desc: (a, b) => Number(b.monthly_rent) - Number(a.monthly_rent) || byName(a, b),
      rent_asc: (a, b) => Number(a.monthly_rent) - Number(b.monthly_rent) || byName(a, b),
      lease_end: (a, b) => (a.lease_end_date || '9999').localeCompare(b.lease_end_date || '9999') || byName(a, b),
      name: byName,
    };
    if (sorters[uf.usort]) shown.sort(sorters[uf.usort]);
    unitList.replaceChildren(shown.length
      ? [shown.length < units.length && h('p', { class: 'muted small' }, `Showing ${shown.length} of ${units.length} units`), h('ul', { class: 'list' }, shown.map(unitRow))]
      : emptyState({ title: 'No results found', text: 'No unit matches these filters. Try removing a filter.' }));
  }
  const unitBar = showUnitFilters && filterBar({
    key: 'property-units', values: uf, defaults: unitDefaults, onChange: renderUnits,
    search: { name: 'uq', placeholder: stayOnly ? 'Search unit' : 'Search unit or tenant' },
    quick: [
      { name: 'occupancy', label: 'Status', all: 'All units', options: [...(stayOnly ? [] : [['vacant', 'Vacant'], ['occupied', 'Occupied'], ['ending', 'Lease ends within 60 days']]), ['unavailable', 'Not available'], ['archived', 'Archived']] },
    ],
    more: [
      { name: 'unit_type', label: 'Unit type', all: 'All types', options: UNIT_TYPES.map((t) => [t, label(t)]) },
      { name: 'usort', label: 'Sort by', all: 'Default', options: [['name', 'Unit name'], ['rent_desc', 'Highest rent'], ['rent_asc', 'Lowest rent'], ['lease_end', 'Lease ending soonest']] },
    ],
  });
  if (units.length) renderUnits();

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
      !stayOnly && h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Occupied'), h('div', { class: 'stat__value' }, occupied)),
      !stayOnly && h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Vacant'), h('div', { class: 'stat__value' }, active.filter((u) => u.occupancy_status === 'vacant').length)),
      !stayOnly && h('a', { class: 'stat', href: `#/rent?property_id=${property.property_id}&status=outstanding` }, h('div', { class: 'stat__label' }, 'Rent roll'), h('div', { class: 'stat__value' }, peso(active.filter((u) => u.occupancy_status === 'occupied').reduce((s, u) => s + Number(u.lease_rent ?? u.monthly_rent), 0))), h('div', { class: 'stat__sub' }, 'Monthly rent from current leases'))),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Units')),
      unitBar,
      units.length ? unitList
        : emptyState({ title: 'No units yet', text: 'Add each rentable room, apartment or space so you can assign tenants and track rent.', action: canManage && !archived && h('button', { class: 'btn btn--primary', onclick: addUnit }, icon('plus'), 'Add unit') })),
    property.description && h('div', { class: 'card' }, h('h2', null, 'Notes'), h('p', { style: { marginTop: '8px', whiteSpace: 'pre-wrap' } }, property.description)),
  );

  if (query.addUnit && canManage) {
    history.replaceState(null, '', `#/properties/${property.property_id}`);
    addUnit();
  }
}
