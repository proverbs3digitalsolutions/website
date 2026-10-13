// Housekeeping: cleaning tasks for departing stays, checklist, photos, assignment.

import { get, post, patch, api, uploadFile, qs } from '../api.js';
import {
  h, icon, fmtDate, fmtDateTime, badge, field, formModal, confirmDialog, emptyState, toast, todayManila, filesList, openModal,
} from '../ui.js';
import { state } from '../app.js';
import { initFilters, filterBar, rememberFilters, changed } from '../filters.js';
import { addDays } from './reservations.js';

const STATUS = { todo: ['unpaid', 'To do'], in_progress: ['partial', 'In progress'], done: ['paid', 'Done'], cancelled: ['voided', 'Cancelled'] };
const statusBadge = (s) => badge(...STATUS[s]);

function dueText(t) {
  const today = todayManila();
  if (t.status === 'done') return `Done ${fmtDateTime(t.completed_at)}`;
  if (t.due_date < today) return `Overdue · was due ${fmtDate(t.due_date)}`;
  if (t.due_date === today) return 'Today';
  if (t.due_date === addDays(today, 1)) return 'Tomorrow';
  return fmtDate(t.due_date);
}

function nextGuestText(t) {
  if (!t.next_check_in) return 'No next guest booked yet';
  if (t.next_check_in === t.due_date) return 'Same-day turnover: next guest arrives the same day';
  return `Next guest arrives ${fmtDate(t.next_check_in)}`;
}

const assigneeText = (t) => t.assigned_user_name || t.assignee_name || 'Unassigned';

// Plain-text version to paste into Messenger / Viber for a cleaner without a login.
function taskText(t) {
  return [
    `Cleaning: ${t.unit_name}, ${t.property_name}`,
    `When: ${dueText(t)}`,
    nextGuestText(t),
    t.notes ? `Notes: ${t.notes}` : null,
    '',
    ...t.checklist.map((c) => `${c.done ? '✅' : '⬜'} ${c.text}`),
  ].filter((x) => x !== null).join('\n');
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied. Paste it in Messenger or Viber.'); } catch {
    openModal({ title: 'Copy this text', body: h('textarea', { class: 'input', rows: 12, readonly: true, value: text }) });
  }
}

// Only members who can open a task at this property: owners, plus managers and
// staff assigned to it (property_ids is null for owners).
const eligibleFor = (assignees, propertyId) => assignees.filter((a) => !a.property_ids || (propertyId && a.property_ids.includes(propertyId)));

async function assignModal(t, onSaved) {
  const assignees = eligibleFor((await get('/cleaning-assignees')).assignees, t.property_id);
  formModal({
    title: 'Assign cleaning',
    submitText: 'Save',
    fields: [
      field({ name: 'assigned_to', label: 'Team member', type: 'select', value: t?.assigned_to, placeholderOption: 'Not a team member',
        options: assignees.map((a) => [a.user_id, `${a.full_name}${a.role === 'staff' ? '' : ` (${a.role})`}`]) }),
      field({ name: 'assignee_name', label: 'Or a cleaner without a BalayHub login', value: t?.assignee_name, maxlength: 80, placeholder: 'e.g. Aling Rosa',
        hint: 'Use "Copy for cleaner" to send them the task by Messenger or Viber.' }),
    ],
    onSubmit: async (d) => {
      await patch(`/cleaning-tasks/${t.task_id}`, { assigned_to: d.assigned_to || null, assignee_name: d.assigned_to ? null : (d.assignee_name || null) });
      toast('Assignment saved.');
      onSaved();
    },
  });
}

async function newTaskModal(onSaved) {
  const { listings } = await get('/listings');
  const { assignees } = await get('/cleaning-assignees');
  const unitField = field({ name: 'unit_id', label: 'Listing', type: 'select', required: true, options: listings.map((l) => [l.unit_id, `${l.unit_name} — ${l.property_name}`]) });
  const memberField = field({ name: 'assigned_to', label: 'Team member', type: 'select', placeholderOption: 'Not a team member', options: [],
    hint: 'Only people who can see this listing are shown.' });
  const unitSelect = unitField.querySelector('select');
  const memberSelect = memberField.querySelector('select');
  const fillMembers = () => {
    const propertyId = listings.find((l) => l.unit_id === unitSelect.value)?.property_id;
    const keep = memberSelect.value;
    const eligible = eligibleFor(assignees, propertyId);
    memberSelect.replaceChildren(h('option', { value: '' }, 'Not a team member'),
      ...eligible.map((a) => h('option', { value: a.user_id, selected: a.user_id === keep }, a.full_name)));
  };
  unitSelect.addEventListener('change', fillMembers);
  fillMembers();
  formModal({
    title: 'Add cleaning task',
    submitText: 'Add task',
    fields: [
      unitField,
      field({ name: 'due_date', label: 'Date', type: 'date', required: true, value: todayManila() }),
      memberField,
      field({ name: 'assignee_name', label: 'Or a cleaner without a login', maxlength: 80 }),
      field({ name: 'notes', label: 'Notes', type: 'textarea', maxlength: 1000, placeholder: 'e.g. Deep clean, change curtains' }),
    ],
    onSubmit: async (d) => { await post('/cleaning-tasks', d); toast('Cleaning task added.'); onSaved(); },
  });
}

async function checklistModal() {
  const { items } = await get('/cleaning-checklist');
  formModal({
    title: 'Default cleaning checklist',
    submitText: 'Save checklist',
    fields: [
      field({ name: 'items', label: 'One item per line', type: 'textarea', value: items.join('\n'), maxlength: 5000 }),
      h('p', { class: 'hint' }, 'Used for new cleaning tasks. Tasks already created keep their checklist.'),
    ],
    onSubmit: async (d) => {
      await api('PUT', '/cleaning-checklist', { items: d.items.split('\n').map((x) => x.trim()).filter(Boolean) });
      toast('Checklist saved.');
    },
  });
}

// ---------------------------------------------------------------- list
const TABS = [['today', 'Today & overdue'], ['upcoming', 'Upcoming'], ['done', 'Done'], ['all', 'All']];

export async function housekeepingView(el, { query }) {
  const isManager = state.user.role !== 'staff';
  const defaults = { view: 'today', q: '', mine: '', status: '', property_id: '', unit_id: '', assignee: '', from: '', to: '', late: '', turnover: '', sort: '' };
  const filters = initFilters('housekeeping', query, defaults);
  if (!TABS.some(([v]) => v === filters.view)) filters.view = 'today';
  const [{ properties }, { listings }, { assignees }] = await Promise.all([
    get('/properties'), get('/listings'), isManager ? get('/cleaning-assignees') : { assignees: [] },
  ]);
  const tabs = h('div', { class: 'tabs tabs--compact', role: 'tablist' });
  const box = h('div');

  async function load() {
    const active = changed(filters, { ...defaults, view: '' });
    history.replaceState(null, '', `#/housekeeping${qs(active)}`);
    const { tasks, counts } = await get(`/cleaning-tasks${qs(active)}`);
    const count = { today: counts.today, upcoming: counts.upcoming };
    tabs.replaceChildren(...TABS.map(([k, t]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(k === filters.view),
      onclick: () => { filters.view = k; rememberFilters('housekeeping', filters); load(); },
    }, count[k] !== undefined ? `${t} (${count[k]})` : t)));
    const filtered = Object.keys(changed(filters, defaults)).some((k) => k !== 'view' && k !== 'sort');
    const view = filters.view;
    box.replaceChildren(tasks.length
      ? h('div', { class: 'hk-grid' }, tasks.map((t) => h('a', { class: `card hk-card${['todo', 'in_progress'].includes(t.status) && t.due_date < todayManila() ? ' hk-card--late' : ''}`, href: `#/housekeeping/${t.task_id}` },
        h('div', { class: 'hk-card__top' },
          h('div', null, h('strong', null, t.unit_name), h('div', { class: 'small muted' }, t.property_name)),
          statusBadge(t.status)),
        h('div', { class: 'hk-card__due' }, dueText(t)),
        ['todo', 'in_progress'].includes(t.status) && h('div', { class: `small${t.next_check_in === t.due_date ? ' amount--neg' : ' muted'}` }, nextGuestText(t)),
        h('div', { class: 'bar' }, h('span', { style: { width: `${t.item_count ? Math.round((100 * t.done_count) / t.item_count) : 0}%` } })),
        h('div', { class: 'small muted' }, `${t.done_count} of ${t.item_count} done · ${assigneeText(t)}`))))
      : h('div', { class: 'card' }, emptyState(filtered ? { title: 'No results found', text: 'Try removing a filter.', iconName: 'home' } : {
        title: view === 'done' ? 'No finished cleanings yet' : 'Nothing to clean ✨',
        text: view === 'today' ? 'Cleaning tasks appear automatically for today\'s and tomorrow\'s check-outs.' : null,
        iconName: 'home',
      })));
  }

  const bar = filterBar({
    key: 'housekeeping', values: filters, defaults, onChange: load,
    extra: tabs,
    search: { placeholder: 'Search listing, cleaner or notes' },
    quick: [
      { name: 'mine', label: 'Only my tasks', type: 'check' },
      properties.length > 1 && { name: 'property_id', label: 'Property', all: 'All properties', options: properties.map((p) => [p.property_id, p.property_name]) },
    ].filter(Boolean),
    more: [
      { name: 'unit_id', label: 'Listing', all: 'All listings', options: listings.map((l) => [l.unit_id, `${l.unit_name}${properties.length > 1 ? ` · ${l.property_name}` : ''}`]) },
      { name: 'status', label: 'Status', all: 'Any status', options: Object.entries(STATUS).map(([k, [, t]]) => [k, t]) },
      isManager && { name: 'assignee', label: 'Assigned to', all: 'Anyone', options: [['unassigned', 'Not assigned yet'], ['outside', 'Cleaner without a login'], ...assignees.map((a) => [a.user_id, a.full_name])] },
      { name: 'due', keys: ['from', 'to'], label: 'Due between', type: 'daterange' },
      { name: 'turnover', label: 'Next guest', all: 'Any', options: [['same_day', 'Same-day turnover'], ['next_booked', 'Next guest booked'], ['no_next', 'No next guest yet']] },
      { name: 'late', label: 'Overdue only', type: 'check' },
      { name: 'sort', label: 'Sort by', all: 'Default for this tab', options: [['due', 'Due date (soonest first)'], ['due_desc', 'Due date (latest first)'], ['listing', 'Listing'], ['next_guest', 'Next guest arrival'], ['completed', 'Recently finished']] },
    ].filter(Boolean),
  });
  await load();

  el.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' }, h('h1', null, 'Housekeeping'), h('p', null, 'Cleaning after each check-out')),
      isManager && h('div', { class: 'page-head__actions' },
        state.user.role === 'owner' && h('button', { class: 'btn btn--secondary', onclick: checklistModal }, 'Edit checklist'),
        h('button', { class: 'btn btn--primary', onclick: () => newTaskModal(load) }, icon('plus'), 'Add task'))),
    bar,
    box);
}

// ---------------------------------------------------------------- detail
export async function housekeepingDetailView(el, { params, rerender }) {
  const { task: t, files } = await get(`/cleaning-tasks/${params.id}`);
  const isManager = state.user.role !== 'staff';
  const open = ['todo', 'in_progress'].includes(t.status);

  const setStatus = async (status, msg) => {
    try { await post(`/cleaning-tasks/${t.task_id}/status`, { status }); toast(msg); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  const finish = async () => {
    const left = t.item_count - t.done_count;
    if (left > 0 && !await confirmDialog({ title: 'Mark as done?', text: `${left} checklist item${left > 1 ? 's are' : ' is'} not ticked yet.`, confirmText: 'Mark done anyway' })) return;
    setStatus('done', 'Cleaning done. Listing marked clean.');
  };

  const items = h('ul', { class: 'hk-checklist' }, t.checklist.map((c, i) => h('li', null,
    h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', checked: c.done, disabled: !open,
        onchange: async (e) => {
          const box = e.target;
          box.disabled = true;
          try {
            const r = await post(`/cleaning-tasks/${t.task_id}/checklist`, { index: i, done: box.checked });
            progress.textContent = `${r.task.done_count} of ${r.task.item_count} done`;
            if (t.status === 'todo') { t.status = 'in_progress'; statusSlot.replaceChildren(statusBadge('in_progress')); startBtn?.remove(); }
          } catch (err) { box.checked = !box.checked; toast(err.message, 'error'); } finally { box.disabled = false; }
        },
      }),
      h('span', null, c.text)))));
  const progress = h('span', { class: 'muted small' }, `${t.done_count} of ${t.item_count} done`);
  const statusSlot = h('span', null, statusBadge(t.status));
  const startBtn = t.status === 'todo' ? h('button', { class: 'btn btn--secondary', onclick: () => setStatus('in_progress', 'Started.') }, 'Start') : null;
  const upload = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'input', capture: 'environment' });

  el.replaceChildren(
    h('a', { class: 'back', href: '#/housekeeping' }, '‹ Housekeeping'),
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' }, h('h1', null, `Clean ${t.unit_name}`), h('p', null, `${t.property_name} · ${dueText(t)}`)),
      h('div', { class: 'page-head__actions' },
        startBtn,
        open && h('button', { class: 'btn btn--primary', onclick: finish }, 'Mark done'),
        t.status === 'done' && h('button', { class: 'btn btn--secondary', onclick: () => setStatus('in_progress', 'Reopened.') }, 'Reopen'),
        isManager && h('button', { class: 'btn btn--secondary', onclick: () => copyText(taskText(t)) }, 'Copy for cleaner'),
        isManager && open && h('button', { class: 'btn btn--ghost', onclick: async () => {
          if (await confirmDialog({ title: 'Cancel this cleaning task?', text: 'Use this if the cleaning is no longer needed.', confirmText: 'Cancel task', danger: true })) setStatus('cancelled', 'Task cancelled.');
        } }, 'Cancel task'))),
    h('div', { class: 'grid grid--2' },
      h('div', { class: 'card' },
        h('div', { class: 'card__head' }, h('h2', null, 'Checklist'), progress),
        t.checklist.length ? items : h('p', { class: 'muted small' }, 'No checklist items.')),
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Details'), statusSlot),
          h('dl', { class: 'dl' },
            h('dt', null, 'Assigned to'), h('dd', null, assigneeText(t),
              isManager && h('div', null, h('button', { class: 'linkbtn', onclick: () => assignModal(t, rerender) }, 'Change'))),
            h('dt', null, 'Due'), h('dd', null, fmtDate(t.due_date)),
            h('dt', null, 'Next guest'), h('dd', null, nextGuestText(t)),
            t.departing_guest && [h('dt', null, 'After stay of'), h('dd', null, t.departing_guest)],
            t.notes && [h('dt', null, 'Notes'), h('dd', { style: { whiteSpace: 'pre-wrap' } }, t.notes)],
            t.completed_at && [h('dt', null, 'Finished'), h('dd', null, `${fmtDateTime(t.completed_at)}${t.completed_by_name ? ` by ${t.completed_by_name}` : ''}`)]),
          t.booking_id && isManager && h('p', { class: 'small', style: { marginTop: '10px' } }, h('a', { href: `#/reservations/${t.booking_id}` }, 'Open the reservation'))),
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Photos')),
          h('p', { class: 'muted small' }, 'Add photos of the finished unit or any damage found.'),
          filesList(files),
          h('div', { class: 'form', style: { marginTop: '12px' } }, upload,
            h('button', {
              class: 'btn btn--secondary', onclick: async (e) => {
                if (!upload.files[0]) { toast('Choose a photo first.', 'error'); return; }
                e.target.disabled = true;
                try { await uploadFile('cleaning', t.task_id, upload.files[0]); toast('Photo uploaded.'); rerender(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
              },
            }, 'Upload photo'))))));
}
