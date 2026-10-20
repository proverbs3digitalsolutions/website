// Screen 8 — Maintenance.

import { get, post, patch, qs, uploadFile } from '../api.js';
import {
  h, icon, peso, fmtDate, fmtDateTime, manilaDay, badge, label, options, field, formModal, emptyState, pageHead, toast,
  todayManila, filesList, openModal, unitLabel, confirmDialog, showErrors, parseAmount, uploadField, fileRefused } from '../ui.js';
import { state, navigate } from '../app.js';
import { expenseNeedsAsk } from './rent.js';
import { initFilters, filterBar, rememberFilters, changed, apiFilters } from '../filters.js';

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['open', 'in_progress', 'resolved', 'cancelled'];
// The status buttons a request offers. A resolved or cancelled request can only be reopened.
export const nextStatuses = (status) => ({ resolved: ['open'], cancelled: ['open'] })[status] || STATUSES.filter((s) => s !== status);

// Filter values a link may carry. Any other value is dropped before the list shows, so no chip shows for it (D-77).
const FILTER_CHOICES = {
  priority: ['high_up', ...PRIORITIES],
  sort: ['newest', 'oldest', 'priority', 'cost', 'property'],
  cost: ['recorded', 'none', 'estimate_only'],
};

// The next-due window the server accepts: a year back to five years ahead, counted from today in Manila.
// Like Postgres, a day that does not exist in the target year is kept to the month's last day.
export function nextDueWindow(today = todayManila()) {
  const [y, m, d] = today.split('-').map(Number);
  const on = (year) => {
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
    return `${year}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  };
  return { earliest: on(y - 1), latest: on(y + 5) };
}

// "From cleaning task" badge. Inside a list row (already a link) it is plain text, so the row has one tab stop; the request page links to the job.
const taskBadge = (m, inRow) => inRow
  ? h('span', { class: 'badge badge--ops' }, 'From cleaning task')
  : h('a', {
    class: 'badge badge--ops link-tap', href: `#/housekeeping/${m.cleaning_task_id}`,
    'aria-label': `From cleaning task, ${m.unit_name ? unitLabel(m.unit_name) : m.property_name}`,
  }, 'From cleaning task');

export async function newMaintenanceModal({ onSaved, propertyId, unitId } = {}) {
  let properties; let units;
  try { [{ properties }, { units }] = await Promise.all([get('/properties'), get('/units')]); } catch (err) { toast(err.message, 'error'); return; }
  if (!properties.length) {
    openModal({ title: 'No properties', body: h('div', { class: 'form' }, h('p', null, 'Add a property first, then log repair requests against it.'), h('a', { class: 'btn btn--primary', href: '#/properties' }, 'Go to Properties')) });
    return;
  }
  const unitField = field({ name: 'unit_id', label: 'Unit (optional)', type: 'select', placeholderOption: 'Common area / whole property', options: [] });
  const fillUnits = (pid) => unitField.querySelector('select').replaceChildren(h('option', { value: '' }, 'Common area / whole property'),
    units.filter((u) => u.property_id === pid).map((u) => h('option', { value: u.unit_id, selected: u.unit_id === unitId }, unitLabel(u.unit_name))));
  const propField = field({ name: 'property_id', label: 'Property', type: 'select', required: true, value: propertyId || (properties.length === 1 ? properties[0].property_id : ''), options: properties.map((p) => [p.property_id, p.property_name]) });
  propField.querySelector('select').addEventListener('change', (e) => fillUnits(e.target.value));
  fillUnits(propField.querySelector('select').value);

  formModal({
    title: 'New maintenance request',
    submitText: 'Save request',
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
  const defaults = { status: 'active', q: '', priority: '', property_id: '', unit_id: '', assigned: '', from: '', to: '', cost: '', sort: '' };
  const filters = initFilters('maintenance', query, defaults);
  if (!['active', 'open', 'in_progress', 'resolved', 'cancelled', 'all'].includes(filters.status)) filters.status = 'active';
  for (const [key, choices] of Object.entries(FILTER_CHOICES)) if (!choices.includes(filters[key])) filters[key] = defaults[key];
  const listCard = h('div', { class: 'card' });
  const schedulesBox = h('div');
  const canSchedule = state.user.role !== 'staff';
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const barBox = h('div');
  const [{ properties }, { units }] = await Promise.all([get('/properties'), get('/units')]);
  let assignees = [];

  // "all" isn't a status the server knows, so it lists every request.
  // A status chip narrows the empty list too, except Open & in progress and All, whose own empty text already fits.
  const isFiltered = () => Object.keys(changed(filters, defaults)).some((k) => k !== 'status' && k !== 'sort');
  async function load() {
    history.replaceState(null, '', `#/maintenance${qs(changed(filters, defaults))}`);
    tabs.replaceChildren(...[['active', 'Open & in progress'], ['open', 'Open'], ['in_progress', 'In progress'], ['resolved', 'Resolved'], ['cancelled', 'Cancelled'], ['all', 'All']].map(([s, t]) =>
      h('button', { role: 'tab', 'aria-selected': String(filters.status === s), onclick: () => { filters.status = s; rememberFilters('maintenance', filters); load(); } }, t)));
    // The status is always sent: the default "active" is dropped from the address but the server lists every status without it.
    const res = await get(`/maintenance${qs(apiFilters(filters))}`);
    // A name no request is assigned to (typed into a link) is dropped, and the list loads again without it.
    if (filters.assigned && filters.assigned !== 'none' && !res.assignees.includes(filters.assigned)) {
      filters.assigned = defaults.assigned; rememberFilters('maintenance', filters); renderBar(); return load();
    }
    const { requests } = res;
    // Rebuild the bar the first time new "Assigned to" names appear.
    if (res.assignees.join('|') !== assignees.join('|')) { assignees = res.assignees; renderBar(); }
    const spent = requests.reduce((sum, m) => sum + Number(m.actual_cost), 0);
    listCard.replaceChildren(requests.length
      ? [isFiltered() && h('p', { class: 'muted small' }, `Showing ${requests.length} request${requests.length === 1 ? '' : 's'}${spent > 0 ? ` · ${peso(spent)} spent` : ''}`),
        h('ul', { class: 'list' }, requests.map((m) => h('li', null, h('a', { class: 'row', href: `#/maintenance/${m.request_id}` },
          h('div', { class: 'row__main' },
            h('span', { class: 'row__title' }, m.title),
            h('span', { class: 'row__sub' }, `${m.property_name}${m.unit_name ? ` · ${unitLabel(m.unit_name)}` : ''} · reported ${fmtDate(manilaDay(m.created_at))}${m.assigned_to ? ` · ${m.assigned_to}` : ''}`),
            (Number(m.actual_cost) > 0 || m.estimated_cost) && h('span', { class: 'row__sub' }, Number(m.actual_cost) > 0 ? `Cost ${peso(m.actual_cost)}` : `Est. ${peso(m.estimated_cost)}`)),
          h('div', { class: 'row__end' }, badge(m.status), badge(m.priority), m.cleaning_task_id && taskBadge(m, true))))))]
      : (!isFiltered() && ['resolved', 'cancelled'].includes(filters.status)
        ? emptyState({ title: `No ${filters.status} requests.`, text: 'Requests you mark this way will show up here.' })
        : ((isFiltered() || !['active', 'all'].includes(filters.status))
        ? emptyState({ title: 'No results found', text: 'Nothing matches these filters. Try removing a filter.', action: h('button', { class: 'btn btn--secondary', onclick: () => { Object.assign(filters, defaults); rememberFilters('maintenance', filters); renderBar(); load(); } }, 'Clear filters') })
        : emptyState({ iconName: 'wrench', title: filters.status === 'active' ? 'No open repair requests' : 'No requests here', text: 'Log repairs as they’re reported so nothing gets lost in chat threads.', action: h('button', { class: 'btn btn--primary', onclick: () => newMaintenanceModal() }, icon('plus'), 'New request') }))));
  }

  function renderBar() {
    let lastProperty = filters.property_id;
    barBox.replaceChildren(filterBar({
      key: 'maintenance', values: filters, defaults,
      onChange: () => {
        // A new property changes the unit choices; drop a unit from another property.
        if (filters.property_id !== lastProperty) {
          if (filters.unit_id && filters.unit_id !== 'none' && !units.some((u) => u.unit_id === filters.unit_id && (!filters.property_id || u.property_id === filters.property_id))) filters.unit_id = '';
          rememberFilters('maintenance', filters);
          renderBar();
        }
        load().catch((e) => toast(e.message, 'error'));
      },
      search: { placeholder: 'Issue, unit, person', label: 'Search issue, unit, reported by or assigned to' },
      quick: [
        { name: 'priority', label: 'Priority', all: 'Any priority', options: [['high_up', 'High and urgent'], ...PRIORITIES.slice().reverse().map((p) => [p, label(p)])] },
        properties.length > 1 && { name: 'property_id', label: 'Property', all: 'All properties', options: properties.map((p) => [p.property_id, p.property_name]) },
      ].filter(Boolean),
      more: [
        { name: 'unit_id', label: 'Unit', all: 'All units', options: [['none', 'Common area / whole property'], ...units.filter((u) => !filters.property_id || u.property_id === filters.property_id).map((u) => [u.unit_id, `${unitLabel(u.unit_name)}${properties.length > 1 && !filters.property_id ? ` · ${u.property_name}` : ''}`])] },
        { name: 'assigned', label: 'Assigned to', all: 'Anyone', options: [['none', 'Not assigned yet'], ...assignees.map((a) => [a, a])], keepUnknown: true },
        { name: 'from', label: 'Reported between', type: 'daterange', keys: ['from', 'to'] },
        { name: 'cost', label: 'Cost', all: 'Any', options: [['recorded', 'Has recorded cost'], ['none', 'No cost recorded'], ['estimate_only', 'Estimate only']] },
        { name: 'sort', label: 'Sort by', all: 'Open first, most urgent', options: [['newest', 'Newest reported'], ['oldest', 'Oldest reported'], ['priority', 'Priority'], ['cost', 'Highest cost'], ['property', 'Property and unit']] },
      ],
    }));
  }
  const EVERY = (x) => `Every ${x.every_n} ${x.every_unit === 'months' ? (Number(x.every_n) === 1 ? 'month' : 'months') : (Number(x.every_n) === 1 ? 'day' : 'days')}`;
  async function loadSchedules() {
    if (!canSchedule) return;
    let schedules;
    try { ({ schedules } = await get('/maintenance-schedules')); } catch { schedulesBox.replaceChildren(); return; }
    const form = (x) => {
      const propField = !x && field({ name: 'property_id', label: 'Property', type: 'select', required: true, value: properties.length === 1 ? properties[0].property_id : '', options: properties.map((p) => [p.property_id, p.property_name]) });
      const unitField = !x && field({ name: 'unit_id', label: 'Unit (optional)', type: 'select', placeholderOption: 'Whole property', options: [] });
      // The Unit list follows the Property choice, as New request does, so a unit from another property drops out.
      if (!x) {
        const fillUnits = (pid) => unitField.querySelector('select').replaceChildren(h('option', { value: '' }, 'Whole property'),
          units.filter((u) => u.property_id === pid).map((u) => h('option', { value: u.unit_id }, unitLabel(u.unit_name))));
        propField.querySelector('select').addEventListener('change', (e) => fillUnits(e.target.value));
        fillUnits(propField.querySelector('select').value);
      }
      return formModal({
        title: x ? 'Edit recurring job' : 'New recurring job', submitText: x ? 'Save changes' : 'Save schedule',
        fields: [
          propField,
          unitField,
          field({ name: 'title', label: 'Job', required: true, value: x?.title, placeholder: 'e.g. Clean the aircon', maxlength: 150 }),
          field({ name: 'description', label: 'Details', type: 'textarea', value: x?.description, maxlength: 2000 }),
          h('div', { class: 'form-row form-row--2' },
            field({ name: 'every_n', label: 'Repeat every', type: 'number', min: 1, max: 365, step: 1, required: true, value: x?.every_n ?? 3 }),
            field({ name: 'every_unit', label: 'Unit of time', type: 'select', required: true, value: x?.every_unit || 'months', placeholderOption: false, options: [['days', 'Days'], ['months', 'Months']] })),
          h('div', { class: 'form-row form-row--2' },
            field({ name: 'next_due', label: 'Next due', type: 'date', required: true, value: x?.next_due ? String(x.next_due).slice(0, 10) : todayManila() }),
            field({ name: 'priority', label: 'Priority', type: 'select', required: true, value: x?.priority || 'medium', placeholderOption: false, options: options(PRIORITIES) })),
        ],
        // Same window as the second check below, run in the form's one pass so it shows beside the other messages.
        check: (d) => {
          const { earliest, latest } = nextDueWindow();
          return d.next_due && (d.next_due < earliest || d.next_due > latest) ? { next_due: `Pick a date between ${fmtDate(earliest)} and ${fmtDate(latest)}.` } : null;
        },
        onSubmit: async (d, ctx) => {
          // The server refuses a next-due date outside its window, so say so at the field before any question (#30).
          const { earliest, latest } = nextDueWindow();
          if (d.next_due < earliest || d.next_due > latest) { showErrors(ctx.form, { next_due: `Pick a date between ${fmtDate(earliest)} and ${fmtDate(latest)}.` }); return false; }
          // The hourly check opens a request as soon as a job is due, so a date already past opens one at once. Ask first (Q9).
          if (d.next_due < todayManila() && !await confirmDialog({ title: 'Next due date is in the past', text: 'A request opens at the next hourly check. Save anyway?', confirmText: 'Save anyway' })) return false;
          const body = { title: d.title, description: d.description, every_n: Number(d.every_n), every_unit: d.every_unit, next_due: d.next_due, priority: d.priority };
          if (x) await patch(`/maintenance-schedules/${x.schedule_id}`, body); else await post('/maintenance-schedules', { ...body, property_id: d.property_id, unit_id: d.unit_id || undefined });
          toast(x ? 'Schedule updated.' : 'Schedule saved.'); loadSchedules();
        },
      });
    };
    const pause = async (x) => {
      try {
        if (x.active) { if (!await confirmDialog({ title: 'Pause this job?', text: 'No new repair requests are created until you resume it.', confirmText: 'Pause' })) return; await post(`/maintenance-schedules/${x.schedule_id}/pause`); toast('Paused.'); } else { await patch(`/maintenance-schedules/${x.schedule_id}`, { active: true }); toast('Resumed.'); }
        loadSchedules();
      } catch (err) { toast(err.message, 'error'); }
    };
    schedulesBox.replaceChildren(h('div', { class: 'card ops-card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Recurring maintenance'), h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => form(null) }, icon('plus'), 'Add recurring job')),
      h('p', { class: 'muted small' }, 'A repair request is created automatically when a job is due, for things like aircon cleaning or pest control.'),
      schedules.length ? h('ul', { class: 'list' }, schedules.map((x) => h('li', { class: `ops-sched${x.active ? '' : ' is-paused'}` },
        h('div', { class: 'ops-sched__main' },
          h('span', { class: 'row__title' }, x.title, !x.active && h('span', { class: 'badge badge--cancelled ops-sched__tag' }, 'Paused')),
          h('span', { class: 'row__sub' }, `${EVERY(x)} · ${x.property_name}${x.unit_name ? ` · ${unitLabel(x.unit_name)}` : ''}`),
          h('span', { class: 'row__sub' }, x.active ? `Next due ${fmtDate(String(x.next_due).slice(0, 10))}` : 'Not creating requests')),
        h('div', { class: 'ops-sched__actions' },
          badge(x.priority),
          h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'aria-label': `Edit ${x.title}`, onclick: () => form(x) }, 'Edit'),
          h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'data-focus-key': `mt-pause-${x.schedule_id}`, 'aria-label': `${x.active ? 'Pause' : 'Resume'} ${x.title}`, onclick: () => pause(x) }, x.active ? 'Pause' : 'Resume')))))
        : h('p', { class: 'muted' }, 'No recurring jobs yet.')));
  }
  renderBar();
  await load();
  el.replaceChildren(
    pageHead({ title: 'Maintenance', sub: 'Repair requests from report to resolution', actions: h('button', { class: 'btn btn--primary', onclick: () => newMaintenanceModal() }, icon('plus'), 'New request') }),
    tabs, barBox, listCard, schedulesBox);
  loadSchedules();
}

export async function maintenanceDetailView(el, { params, rerender }) {
  const { request: m, costs, files } = await get(`/maintenance/${params.id}`);
  const canManage = state.user.role !== 'staff';
  const closed = ['resolved', 'cancelled'].includes(m.status);

  let busy = false; // aria-busy + this flag, not disabled: a disabled focused button drops focus to BODY
  const statusButtons = canManage && nextStatuses(m.status).map((s) => h('button', {
    class: `btn btn--sm ${s === 'resolved' ? 'btn--primary' : 'btn--secondary'}`,
    'data-focus-key': `mt-status-${s}`,
    onclick: async (e) => {
      const btn = e.currentTarget; // currentTarget is null after the first await
      if (s === 'cancelled' && !await confirmDialog({ title: 'Cancel this request?', text: 'Recorded costs stay on the books.', confirmText: 'Cancel request', cancelText: 'Keep request' })) return;
      if (busy) return;
      busy = true; btn.setAttribute('aria-busy', 'true');
      try { await patch(`/maintenance/${m.request_id}`, { status: s }); toast(`Marked ${label(s).toLowerCase()}.`); rerender(); } catch (err) { toast(err.message, 'error'); busy = false; btn.removeAttribute('aria-busy'); }
    },
  }, s === 'resolved' ? 'Mark resolved' : s === 'in_progress' ? 'Start work' : s === 'open' ? (m.status === 'in_progress' ? 'Back to open' : 'Reopen') : 'Cancel request'));

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
    title: 'Add repair cost', submitText: 'Save cost', idempotent: true,
    fields: [
      h('p', { class: 'muted small' }, 'This is saved as a Repairs expense for the property, so it appears in your reports.'),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'amount', label: 'Amount', type: 'money', required: true, positive: true }),
        field({ name: 'expense_date', label: 'Date paid', type: 'date', required: true, value: todayManila(), max: todayManila() })),
      field({ name: 'vendor_name', label: 'Paid to', value: m.assigned_to, maxlength: 120 }),
      field({ name: 'description', label: 'Description', placeholder: `Repair: ${m.title}`, maxlength: 300 }),
    ],
    onSubmit: async (data, { idempotencyKey, form }) => {
      // A repair cost is saved as an expense, so it asks the expense question (D-109; the rule lives in rent.js).
      if (expenseNeedsAsk(data.amount) && !await confirmDialog({ title: 'Check the amount', text: `This expense is ${peso(parseAmount(data.amount))}. Save anyway?`, confirmText: 'Save anyway', cancelText: 'Change it' })) { form.elements.amount.focus(); return false; }
      await post(`/maintenance/${m.request_id}/costs`, data, { idempotencyKey }); toast('Cost recorded.'); rerender();
    },
  });

  const upload = h('input', { type: 'file', class: 'input', accept: 'image/jpeg,image/png,image/webp,application/pdf', 'aria-label': 'Upload photo or document',
    // Picking a file uploads it at once (no second step); the input is off while the upload runs.
    onchange: async () => {
      if (!upload.files[0]) return;
      up.clear();
      upload.disabled = true;
      try { await uploadFile('maintenance', m.request_id, upload.files[0]); upload.value = ''; toast('Uploaded.'); rerender(); } catch (err) {
        // Enabled before the line is shown, so focus can land on the box (D-113).
        upload.disabled = false; upload.value = '';
        if (fileRefused(err)) up.show(err.message); else toast(err.message, 'error');
      }
    },
  });
  const up = uploadField(upload);

  el.replaceChildren(
    pageHead({
      title: m.title,
      sub: `${m.property_name}${m.unit_name ? ` · ${unitLabel(m.unit_name)}` : ''}`,
      back: { href: '#/maintenance', label: 'Maintenance' },
      actions: [canManage && h('button', { class: 'btn btn--secondary', onclick: edit }, 'Edit'), h('button', { class: 'btn btn--primary', onclick: addCost }, icon('plus'), 'Add cost')],
    }),
    h('div', { class: 'grid grid--2' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Status'), h('div', { class: 'chips' }, badge(m.status), badge(m.priority), m.cleaning_task_id && taskBadge(m, false))),
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
          h('div', { class: 'form', style: { marginTop: '12px' } }, up.wrap)))),
  );
}
