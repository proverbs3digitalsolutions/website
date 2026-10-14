// Screen 5 — Tenants & Leases.

import { get, post, patch, qs, uploadFile, ApiError } from '../api.js';
import {
  h, icon, peso, fmtDate, badge, label, field, formModal, confirmDialog, emptyState, pageHead, toast,
  todayManila, filesList, openModal, unitLabel } from '../ui.js';
import { state, navigate } from '../app.js';
import { initFilters, filterBar, rememberFilters, changed } from '../filters.js';
import { recordPaymentModal } from './rent.js';

function tenantFields(t = {}) {
  return [
    field({ name: 'full_name', label: 'Full name', required: true, value: t.full_name, autocomplete: 'off', maxlength: 120 }),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'phone', label: 'Mobile number', type: 'tel', value: t.phone, placeholder: '0917 123 4567', inputmode: 'tel', maxlength: 20 }),
      field({ name: 'email', label: 'Email', type: 'email', value: t.email })),
    field({ name: 'emergency_contact', label: 'Emergency contact (optional)', value: t.emergency_contact, placeholder: 'Name and number', maxlength: 200 }),
    field({ name: 'notes', label: 'Notes', type: 'textarea', value: t.notes, maxlength: 1000, hint: 'Only record what you need to manage the tenancy. Avoid sensitive personal details.' }),
  ];
}

export function newTenantModal({ onSaved } = {}) {
  let confirmDuplicate = false;
  const modal = formModal({
    title: 'Add tenant',
    submitText: 'Save tenant',
    draftKey: 'tenant-new',
    fields: tenantFields(),
    onSubmit: async (data) => {
      try {
        const res = await post('/tenants', { ...data, confirm_duplicate: confirmDuplicate });
        toast('Tenant added. Next, assign them to a unit.');
        if (onSaved) onSaved(res.tenant); else navigate(`#/tenants/${res.tenant.tenant_id}?assign=1`);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'DUPLICATE') {
          err.onRender = (box) => box.append(h('div', { class: 'alert alert--warn' },
            h('p', null, 'Possible duplicate:'),
            h('ul', null, err.data.duplicates.map((d) => h('li', null,
              h('a', { href: `#/tenants/${d.tenant_id}`, target: '_blank' }, d.full_name), [d.phone, d.email].filter(Boolean).length ? ` — ${[d.phone, d.email].filter(Boolean).join(', ')}` : '', d.status === 'archived' ? ' (archived)' : ''))),
            h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => { confirmDuplicate = true; modal.el.querySelector('form').requestSubmit(); } }, 'It’s a different person — save anyway')));
        }
        throw err;
      }
    },
  });
  return modal;
}

// Assign a tenant to a vacant unit by creating a lease.
export async function assignTenantModal({ tenant, unit, onSaved } = {}) {
  let tenants = [];
  let units = [];
  try {
    [tenants, units] = await Promise.all([
      tenant ? Promise.resolve([tenant]) : get('/tenants').then((r) => r.tenants.filter((t) => !t.lease_id)),
      unit ? Promise.resolve([unit]) : get('/units?vacant=1').then((r) => r.units),
    ]);
  } catch (err) { toast(err.message, 'error'); return; }

  if (!units.length) {
    openModal({ title: 'No vacant units', body: h('div', { class: 'form' }, h('p', null, 'Every unit you manage is occupied or unavailable. Add a unit to a property first, or end an existing lease.'), h('a', { class: 'btn btn--primary', href: '#/properties' }, 'Go to Properties')) });
    return;
  }
  if (!tenants.length) {
    openModal({ title: 'No tenants to assign', body: h('div', { class: 'form' }, h('p', null, 'All tenants already have a unit. Add a new tenant first.'), h('button', { class: 'btn btn--primary', onclick: () => { document.querySelector('dialog.modal')?.close(); newTenantModal(); } }, 'Add tenant')) });
    return;
  }

  const unitSelect = field({
    name: 'unit_id', label: 'Unit', type: 'select', required: true, value: unit?.unit_id,
    options: units.map((u) => [u.unit_id, `${u.property_name} — ${unitLabel(u.unit_name)} (${peso(u.monthly_rent)})`]),
  });
  const rentField = field({ name: 'monthly_rent', label: 'Monthly rent', type: 'money', required: true, value: unit?.monthly_rent || (units.length === 1 ? units[0].monthly_rent : '') });
  const depositField = field({ name: 'deposit_amount', label: 'Security deposit', type: 'money', value: unit?.security_deposit_amount || (units.length === 1 ? units[0].security_deposit_amount : '') });
  unitSelect.querySelector('select').addEventListener('change', (e) => {
    const u = units.find((x) => x.unit_id === e.target.value);
    if (!u) return;
    rentField.querySelector('input').value = u.monthly_rent;
    depositField.querySelector('input').value = u.security_deposit_amount || '';
  });
  const today = todayManila();
  const schedule = h('div', { class: 'alert alert--info', 'aria-live': 'polite' });

  const modal = formModal({
    title: tenant ? `Assign ${tenant.full_name} to a unit` : 'Assign tenant to unit',
    submitText: 'Save lease',
    fields: [
      field({ name: 'tenant_id', label: 'Tenant', type: 'select', required: true, value: tenant?.tenant_id, options: tenants.map((t) => [t.tenant_id, t.full_name]) }),
      unitSelect,
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'start_date', label: 'Lease start', type: 'date', required: true, value: today }),
        field({ name: 'end_date', label: 'Lease end', type: 'date', hint: 'Leave blank for month-to-month.' })),
      h('div', { class: 'form-row form-row--2' },
        rentField,
        field({ name: 'due_day', label: 'Rent due every month on day', type: 'number', required: true, value: Number(today.slice(8, 10)), min: 1, max: 31, inputmode: 'numeric', hint: 'For short months, rent is due on the last day.' })),
      depositField,
      schedule,
    ],
    onSubmit: async (data) => {
      const res = await post('/leases', data);
      toast('Lease saved. The unit is now occupied.');
      if (onSaved) onSaved(res.lease); else navigate(`#/tenants/${data.tenant_id}`);
    },
  });

  // Plain-language preview of the billing schedule this lease will create.
  const form = modal.el.querySelector('form');
  const updateSchedule = () => {
    const start = form.elements.start_date.value;
    const day = Number(form.elements.due_day.value);
    if (!start || !(day >= 1 && day <= 31)) { schedule.textContent = 'Enter the lease start and due day to see the billing schedule.'; return; }
    const [y, m, d] = start.split('-').map(Number);
    const dueIn = (yy, mm) => new Date(Date.UTC(yy, mm - 1, Math.min(day, new Date(Date.UTC(yy, mm, 0)).getUTCDate()))).toISOString().slice(0, 10);
    const first = dueIn(y, m) < start ? start : dueIn(y, m);
    const next = dueIn(y, m + 1);
    const past = start < today;
    schedule.textContent = `First month’s rent is due ${fmtDate(first)}, then on day ${day} of each month (next: ${fmtDate(next)}).`
      + (past ? ' Because the start date is in the past, rent for earlier months is added now and will show as unpaid until you record those payments.' : '')
      + (d !== day ? ' Tip: set the due day to the move-in day to bill each full month in advance.' : '');
  };
  form.addEventListener('input', updateSchedule);
  updateSchedule();
}

// ---------------------------------------------------------------- list
export async function tenantsView(el, { query }) {
  const canManage = state.user.role !== 'staff';
  const defaults = { status: 'active', q: '', lease: '', property_id: '', unit_id: '', balance: '', min_balance: '', sort: '' };
  const filters = initFilters('tenants', query, defaults);
  if (filters.status !== 'archived') filters.status = 'active';
  const [{ properties }, { units }] = await Promise.all([get('/properties'), get('/units')]);
  const listCard = h('div', { class: 'card' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });

  async function load() {
    history.replaceState(null, '', `#/tenants${qs(changed(filters, defaults))}`);
    tabs.replaceChildren(...['active', 'archived'].map((s) => h('button', { role: 'tab', 'aria-selected': String(filters.status === s), onclick: () => { filters.status = s; rememberFilters('tenants', filters); load(); } }, s === 'active' ? 'Current' : 'Archived')));
    const { tenants } = await get(`/tenants${qs(changed(filters, defaults))}`);
    const filtered = Object.keys(changed(filters, defaults)).some((k) => k !== 'status' && k !== 'sort');
    const owing = tenants.reduce((sum, t) => sum + Number(t.outstanding), 0);
    listCard.replaceChildren(tenants.length
      ? [filtered && h('p', { class: 'muted small' }, `Showing ${tenants.length} tenant${tenants.length === 1 ? '' : 's'}${owing > 0 ? ` · ${peso(owing)} unpaid` : ''}`),
        h('ul', { class: 'list' }, tenants.map((t) => h('li', null, h('a', { class: 'row', href: `#/tenants/${t.tenant_id}` },
          h('div', { class: 'row__main' },
            h('span', { class: 'row__title' }, t.full_name),
            h('span', { class: 'row__sub' }, t.lease_id ? `${t.property_name} · ${unitLabel(t.unit_name)} · ${peso(t.monthly_rent)}/mo${t.end_date ? ` · lease ends ${fmtDate(t.end_date)}` : ''}` : 'No unit assigned'),
            !t.limited && (t.phone || t.email) && h('span', { class: 'row__sub' }, [t.phone, t.email].filter(Boolean).join(' · '))),
          h('div', { class: 'row__end' },
            Number(t.overdue) > 0 ? [h('span', { class: 'amount amount--neg' }, peso(t.overdue)), badge('overdue')]
              : Number(t.outstanding) > 0 ? [h('span', { class: 'amount' }, peso(t.outstanding)), badge('unpaid', 'Balance')]
                : t.lease_id ? badge('paid', 'Up to date') : badge('vacant', 'Unassigned'))))))]
      : (filtered
        ? emptyState({ title: 'No results found', text: filters.q ? `No tenant matches “${filters.q}” with these filters. Try removing a filter.` : 'No tenant matches these filters. Try removing a filter.', action: h('button', { class: 'btn btn--secondary', onclick: () => { Object.assign(filters, defaults); rememberFilters('tenants', filters); renderBar(); load(); } }, 'Clear filters') })
        : emptyState({
          iconName: 'users',
          title: filters.status === 'archived' ? 'No archived tenants' : 'No tenants yet',
          text: filters.status === 'archived' ? '' : 'Add a tenant, then assign them to a unit with their rent and lease dates. If you have no units yet, add a property first.',
          action: filters.status === 'active' && canManage && h('div', { class: 'chips' },
            h('button', { class: 'btn btn--primary', onclick: () => newTenantModal() }, icon('plus'), 'Add tenant'),
            h('a', { class: 'btn btn--secondary', href: '#/properties' }, 'Go to Properties')),
        })));
  }

  const barBox = h('div');
  function renderBar() {
    // Unit choices follow the chosen property.
    const unitOptions = units.filter((u) => !filters.property_id || u.property_id === filters.property_id)
      .map((u) => [u.unit_id, `${unitLabel(u.unit_name)}${properties.length > 1 && !filters.property_id ? ` · ${u.property_name}` : ''}`]);
    let lastProperty = filters.property_id;
    barBox.replaceChildren(filterBar({
      key: 'tenants', values: filters, defaults,
      onChange: () => {
        if (filters.property_id !== lastProperty) {
          if (filters.unit_id && !units.some((u) => u.unit_id === filters.unit_id && (!filters.property_id || u.property_id === filters.property_id))) filters.unit_id = '';
          lastProperty = filters.property_id;
          rememberFilters('tenants', filters);
          renderBar();
        }
        load().catch((e) => toast(e.message, 'error'));
      },
      search: { placeholder: canManage ? 'Search name, phone, unit or property' : 'Search name, unit or property' },
      quick: [
        { name: 'lease', label: 'Lease', all: 'Any lease', options: [['active', 'Has a current lease'], ['ending30', 'Ending within 30 days'], ['ending60', 'Ending within 60 days'], ['no_end', 'No end date (month-to-month)'], ['moved_out', 'Moved out'], ['none', 'No unit assigned']] },
        { name: 'balance', label: 'Balance', all: 'Any balance', options: [['overdue', 'Overdue'], ['owing', 'Has unpaid balance'], ['clear', 'Up to date']] },
      ],
      more: [
        properties.length > 1 && { name: 'property_id', label: 'Property', all: 'All properties', options: properties.map((p) => [p.property_id, p.property_name]) },
        { name: 'unit_id', label: 'Unit', all: 'All units', options: unitOptions },
        { name: 'min_balance', label: 'Owes at least (₱)', type: 'number', min: 0, step: '0.01' },
        { name: 'sort', label: 'Sort by', all: 'Name (A–Z)', options: [['balance', 'Biggest balance'], ['overdue', 'Most overdue'], ['lease_end', 'Lease ending soonest'], ['move_in', 'Newest move-in'], ['rent', 'Highest rent'], ['unit', 'Property and unit'], ['newest', 'Recently added']] },
      ].filter(Boolean),
    }));
  }
  renderBar();
  await load();
  el.replaceChildren(
    pageHead({
      title: 'Tenants & Leases', sub: 'Who rents each unit, on what terms, and what they owe',
      actions: canManage && [
        h('button', { class: 'btn btn--primary', onclick: () => newTenantModal() }, icon('plus'), 'Add tenant'),
        h('button', { class: 'btn btn--secondary', onclick: () => assignTenantModal() }, 'Assign Unit')],
    }),
    tabs, barBox,
    listCard);
}

// ---------------------------------------------------------------- detail
export async function tenantDetailView(el, { params, query, rerender }) {
  const { tenant, leases, payments, charges } = await get(`/tenants/${params.id}`);
  const role = state.user.role;
  const canManage = role !== 'staff';
  const active = leases.find((l) => l.lease_status === 'active');
  const archived = tenant.status === 'archived';
  const totals = leases.reduce((a, l) => ({ outstanding: a.outstanding + Number(l.outstanding), overdue: a.overdue + Number(l.overdue), credit: a.credit + Number(l.credit) }), { outstanding: 0, overdue: 0, credit: 0 });

  const edit = () => formModal({
    title: 'Edit tenant', submitText: 'Save changes', fields: tenantFields(tenant),
    onSubmit: async (data) => { await patch(`/tenants/${tenant.tenant_id}`, data); toast('Tenant updated.'); rerender(); },
  });

  const endLease = (lease) => formModal({
    title: 'End lease',
    submitText: 'End lease',
    fields: [
      h('p', null, `${unitLabel(lease.unit_name)} becomes vacant. Any unpaid balance stays on record and can still be collected.`),
      field({ name: 'end_date', label: 'Move-out date', type: 'date', required: true, value: todayManila(), max: todayManila(), hint: 'Planning a future move-out? Use “Change terms” to set the lease end date, then end the lease on moving day.' }),
      field({ name: 'lease_status', label: 'Reason', type: 'select', required: true, value: 'ended', placeholderOption: false, options: [['ended', 'Lease ended / tenant moved out'], ['terminated', 'Terminated early']] }),
      field({ name: 'note', label: 'Note (optional)', type: 'textarea', maxlength: 500 }),
    ],
    onSubmit: async (data) => { await post(`/leases/${lease.lease_id}/end`, data); toast('Lease ended.'); rerender(); },
  });

  const cancelLease = async (lease) => {
    if (!await confirmDialog({ title: 'Cancel this lease?', text: 'Use this only if the lease was entered by mistake. Its rent charges will be removed. Leases with recorded payments must be ended instead.', confirmText: 'Cancel lease', danger: true })) return;
    try { await post(`/leases/${lease.lease_id}/cancel`); toast('Lease cancelled.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };

  const editTerms = (lease) => formModal({
    title: 'Change lease terms',
    submitText: 'Save changes',
    fields: [
      h('p', { class: 'muted small' }, 'Rent changes apply to months that have not been billed yet.'),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'monthly_rent', label: 'Monthly rent', type: 'money', required: true, value: lease.monthly_rent }),
        field({ name: 'due_day', label: 'Due day', type: 'number', min: 1, max: 31, required: true, value: lease.due_day })),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'end_date', label: 'Lease end', type: 'date', value: lease.end_date }),
        field({ name: 'deposit_amount', label: 'Security deposit', type: 'money', value: lease.deposit_amount })),
    ],
    onSubmit: async (data) => { await patch(`/leases/${lease.lease_id}`, data); toast('Lease updated.'); rerender(); },
  });

  const leaseDocs = async (lease) => {
    const { files } = await get(`/leases/${lease.lease_id}`);
    const input = h('input', { type: 'file', accept: 'application/pdf,image/jpeg,image/png,image/webp', class: 'input', 'aria-label': 'Lease document' });
    const status = h('div');
    openModal({
      title: `Lease documents — ${unitLabel(lease.unit_name)}`,
      body: h('div', { class: 'form' },
        filesList(files),
        h('div', { class: 'field' }, h('label', null, 'Upload signed lease or tenant document'), input, h('div', { class: 'hint' }, 'PDF, JPG, PNG or WEBP up to 10 MB. Stored privately.')),
        status,
        h('div', { class: 'form-actions' }, h('button', {
          class: 'btn btn--primary', type: 'button',
          onclick: async (e) => {
            const file = input.files[0];
            if (!file) { status.replaceChildren(h('div', { class: 'alert alert--error' }, 'Choose a file first.')); return; }
            e.target.disabled = true;
            try { await uploadFile('lease', lease.lease_id, file); toast('Document uploaded.'); document.querySelector('dialog.modal')?.close(); } catch (err) { status.replaceChildren(h('div', { class: 'alert alert--error' }, err.message)); }
            e.target.disabled = false;
          },
        }, 'Upload'))),
    });
  };

  const leaseCard = (l) => h('div', { class: 'card' },
    h('div', { class: 'card__head' },
      h('h2', null, h('a', { href: `#/properties/${l.property_id}` }, l.property_name), ` · ${unitLabel(l.unit_name)}`),
      badge(l.lease_status)),
    h('dl', { class: 'dl' },
      h('dt', null, 'Lease period'), h('dd', null, `${fmtDate(l.start_date)} – ${l.end_date ? fmtDate(l.end_date) : 'month-to-month'}`),
      h('dt', null, 'Monthly rent'), h('dd', null, `${peso(l.monthly_rent)}, due on day ${l.due_day}`),
      h('dt', null, 'Security deposit'), h('dd', null, peso(l.deposit_amount)),
      h('dt', null, 'Billed to date'), h('dd', null, peso(l.total_charged)),
      h('dt', null, 'Paid to date'), h('dd', null, peso(l.total_paid)),
      h('dt', null, 'Balance'), h('dd', { class: Number(l.outstanding) > 0 ? 'amount--neg' : '' }, peso(l.outstanding), Number(l.overdue) > 0 ? ` (${peso(l.overdue)} overdue)` : ''),
      Number(l.credit) > 0 && [h('dt', null, 'Advance / credit'), h('dd', null, peso(l.credit))]),
    h('div', { class: 'chips', style: { marginTop: '14px' } },
      (l.lease_status === 'active' || Number(l.outstanding) > 0) && h('button', { class: 'btn btn--primary', onclick: () => recordPaymentModal({ leaseId: l.lease_id, onSaved: rerender }) }, 'Record payment'),
      canManage && h('button', { class: 'btn btn--secondary btn--sm', onclick: () => leaseDocs(l) }, 'Documents'),
      canManage && l.lease_status === 'active' && [
        h('button', { class: 'btn btn--ghost btn--sm', onclick: () => editTerms(l) }, 'Change terms'),
        h('button', { class: 'btn btn--ghost btn--sm', onclick: () => endLease(l) }, 'End lease'),
        Number(l.total_paid) === 0 && h('button', { class: 'btn btn--ghost btn--sm', onclick: () => cancelLease(l) }, 'Cancel (entered by mistake)')]));

  const chargeRows = charges.slice(0, 24).map((c) => h('tr', null,
    h('td', { style: { whiteSpace: 'nowrap' } }, fmtDate(c.due_date)),
    h('td', { class: 'num' }, peso(c.amount_due)),
    h('td', { class: 'num' }, peso(c.amount_applied)),
    h('td', { class: 'num' }, peso(c.balance)),
    h('td', null, badge(c.status))));

  el.replaceChildren(
    pageHead({
      title: tenant.full_name,
      sub: active ? `${active.property_name} · ${unitLabel(active.unit_name)}` : (archived ? 'Archived tenant' : 'No unit assigned'),
      back: { href: '#/tenants', label: 'Tenants' },
      actions: [
        canManage && !active && !archived && h('button', { class: 'btn btn--primary', onclick: () => assignTenantModal({ tenant, onSaved: rerender }) }, 'Assign Unit'),
        canManage && h('button', { class: 'btn btn--secondary', onclick: edit }, 'Edit'),
        canManage && !active && !archived && h('button', {
          class: 'btn btn--danger',
          onclick: async () => {
            const owed = totals.outstanding > 0 ? ` They still owe ${peso(totals.outstanding)}. The unpaid balance stays on record until it is paid.` : '';
            if (!await confirmDialog({ title: 'Archive tenant?', text: `Their lease and payment history is kept. You can restore them later.${owed}`, confirmText: 'Archive', danger: true })) return;
            try { await post(`/tenants/${tenant.tenant_id}/archive`); toast('Tenant archived.'); rerender(); } catch (err) { toast(err.message, 'error'); }
          },
        }, 'Archive'),
        canManage && archived && h('button', { class: 'btn btn--secondary', onclick: async () => { await post(`/tenants/${tenant.tenant_id}/restore`); toast('Tenant restored.'); rerender(); } }, 'Restore'),
        role === 'owner' && h('a', { class: 'btn btn--ghost', href: `/api/tenants/${tenant.tenant_id}/export`, download: '' }, 'Export data'),
      ],
    }),
    h('div', { class: 'stats' },
      h('div', { class: `stat${totals.overdue > 0 ? ' stat--alert' : ''}` }, h('div', { class: 'stat__label' }, 'Balance'), h('div', { class: 'stat__value' }, peso(totals.outstanding)), h('div', { class: 'stat__sub' }, totals.overdue > 0 ? `${peso(totals.overdue)} overdue` : 'Nothing overdue')),
      h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Monthly rent'), h('div', { class: 'stat__value' }, active ? peso(active.monthly_rent) : '—')),
      h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Lease ends'), h('div', { class: 'stat__value' }, active ? (active.end_date ? fmtDate(active.end_date) : 'Open') : '—')),
      h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Payments'), h('div', { class: 'stat__value' }, payments.filter((p) => !p.voided_at).length))),
    h('div', { class: 'grid grid--2' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Contact')),
          tenant.limited ? h('p', { class: 'muted small' }, 'Contact details are limited to owners and property managers.')
            : h('dl', { class: 'dl' },
              h('dt', null, 'Mobile'), h('dd', null, tenant.phone ? h('a', { href: `tel:${tenant.phone.replace(/[^\d+]/g, '')}` }, tenant.phone) : '—'),
              h('dt', null, 'Email'), h('dd', null, tenant.email ? h('a', { href: `mailto:${tenant.email}` }, tenant.email) : '—'),
              h('dt', null, 'Emergency contact'), h('dd', null, tenant.emergency_contact || '—'),
              tenant.notes && [h('dt', null, 'Notes'), h('dd', { style: { whiteSpace: 'pre-wrap' } }, tenant.notes)])),
        leases.length ? leases.map(leaseCard) : h('div', { class: 'card' }, emptyState({ title: 'No lease yet', text: 'Assign this tenant to a vacant unit to start tracking rent.', action: canManage && !archived && h('button', { class: 'btn btn--primary', onclick: () => assignTenantModal({ tenant, onSaved: rerender }) }, 'Assign Unit') }))),
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Payment history')),
          payments.length ? h('ul', { class: 'list' }, payments.map((p) => h('li', null, h('a', { class: 'row', href: `#/payments/${p.payment_id}` },
            h('div', { class: 'row__main' }, h('span', { class: `row__title${p.voided_at ? ' strike' : ''}` }, fmtDate(p.payment_date)), h('span', { class: 'row__sub' }, `${label(p.payment_method)}${p.reference_number ? ` · Ref ${p.reference_number}` : ''} · ${unitLabel(p.unit_name)}`)),
            h('div', { class: 'row__end' }, h('span', { class: `amount${p.voided_at ? ' strike muted' : ''}` }, peso(p.amount_paid)), p.voided_at && badge('voided', 'Voided'))))))
            : emptyState({ title: 'No payments recorded', text: 'Recorded payments will appear here.' })),
        charges.length > 0 && h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Monthly rent charges')),
          h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
            h('thead', null, h('tr', null, h('th', null, 'Due'), h('th', { class: 'num' }, 'Rent'), h('th', { class: 'num' }, 'Paid'), h('th', { class: 'num' }, 'Balance'), h('th', null, 'Status'))),
            h('tbody', null, chargeRows))),
          h('p', { class: 'muted small', style: { marginTop: '8px' } }, 'Payments are applied to the oldest unpaid month first.')))),
  );

  if (query.assign && canManage && !active) {
    history.replaceState(null, '', `#/tenants/${tenant.tenant_id}`);
    assignTenantModal({ tenant, onSaved: rerender });
  }
}
