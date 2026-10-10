// Screen 8 — Maintenance.

import { get, post, patch, qs, uploadFile } from '../api.js';
import {
  h, icon, peso, fmtDate, fmtDateTime, badge, label, options, field, formModal, emptyState, searchBox, pageHead, toast,
  todayManila, filesList, openModal,
} from '../ui.js';
import { state, navigate } from '../app.js';

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['open', 'in_progress', 'resolved', 'cancelled'];

export async function newMaintenanceModal({ onSaved, propertyId, unitId } = {}) {
  let properties; let units;
  try { [{ properties }, { units }] = await Promise.all([get('/properties'), get('/units')]); } catch (err) { toast(err.message, 'error'); return; }
  if (!properties.length) {
    openModal({ title: 'No properties', body: h('div', { class: 'form' }, h('p', null, 'Add a property first, then log repair requests against it.'), h('a', { class: 'btn btn--primary', href: '#/properties' }, 'Go to Properties')) });
    return;
  }
  const unitField = field({ name: 'unit_id', label: 'Unit (optional)', type: 'select', placeholderOption: 'Common area / whole property', options: [] });
  const fillUnits = (pid) => unitField.querySelector('select').replaceChildren(h('option', { value: '' }, 'Common area / whole property'),
    units.filter((u) => u.property_id === pid).map((u) => h('option', { value: u.unit_id, selected: u.unit_id === unitId }, `Unit ${u.unit_name}`)));
  const propField = field({ name: 'property_id', label: 'Property', type: 'select', required: true, value: propertyId || (properties.length === 1 ? properties[0].property_id : ''), options: properties.map((p) => [p.property_id, p.property_name]) });
  propField.querySelector('select').addEventListener('change', (e) => fillUnits(e.target.value));
  fillUnits(propField.querySelector('select').value);

  formModal({
    title: 'New maintenance request',
    submitText: 'Save Request',
    draftKey: 'maintenance-new',
    fields: [
      propField, unitField,
      field({ name: 'title', label: 'Issue', required: true, placeholder: 'e.g. Leaking faucet in kitchen', maxlength: 150 }),
      field({ name: 'description', label: 'Details', type: 'textarea', maxlength: 2000 }),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'priority', label: 'Priority', type: 'select', required: true, value: 'medium', placeholderOption: false, options: options(PRIORITIES) }),
        field({ name: 'estimated_cost', label: 'Estimated cost', type: 'money' })),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'reported_by', label: 'Reported by', placeholder: 'Tenant name or staff', maxlength: 120 }),
        field({ name: 'assigned_to', label: 'Assigned to', placeholder: 'e.g. Mang Tony (plumber)', maxlength: 120 })),
    ],
    onSubmit: async (data) => {
      const res = await post('/maintenance', data);
      toast('Request saved.');
      if (onSaved) onSaved(res.request); else navigate(`#/maintenance/${res.request.request_id}`);
    },
  });
}

export async function maintenanceView(el, { query }) {
  const filters = { status: query.status ?? 'active', q: query.q || '', property_id: query.property_id || '' };
  const listCard = h('div', { class: 'card' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const { properties } = await get('/properties');
  const propertySelect = h('select', { class: 'input', 'aria-label': 'Property', style: { maxWidth: '240px' } },
    h('option', { value: '' }, 'All properties'),
    properties.map((p) => h('option', { value: p.property_id, selected: p.property_id === filters.property_id }, p.property_name)));
  propertySelect.addEventListener('change', () => { filters.property_id = propertySelect.value; load(); });

  async function load() {
    history.replaceState(null, '', `#/maintenance${qs(filters)}`);
    tabs.replaceChildren(...[['active', 'Open & in progress'], ['open', 'Open'], ['in_progress', 'In progress'], ['resolved', 'Resolved'], ['', 'All']].map(([s, t]) =>
      h('button', { role: 'tab', 'aria-selected': String(filters.status === s), onclick: () => { filters.status = s; load(); } }, t)));
    const { requests } = await get(`/maintenance${qs(filters)}`);
    listCard.replaceChildren(requests.length
      ? h('ul', { class: 'list' }, requests.map((m) => h('li', null, h('a', { class: 'row', href: `#/maintenance/${m.request_id}` },
        h('div', { class: 'row__main' },
          h('span', { class: 'row__title' }, m.title),
          h('span', { class: 'row__sub' }, `${m.property_name}${m.unit_name ? ` · Unit ${m.unit_name}` : ''} · reported ${fmtDate(m.created_at.slice(0, 10))}`),
          (Number(m.actual_cost) > 0 || m.estimated_cost) && h('span', { class: 'row__sub' }, Number(m.actual_cost) > 0 ? `Cost ${peso(m.actual_cost)}` : `Est. ${peso(m.estimated_cost)}`)),
        h('div', { class: 'row__end' }, badge(m.status), badge(m.priority))))))
      : (filters.q || filters.property_id
        ? emptyState({ title: 'No results found', text: 'Try clearing your search or filters.', action: h('button', { class: 'btn btn--secondary', onclick: () => { filters.q = ''; filters.property_id = ''; propertySelect.value = ''; search.querySelector('input').value = ''; load(); } }, 'Clear filters') })
        : emptyState({ iconName: 'wrench', title: filters.status === 'active' ? 'No open repair requests' : 'No requests here', text: 'Log repairs as they’re reported so nothing gets lost in chat threads.', action: h('button', { class: 'btn btn--primary', onclick: () => newMaintenanceModal() }, icon('plus'), 'New Request') })));
  }
  const search = searchBox({ value: filters.q, placeholder: 'Search issue, property or unit', onSearch: (q) => { filters.q = q; load(); } });
  await load();
  el.replaceChildren(
    pageHead({ title: 'Maintenance', sub: 'Repair requests from report to resolution', actions: h('button', { class: 'btn btn--primary', onclick: () => newMaintenanceModal() }, icon('plus'), 'New Request') }),
    h('div', { class: 'toolbar' }, search, propertySelect),
    tabs, listCard);
}

export async function maintenanceDetailView(el, { params, rerender }) {
  const { request: m, costs, files } = await get(`/maintenance/${params.id}`);
  const canManage = state.user.role !== 'staff';
  const closed = ['resolved', 'cancelled'].includes(m.status);

  const statusButtons = canManage && STATUSES.filter((s) => s !== m.status).map((s) => h('button', {
    class: `btn btn--sm ${s === 'resolved' ? 'btn--primary' : 'btn--secondary'}`,
    onclick: async (e) => {
      e.target.disabled = true;
      try { await patch(`/maintenance/${m.request_id}`, { status: s }); toast(`Marked ${label(s).toLowerCase()}.`); rerender(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
    },
  }, s === 'resolved' ? 'Mark resolved' : s === 'in_progress' ? 'Start work' : s === 'open' ? 'Reopen' : 'Cancel request'));

  const edit = () => formModal({
    title: 'Edit request', submitText: 'Save changes',
    fields: [
      field({ name: 'title', label: 'Issue', required: true, value: m.title, maxlength: 150 }),
      field({ name: 'description', label: 'Details', type: 'textarea', value: m.description, maxlength: 2000 }),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'priority', label: 'Priority', type: 'select', value: m.priority, placeholderOption: false, options: options(PRIORITIES) }),
        field({ name: 'estimated_cost', label: 'Estimated cost', type: 'money', value: m.estimated_cost })),
      field({ name: 'assigned_to', label: 'Assigned to', value: m.assigned_to, maxlength: 120 }),
    ],
    onSubmit: async (data) => { await patch(`/maintenance/${m.request_id}`, data); toast('Request updated.'); rerender(); },
  });

  const addCost = () => formModal({
    title: 'Add repair cost', submitText: 'Save Cost', idempotent: true,
    fields: [
      h('p', { class: 'muted small' }, 'This is saved as a Repairs expense for the property, so it appears in your reports.'),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'amount', label: 'Amount', type: 'money', required: true }),
        field({ name: 'expense_date', label: 'Date paid', type: 'date', required: true, value: todayManila(), max: todayManila() })),
      field({ name: 'vendor_name', label: 'Paid to', value: m.assigned_to, maxlength: 120 }),
      field({ name: 'description', label: 'Description', placeholder: `Repair: ${m.title}`, maxlength: 300 }),
    ],
    onSubmit: async (data, { idempotencyKey }) => { await post(`/maintenance/${m.request_id}/costs`, data, { idempotencyKey }); toast('Cost recorded.'); rerender(); },
  });

  const upload = h('input', { type: 'file', class: 'input', accept: 'image/jpeg,image/png,image/webp,application/pdf' });

  el.replaceChildren(
    pageHead({
      title: m.title,
      sub: `${m.property_name}${m.unit_name ? ` · Unit ${m.unit_name}` : ''}`,
      back: { href: '#/maintenance', label: 'Maintenance' },
      actions: [canManage && h('button', { class: 'btn btn--secondary', onclick: edit }, 'Edit'), h('button', { class: 'btn btn--primary', onclick: addCost }, icon('plus'), 'Add Cost')],
    }),
    h('div', { class: 'grid grid--2' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Status'), h('div', { class: 'chips' }, badge(m.status), badge(m.priority))),
          h('dl', { class: 'dl' },
            h('dt', null, 'Reported'), h('dd', null, `${fmtDateTime(m.created_at)}${m.reported_by ? ` by ${m.reported_by}` : ''}`),
            h('dt', null, 'Assigned to'), h('dd', null, m.assigned_to || '—'),
            h('dt', null, 'Estimated cost'), h('dd', null, m.estimated_cost ? peso(m.estimated_cost) : '—'),
            h('dt', null, 'Actual cost'), h('dd', null, peso(m.actual_cost)),
            m.resolved_at && [h('dt', null, 'Resolved'), h('dd', null, fmtDateTime(m.resolved_at))],
            m.description && [h('dt', null, 'Details'), h('dd', { style: { whiteSpace: 'pre-wrap' } }, m.description)]),
          statusButtons && h('div', { class: 'chips', style: { marginTop: '14px' } }, statusButtons),
          !canManage && h('p', { class: 'muted small', style: { marginTop: '10px' } }, 'Only owners and property managers can change the status.'))),
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Costs')),
          costs.length ? h('ul', { class: 'list' }, costs.map((c) => h('li', null, h('a', { class: 'row', href: `#/expenses/${c.expense_id}` },
            h('div', { class: 'row__main' }, h('span', { class: `row__title${c.voided_at ? ' strike' : ''}` }, c.description || 'Repair cost'), h('span', { class: 'row__sub' }, `${fmtDate(c.expense_date)}${c.vendor_name ? ` · ${c.vendor_name}` : ''}`)),
            h('div', { class: 'row__end' }, h('span', { class: `amount${c.voided_at ? ' strike muted' : ''}` }, peso(c.amount)))))))
            : h('p', { class: 'muted' }, closed ? 'No costs were recorded.' : 'No costs yet. Add a cost when you pay for the repair.')),
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Photos & documents')),
          filesList(files),
          h('div', { class: 'form', style: { marginTop: '12px' } }, upload,
            h('button', {
              class: 'btn btn--secondary', onclick: async (e) => {
                if (!upload.files[0]) { toast('Choose a photo or file first.', 'error'); return; }
                e.target.disabled = true;
                try { await uploadFile('maintenance', m.request_id, upload.files[0]); toast('Uploaded.'); rerender(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
              },
            }, 'Upload photo'))))),
  );
}
