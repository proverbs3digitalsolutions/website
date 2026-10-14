// Housekeeping: cleaning tasks for departing stays, checklist, photos, assignment.

import { get, post, patch, api, uploadFile, qs, ApiError } from '../api.js';
import {
  h, icon, manilaDay, fmtDate, fmtDateTime, badge, field, formModal, confirmDialog, emptyState, errorState, toast, todayManila, filesList, openModal, peso,
} from '../ui.js';
import { t, initGuestLang, extendTranslations, locale } from '../i18n.js';
import { state } from '../app.js';
import { initFilters, filterBar, rememberFilters, changed } from '../filters.js';
import { addDays } from './reservations.js';
import { qtyLabel } from './supplies.js';

// Cleaners see these screens in the workspace's guest language (English or Taglish).
extendTranslations({
  'Cleaning': 'Paglilinis', 'Tasks': 'Mga gawain', 'Board': 'Board', 'Calendar': 'Kalendaryo', 'Scores': 'Mga score',
  'Today & overdue': 'Ngayon at lampas na', 'Upcoming': 'Paparating', 'Done': 'Tapos na', 'All': 'Lahat',
  'To do': 'Gagawin pa', 'In progress': 'Ginagawa', 'Cancelled': 'Kinansela',
  'Overdue · was due {d}': 'Lampas na · due noong {d}', 'Today': 'Ngayon', 'Tomorrow': 'Bukas', 'Done {d}': 'Tapos {d}',
  'No next guest booked yet': 'Wala pang susunod na guest',
  'Same-day turnover: next guest arrives the same day': 'Same-day turnover: darating ang susunod na guest ngayon din',
  'Next guest arrives {d}': 'Darating ang susunod na guest sa {d}',
  'Unassigned': 'Wala pang naka-assign', '{n} of {total} done': '{n} sa {total} tapos na',
  'Nothing to clean ✨': 'Walang lilinisin ✨', 'No finished cleanings yet': 'Wala pang natapos na linis',
  'Cleaning tasks appear automatically for today\'s and tomorrow\'s check-outs.': 'Kusang lalabas ang mga gawain para sa check-out ngayon at bukas.',
  'Cleaning after each check-out': 'Paglilinis pagkatapos ng bawat check-out',
  'Housekeeping': 'Housekeeping', 'Checklist': 'Checklist', 'Details': 'Detalye', 'Photos': 'Mga litrato',
  'Start': 'Simulan', 'Mark done': 'Tapos na', 'Reopen': 'Buksan ulit', 'Started.': 'Nasimulan na.', 'Reopened.': 'Binuksan ulit.',
  'Cleaning done. Listing marked clean.': 'Tapos na ang linis. Malinis na ang unit.',
  'Mark as done?': 'Tapos na ba?', 'Mark done anyway': 'Tapusin pa rin',
  '{n} checklist item(s) not ticked yet.': '{n} sa checklist ang hindi pa nata-tick.',
  'No checklist items.': 'Walang checklist.', 'Clean {unit}': 'Linisin ang {unit}',
  'Assigned to': 'Naka-assign kay', 'Due': 'Due', 'Next guest': 'Susunod na guest', 'After stay of': 'Pagkatapos ng stay ni',
  'Notes': 'Mga tala', 'Finished': 'Natapos',
  'Add photos of the finished unit or any damage found.': 'Maglagay ng litrato ng natapos na unit o ng anumang sira.',
  'Choose a photo first.': 'Pumili muna ng litrato.', 'Upload photo': 'I-upload ang litrato', 'Photo uploaded.': 'Na-upload na ang litrato.',
  'Choose a photo': 'Pumili ng litrato', 'No photos yet.': 'Wala pang litrato.', 'Upload a JPG, PNG or WEBP photo up to 10 MB.': 'Mag-upload ng JPG, PNG o WEBP na litrato, hanggang 10 MB.',
  'Report damage': 'I-report ang sira', 'Found an item': 'May nakitang gamit', 'Supplies used': 'Mga gamit na nagamit', 'Something broken?': 'May sira ba?',
  'Description': 'Paglalarawan', 'What happened?': 'Ano ang nangyari?', 'Send report': 'Ipadala ang report',
  'Damage reported. Thank you.': 'Na-report na ang sira. Salamat.',
  'Photo (optional)': 'Litrato (hindi required)', 'Saved, but the photo did not upload. Add it from the Photos card.': 'Na-save, pero hindi na-upload ang litrato. Idagdag ito sa Photos.',
  'Item': 'Gamit', 'What did you find?': 'Ano ang nakita mo?', 'Where was it found?': 'Saan ito nakita?', 'Date found': 'Petsa ng pagkakita',
  'Save item': 'I-save ang gamit', 'Lost item recorded. Thank you.': 'Naitala na ang nakitang gamit. Salamat.',
  'Qty': 'Dami', 'Used': 'Nagamit', 'Restocked': 'Nadagdag', 'Used or restocked': 'Nagamit o nadagdag', 'Save': 'I-save', 'Cancel': 'Kanselahin',
  'No supplies are set up for this property yet.': 'Wala pang supplies na naka-set up para sa property na ito.', 'Set up supplies': 'I-set up ang supplies',
  'Enter a quantity for at least one item.': 'Maglagay ng dami sa kahit isang gamit.', 'Supplies saved.': 'Na-save ang supplies.',
  'Quantity must be a whole number.': 'Dapat buong bilang ang dami.', 'Quantity can\'t be negative.': 'Hindi puwedeng negatibo ang dami.',
  '{name} was out of stock, so it wasn\'t recorded.': 'Ubos na ang {name}, kaya hindi ito na-record.', 'Tell your manager.': 'Sabihan ang manager mo.',
  'Only {recorded} of {name} {verb} on hand, so {count} {verb} recorded.': '{recorded} lang ng {name} ang nasa stock, kaya {count} ang na-record.',
  'Title': 'Pamagat', 'What needs fixing?': 'Ano ang kailangang ayusin?', 'Priority': 'Prayoridad',
  'Low': 'Mababa', 'Medium': 'Katamtaman', 'High': 'Mataas', 'Urgent': 'Madalian',
  'Send to host': 'Ipadala sa host', 'Sent to the host. Thank you.': 'Naipadala na sa host. Salamat.',
  'Your pay for this clean': 'Bayad mo sa linis na ito', 'Paid': 'Bayad na', 'Not paid yet': 'Hindi pa bayad', 'Paid.': 'Bayad na.',
  'Dirty': 'Marumi', 'Clean': 'Malinis', 'Inspected': 'Na-inspect',
  'Held': 'Hawak pa', 'Returned': 'Naibalik', 'Disposed': 'Itinapon',
  'All properties': 'Lahat ng property', 'Property': 'Property', 'Nothing here yet': 'Wala pa rito',
  'No units to show.': 'Walang unit na ipapakita.', 'Guest now': 'Guest ngayon', 'Next check-in': 'Susunod na check-in',
  'Open task': 'Bukas na gawain', 'No open cleaning task': 'Walang bukas na gawain', 'Last inspection': 'Huling inspection',
  'Inspections': 'Mga inspection', 'Passed': 'Pasado', 'Failed': 'Hindi pasado',
  'This week': 'Ngayong linggo', 'Previous week': 'Nakaraang linggo', 'Next week': 'Susunod na linggo',
  'No cleanings': 'Walang linis', 'Something went wrong.': 'May nangyaring mali.',
  'Linked work orders': 'Mga ni-report na sira',
});

const STATUS = { todo: ['unpaid', 'To do'], in_progress: ['partial', 'In progress'], done: ['paid', 'Done'], cancelled: ['voided', 'Cancelled'] };
// Found-item statuses as the owner's Lost and found page words them.
const LOST_STATUS = { held: 'Held', returned: 'Returned', disposed: 'Disposed' };
const isCleaner = () => state.user.role === 'cleaner';
const canManage = () => !['staff', 'cleaner'].includes(state.user.role);
const fill = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : s);
// English for everyone but cleaners; they get the workspace language.
const T = (en, v) => (isCleaner() ? t(en, v) : fill(en, v));
const statusBadge = (s) => badge(STATUS[s][0], T(STATUS[s][1]));

function dueText(task) {
  const today = todayManila();
  if (task.status === 'done') return T('Done {d}', { d: fmtDateTime(task.completed_at) });
  if (task.due_date < today) return T('Overdue · was due {d}', { d: fmtDate(task.due_date) });
  if (task.due_date === today) return T('Today');
  if (task.due_date === addDays(today, 1)) return T('Tomorrow');
  return fmtDate(task.due_date);
}

function nextGuestText(task) {
  if (!task.next_check_in) return T('No next guest booked yet');
  if (task.next_check_in === task.due_date) return T('Same-day turnover: next guest arrives the same day');
  return T('Next guest arrives {d}', { d: fmtDate(task.next_check_in) });
}

const assigneeText = (x) => x.assigned_user_name || x.assignee_name || T('Unassigned');

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
    openModal({ title: 'Copy this text', body: h('textarea', { class: 'input', rows: 12, readonly: true, value: text, 'aria-label': 'Task text to copy' }) });
  }
}

// Only members who can open a task at this property: owners, plus managers and
// staff assigned to it (property_ids is null for owners).
const eligibleFor = (assignees, propertyId) => assignees.filter((a) => !a.property_ids || (propertyId && a.property_ids.includes(propertyId)));

// A team member and a typed outside name are one choice: picking a member clears the
// name, and typing a name clears the member, so neither is dropped without a word.
export function linkAssignee(memberSelect, nameInput) {
  memberSelect.addEventListener('change', () => { if (memberSelect.value) nameInput.value = ''; });
  nameInput.addEventListener('input', () => { if (nameInput.value.trim()) memberSelect.value = ''; });
}

// A check that belongs under one field. makeForm would also draw err.message in the form's top
// box, so that box is emptied again once drawn: the message shows once, under the field.
export function fieldError(name, msg) {
  const err = new ApiError(msg, { status: 400, fields: { [name]: msg } });
  err.onRender = (box) => box.replaceChildren();
  return err;
}

// Sends one assignee only. Both at once is refused here, with the same message the server uses.
export function assigneeChoice(d) {
  if (d.assigned_to && d.assignee_name?.trim()) {
    const msg = 'Pick a team member or type a name, not both.';
    throw fieldError('assignee_name', msg);
  }
  return { assigned_to: d.assigned_to || null, assignee_name: d.assignee_name || null };
}

async function assignModal(t, onSaved) {
  const assignees = eligibleFor((await get('/cleaning-assignees')).assignees, t.property_id);
  const memberField = field({ name: 'assigned_to', label: 'Team member', type: 'select', value: t?.assigned_to, placeholderOption: 'Not a team member',
    options: assignees.map((a) => [a.user_id, `${a.full_name}${a.role === 'staff' ? '' : ` (${a.role})`}`]) });
  const nameField = field({ name: 'assignee_name', label: 'Or a cleaner without a BalayHub login', value: t?.assignee_name, maxlength: 80, placeholder: 'e.g. Aling Rosa',
    hint: 'Use "Copy for cleaner" to send them the task by Messenger or Viber.' });
  linkAssignee(memberField.querySelector('select'), nameField.querySelector('input'));
  formModal({
    title: 'Assign cleaning',
    submitText: 'Save',
    fields: [memberField, nameField],
    onSubmit: async (d) => {
      await patch(`/cleaning-tasks/${t.task_id}`, assigneeChoice(d));
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
  const nameField = field({ name: 'assignee_name', label: 'Or a cleaner without a login', maxlength: 80 });
  linkAssignee(memberSelect, nameField.querySelector('input'));
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
      nameField,
      field({ name: 'notes', label: 'Notes', type: 'textarea', maxlength: 1000, placeholder: 'e.g. Deep clean, change curtains' }),
    ],
    onSubmit: async (d) => {
      // A past date is allowed (recording a clean already done) but asked about first.
      if (d.due_date && d.due_date < todayManila()
        && !(await confirmDialog({ title: 'Date is in the past', text: `${fmtDate(d.due_date)} has already passed, so this task will show as overdue. Add it anyway?`, confirmText: 'Add task' }))) {
        const msg = 'Change the date, or press Add task again and confirm.';
        throw fieldError('due_date', msg);
      }
      await post('/cleaning-tasks', { ...d, ...assigneeChoice(d) }); toast('Cleaning task added.'); onSaved();
    },
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
      const list = d.items.split('\n').map((x) => x.trim()).filter(Boolean);
      if (!list.length) { const msg = 'Add at least one checklist item.'; throw fieldError('items', msg); }
      // The same line twice (any capitals) is refused here too, with the wording the server uses.
      const seen = new Map();
      for (const x of list) {
        const key = x.toLowerCase();
        if (seen.has(key)) { const msg = `This checklist has “${seen.get(key)}” twice.`; throw fieldError('items', msg); }
        seen.set(key, x);
      }
      await api('PUT', '/cleaning-checklist', { items: list });
      toast('Checklist saved.');
    },
  });
}

// ---------------------------------------------------------------- shared bits
const TABS = [['today', 'Today & overdue'], ['upcoming', 'Upcoming'], ['done', 'Done'], ['all', 'All']];
const MAIN_TABS = [['tasks', 'Tasks'], ['board', 'Board'], ['calendar', 'Calendar'], ['scores', 'Scores']];
const UNIT_STATUS = { dirty: ['overdue', 'Dirty'], clean: ['open', 'Clean'], inspected: ['paid', 'Inspected'] };
const unitChip = (st) => badge(...(UNIT_STATUS[st] ? [UNIT_STATUS[st][0], T(UNIT_STATUS[st][1])] : ['unpaid', st || '']));
const PRIORITIES = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']];

const photoInput = () => h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'input', capture: 'environment', 'aria-label': T('Photo (optional)') });
const photoField = (input) => h('div', { class: 'field' }, h('label', null, T('Photo (optional)')), input);

// Unticked checklist items, counted from the checkbox states on screen.
export function uncheckedCount(states) {
  return states.filter((checked) => !checked).length;
}

// A hand-typed ?assignee= must be a team member's id or one of the two keywords the filter offers
// ("unassigned", "outside"). Anything else makes the server answer 404, so it is dropped before the first fetch.
export function cleanAssigneeFilter(value) {
  const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return value === 'unassigned' || value === 'outside' || (typeof value === 'string' && id.test(value)) ? value : '';
}

// The "a · b" line under a record; a part the server left out is skipped.
export function metaLine(...parts) {
  return parts.filter(Boolean).join(' · ');
}

// Paid is the server's is_paid flag, sent to every role; pay_status is read only from an older response.
export function isPaidClean(t) {
  return t.is_paid ?? (t.pay_status === 'paid');
}

// Only an owner can undo a payment (Undo paid on Cleaner pay), so everyone else is told who can.
export function undoPaidLead(role) {
  return role === 'owner' ? 'Paid. To reopen it, undo the payment on ' : 'Paid. To reopen it, an owner needs to undo the payment on ';
}

// Reopen is for a finished clean that is not paid: the server refuses a paid one (PAID, 409), and cleaners never reopen.
export function canReopen(t, role) {
  return t.status === 'done' && role !== 'cleaner' && !isPaidClean(t);
}

// Cleaner pay opens for owners and managers only: routeaccess.js blocks staff, and cleaners never see it.
export function canOpenCleanerPay(role) {
  return role === 'owner' || role === 'manager';
}

// The Cleaner pay card's line while a clean has no amount (#33): the owner's own finished clean reads "Done by you, no pay", as Cleaner pay does; any other reads "Pay not set".
export function payText(t, viewer) {
  const own = viewer?.role === 'owner' && t.status === 'done' && t.completed_by === viewer.user_id;
  return own && t.pay_amount == null ? 'Done by you, no pay' : 'Pay not set. Use Set pay.';
}

// Attach a photo to a record just created. A failed upload never loses the record.
async function attachPhoto(type, id, input) {
  const file = input.files[0];
  if (!file || !id) return;
  try { await uploadFile(type, id, file); } catch { toast(T('Saved, but the photo did not upload. Add it from the Photos card.'), 'error'); }
}

// ---------------------------------------------------------------- list
export async function housekeepingView(el, { query }) {
  if (isCleaner()) initGuestLang(state.user.guest_language);
  const tab = MAIN_TABS.some(([k]) => k === query?.tab) && !(query.tab === 'scores' && !canManage()) ? query.tab : 'tasks';
  const body = h('div');
  const tabBar = h('div', { class: 'tabs hk-main-tabs', role: 'tablist' });

  function show(k) {
    history.replaceState(null, '', k === 'tasks' ? '#/housekeeping' : `#/housekeeping?tab=${k}`);
    tabBar.replaceChildren(...MAIN_TABS.filter(([x]) => x !== 'scores' || canManage()).map(([x, label]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(x === k), onclick: () => show(x),
    }, T(label))));
    body.replaceChildren(h('div', { class: 'skeleton' }));
    const run = { tasks: tasksTab, board: boardTab, calendar: calendarTab, scores: scoresTab }[k];
    run(body, query).catch((err) => body.replaceChildren(errorState(err, () => show(k))));
  }

  el.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' }, h('h1', null, T('Housekeeping')), h('p', null, T('Cleaning after each check-out')))),
    tabBar, body);
  show(tab);
}

async function tasksTab(box, query) {
  const manager = canManage();
  const cleaner = isCleaner();
  const defaults = { view: 'today', q: '', mine: '', status: '', property_id: '', unit_id: '', assignee: '', from: '', to: '', late: '', turnover: '', sort: '' };
  const filters = initFilters('housekeeping', query, defaults);
  if (!TABS.some(([v]) => v === filters.view)) filters.view = 'today';
  filters.assignee = cleanAssigneeFilter(filters.assignee);
  const [{ properties }, { listings }, { assignees }] = await Promise.all([
    cleaner ? { properties: [] } : get('/properties'), cleaner ? { listings: [] } : get('/listings'), manager ? get('/cleaning-assignees') : { assignees: [] },
  ]);
  const tabs = h('div', { class: 'tabs tabs--compact', role: 'tablist' });
  const list = h('div');

  async function load() {
    const active = changed(filters, { ...defaults, view: '' });
    history.replaceState(null, '', `#/housekeeping${qs(active)}`);
    const { tasks, counts } = await get(`/cleaning-tasks${qs(active)}`);
    const count = { today: counts.today, upcoming: counts.upcoming };
    tabs.replaceChildren(...TABS.map(([k, label]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(k === filters.view),
      onclick: () => { filters.view = k; rememberFilters('housekeeping', filters); load().catch((e) => toast(e.message, 'error')); },
    }, count[k] !== undefined ? `${T(label)} (${count[k]})` : T(label))));
    const filtered = Object.keys(changed(filters, defaults)).some((k) => k !== 'view' && k !== 'sort');
    const view = filters.view;
    list.replaceChildren(tasks.length
      ? h('div', { class: 'hk-grid' }, tasks.map((x) => h('a', { class: `card hk-card${['todo', 'in_progress'].includes(x.status) && x.due_date < todayManila() ? ' hk-card--late' : ''}`, href: `#/housekeeping/${x.task_id}` },
        h('div', { class: 'hk-card__top' },
          h('div', null, h('strong', null, x.unit_name), h('div', { class: 'small muted' }, x.property_name)),
          statusBadge(x.status)),
        h('div', { class: 'hk-card__due' }, dueText(x)),
        ['todo', 'in_progress'].includes(x.status) && h('div', { class: `small${x.next_check_in === x.due_date ? ' amount--neg' : ' muted'}` }, nextGuestText(x)),
        h('div', { class: 'bar' }, h('span', { style: { width: `${x.item_count ? Math.round((100 * x.done_count) / x.item_count) : 0}%` } })),
        h('div', { class: 'small muted' }, `${T('{n} of {total} done', { n: x.done_count, total: x.item_count })} · ${assigneeText(x)}`))))
      : h('div', { class: 'card' }, emptyState(filtered ? { title: 'No results found', text: 'Try removing a filter.', iconName: 'home' } : {
        title: T(view === 'done' ? 'No finished cleanings yet' : 'Nothing to clean ✨'),
        text: view === 'today' ? T('Cleaning tasks appear automatically for today\'s and tomorrow\'s check-outs.') : null,
        iconName: 'home',
      })));
  }

  const bar = cleaner ? tabs : filterBar({
    key: 'housekeeping', values: filters, defaults, onChange: () => load().catch((e) => toast(e.message, 'error')),
    extra: tabs,
    search: { placeholder: 'Search listing, cleaner or notes' },
    quick: [
      { name: 'mine', label: 'Only my tasks', type: 'check' },
      properties.length > 1 && { name: 'property_id', label: 'Property', all: 'All properties', options: properties.map((p) => [p.property_id, p.property_name]) },
    ].filter(Boolean),
    more: [
      { name: 'unit_id', label: 'Listing', all: 'All listings', options: listings.map((l) => [l.unit_id, `${l.unit_name}${properties.length > 1 ? ` · ${l.property_name}` : ''}`]) },
      { name: 'status', label: 'Status', all: 'Any status', options: Object.entries(STATUS).map(([k, [, label]]) => [k, label]) },
      manager && { name: 'assignee', label: 'Assigned to', all: 'Anyone', options: [['unassigned', 'Not assigned yet'], ['outside', 'Cleaner without a login'], ...assignees.map((a) => [a.user_id, a.full_name])] },
      { name: 'due', keys: ['from', 'to'], label: 'Due between', type: 'daterange' },
      { name: 'turnover', label: 'Next guest', all: 'Any', options: [['same_day', 'Same-day turnover'], ['next_booked', 'Next guest booked'], ['no_next', 'No next guest yet']] },
      { name: 'late', label: 'Overdue only', type: 'check' },
      { name: 'sort', label: 'Sort by', all: 'Default for this tab', options: [['due', 'Due date (soonest first)'], ['due_desc', 'Due date (latest first)'], ['listing', 'Listing'], ['next_guest', 'Next guest arrival'], ['completed', 'Recently finished']] },
    ].filter(Boolean),
  });
  await load();

  box.replaceChildren(
    manager && h('div', { class: 'hk-toolbar' },
      state.user.role === 'owner' && h('button', { class: 'btn btn--secondary', onclick: checklistModal }, 'Edit checklist'),
      h('button', { class: 'btn btn--primary', onclick: () => newTaskModal(() => load().catch((e) => toast(e.message, 'error'))) }, icon('plus'), 'Add task')),
    bar,
    list);
}

// ---------------------------------------------------------------- board
// GET /cleaning-board?property_id= -> { units: [{ unit_id, unit_name, property_name, cleaning_status, current_stay, next_check_in, open_task, last_inspection }] }
// The open task's status and assignee, in the words the board shows.
const openTaskText = (o) => `${T(STATUS[o.status]?.[1] || 'To do')}${o.assignee ? ` · ${o.assignee}` : ''}`;

async function boardTab(box) {
  const cleaner = isCleaner();
  const { properties } = cleaner ? { properties: [] } : await get('/properties');
  let propertyId = '';
  const grid = h('div');
  const pick = properties.length > 1 ? h('select', { class: 'input hk-select', 'aria-label': T('Property'), onchange: (e) => { propertyId = e.target.value; load().catch((err) => toast(err.message, 'error')); } },
    h('option', { value: '' }, T('All properties')), properties.map((p) => h('option', { value: p.property_id }, p.property_name))) : null;

  async function load() {
    const { units } = await get(`/cleaning-board${qs({ property_id: propertyId })}`);
    const count = (st) => units.filter((u) => u.cleaning_status === st).length;
    grid.replaceChildren(
      h('div', { class: 'hk-counts' }, ['dirty', 'clean', 'inspected'].map((st) => h('span', { class: `hk-count hk-count--${st}` }, unitChip(st), ` ${count(st)}`))),
      units.length
        ? h('div', { class: 'hk-grid' }, units.map((u) => h('div', { class: `card hk-unit hk-unit--${u.cleaning_status}` },
          h('div', { class: 'hk-card__top' },
            h('div', null, h('strong', null, u.unit_name), h('div', { class: 'small muted' }, u.property_name)),
            unitChip(u.cleaning_status)),
          h('dl', { class: 'dl hk-unit__dl' },
            h('dt', null, T('Guest now')),
            h('dd', null, u.current_stay ? `${u.current_stay.guest_first_name || ''} · ${fmtDate(u.current_stay.check_in)} – ${fmtDate(u.current_stay.check_out)}` : '—'),
            h('dt', null, T('Next check-in')), h('dd', null, u.next_check_in ? fmtDate(u.next_check_in) : '—'),
            h('dt', null, T('Open task')),
            h('dd', null, u.open_task
              ? h('a', { href: `#/housekeeping/${u.open_task.task_id}`, 'aria-label': `${openTaskText(u.open_task)}, ${u.unit_name}` }, openTaskText(u.open_task))
              : h('span', { class: 'muted' }, T('No open cleaning task'))),
            // A cleaner is sent no score, so her line is "Passed · date"; the score is printed only when it is there.
            u.last_inspection && [h('dt', null, T('Last inspection')),
              h('dd', null, metaLine(u.last_inspection.score != null && `${u.last_inspection.score}%`, T(u.last_inspection.passed ? 'Passed' : 'Failed'), fmtDate(manilaDay(u.last_inspection.at))))]))))
        : h('div', { class: 'card' }, emptyState({ title: T('No units to show.'), iconName: 'home' })));
  }
  box.replaceChildren(pick && h('div', { class: 'hk-toolbar' }, pick), grid);
  await load();
}

// ---------------------------------------------------------------- calendar
// GET /cleaning-calendar?from&to -> { days: [{ date, tasks: [...] }], assignees }
const weekStart = (d) => { const wd = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7; return addDays(d, -wd); };

async function calendarTab(box) {
  const manager = canManage();
  const people = manager ? (await get('/cleaning-assignees')).assignees : [];
  let start = weekStart(todayManila());
  const grid = h('div', { class: 'hk-week' });
  const label = h('strong', { 'aria-live': 'polite' });

  async function load() {
    const to = addDays(start, 6);
    label.textContent = `${fmtDate(start)} – ${fmtDate(to)}`;
    const { days } = await get(`/cleaning-calendar${qs({ from: start, to })}`);
    const byDate = Object.fromEntries((days || []).map((d) => [d.date, d.tasks || []]));
    grid.replaceChildren(...Array.from({ length: 7 }, (_, n) => addDays(start, n)).map((date) => {
      const day = byDate[date] || [];
      const isToday = date === todayManila();
      return h('section', { class: `card hk-day${isToday ? ' hk-day--today' : ''}`, 'aria-label': fmtDate(date) },
        h('h3', { class: 'hk-day__label' },
          new Date(`${date}T00:00:00Z`).toLocaleDateString(isCleaner() ? locale() : 'en-PH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }),
          isToday && h('span', { class: 'hk-day__today' }, T('Today'))),
        day.length ? h('div', { class: 'hk-jobs' }, day.map((x) => h('div', { class: 'hk-job' },
          h('div', { class: 'hk-card__top' },
            h('a', { class: 'hk-job__unit', href: `#/housekeeping/${x.task_id}`, title: x.unit_name }, x.unit_name),
            statusBadge(x.status)),
          x.property_name && h('div', { class: 'small muted hk-job__prop' }, x.property_name),
          x.next_check_in && h('div', { class: 'small muted' }, nextGuestText({ ...x, due_date: date })),
          manager && ['todo', 'in_progress'].includes(x.status)
            ? reassignSelect(x)
            : h('div', { class: 'small muted' }, assigneeText(x)))))
          : h('p', { class: 'small muted hk-day__empty' }, T('No cleanings')));
    }));
  }

  function reassignSelect(x) {
    const eligible = x.property_id ? eligibleFor(people, x.property_id) : people;
    const outside = !x.assigned_to && x.assignee_name;
    const sel = h('select', {
      class: 'input hk-reassign', 'aria-label': `Assign ${x.unit_name}`,
      onchange: async (e) => {
        sel.disabled = true;
        try { await patch(`/cleaning-tasks/${x.task_id}`, { assigned_to: e.target.value || null, assignee_name: null }); toast('Assignment saved.'); await load(); } catch (err) { toast(err.message, 'error'); sel.disabled = false; sel.value = x.assigned_to || ''; }
      },
    },
    h('option', { value: '' }, outside ? `${x.assignee_name} (no login)` : 'Unassigned'),
    eligible.map((a) => h('option', { value: a.user_id, selected: a.user_id === x.assigned_to }, a.full_name)));
    return sel;
  }

  const go = (n) => () => { start = addDays(start, n); load().catch((err) => toast(err.message, 'error')); };
  box.replaceChildren(
    h('div', { class: 'hk-toolbar hk-weeknav' },
      h('button', { class: 'btn btn--secondary', onclick: go(-7), 'aria-label': T('Previous week') }, '‹'),
      label,
      h('button', { class: 'btn btn--secondary', onclick: go(7), 'aria-label': T('Next week') }, '›'),
      h('button', { class: 'btn btn--ghost', onclick: () => { start = weekStart(todayManila()); load().catch((err) => toast(err.message, 'error')); } }, T('This week'))),
    grid);
  await load();
}

// ---------------------------------------------------------------- scores
// GET /cleaner-scores?month=YYYY-MM -> { cleaners: [{ cleaner_key, cleaner_name, tasks_done, inspected, avg_score, fails }] }
async function scoresTab(box) {
  let month = todayManila().slice(0, 7);
  const out = h('div');
  const input = h('input', { type: 'month', class: 'input hk-select', value: month, 'aria-label': 'Month', onchange: (e) => { month = e.target.value || month; load().catch((err) => toast(err.message, 'error')); } });
  async function load() {
    const r = await get(`/cleaner-scores${qs({ month })}`);
    const rows = r.cleaners || [];
    out.replaceChildren(rows.length
      ? h('div', { class: 'card card--flush' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Cleaner', 'Cleans done', 'Inspected', 'Average score', 'Fails'].map((c, i) => h('th', { class: i ? 'num' : '' }, c)))),
        h('tbody', null, rows.map((c) => h('tr', null,
          h('td', null, c.cleaner_name),
          h('td', { class: 'num' }, String(c.tasks_done ?? 0)),
          h('td', { class: 'num' }, String(c.inspected ?? 0)),
          h('td', { class: 'num' }, c.avg_score == null ? '—' : `${Math.round(c.avg_score)}%`),
          h('td', { class: 'num' }, String(c.fails ?? 0))))))))
      : h('div', { class: 'card' }, emptyState({ title: 'No scores yet', text: 'Scores appear once you inspect finished cleanings.', iconName: 'home' })));
  }
  box.replaceChildren(h('div', { class: 'hk-toolbar' }, input), out);
  await load();
}

// ---------------------------------------------------------------- task forms
function damageModal(task, onSaved) {
  const photo = photoInput();
  formModal({
    title: T('Report damage'), submitText: T('Send report'),
    fields: [
      field({ name: 'description', label: T('What happened?'), type: 'textarea', required: true, maxlength: 1000 }),
      canManage() && field({ name: 'estimated_cost', label: 'Estimated cost', type: 'money' }),
      photoField(photo),
    ].filter(Boolean),
    onSubmit: async (d) => {
      const body = { description: d.description };
      if (d.estimated_cost) body.estimated_cost = d.estimated_cost;
      const r = await post(`/cleaning-tasks/${task.task_id}/damage`, body);
      await attachPhoto('damage', r.report?.report_id, photo);
      toast(T('Damage reported. Thank you.'));
      onSaved();
    },
  });
}

function lostFoundModal(task, onSaved) {
  const photo = photoInput();
  formModal({
    title: T('Found an item'), submitText: T('Save item'),
    fields: [
      field({ name: 'description', label: T('What did you find?'), required: true, maxlength: 300 }),
      field({ name: 'found_where', label: T('Where was it found?'), maxlength: 200 }),
      field({ name: 'found_on', label: T('Date found'), type: 'date', value: todayManila() }),
      photoField(photo),
    ],
    onSubmit: async (d) => {
      const r = await post(`/cleaning-tasks/${task.task_id}/lost-found`, { description: d.description, found_where: d.found_where || null, found_on: d.found_on || todayManila() });
      await attachPhoto('lost_found', r.item?.item_id, photo);
      toast(T('Lost item recorded. Thank you.'));
      onSaved();
    },
  });
}

async function suppliesModal(task, onSaved) {
  const { supplies } = await get(`/supplies${qs({ property_id: task.property_id })}`);
  // Nothing set up means nothing to save, so this dialog has no Save button. Owners and managers are sent to Supplies.
  if (!supplies?.length) {
    const m = openModal({
      title: T('Supplies used'),
      body: h('div', { class: 'form' },
        h('p', null, T('No supplies are set up for this property yet.'), !canManage() && ` ${T('Tell your manager.')}`),
        canManage() && h('div', { class: 'form-actions' }, h('a', { class: 'btn btn--primary', href: '#/supplies', onclick: () => m.close() }, T('Set up supplies')))),
    });
    return;
  }
  const rows = (supplies || []).map((sp) => ({
    sp, key: `qty-${sp.supply_id}`, askFirst: canManage(), qty: h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 9999, class: 'input hk-qty', 'aria-label': `${T('Qty')}: ${sp.name}` }),
    kind: h('select', { class: 'input', 'aria-label': `${T('Used or restocked')}: ${sp.name}` }, h('option', { value: 'used' }, T('Used')), h('option', { value: 'restocked' }, T('Restocked'))),
  }));
  formModal({
    title: T('Supplies used'), submitText: T('Save'),
    // Each row has its own error line (the .error inside .field), so a refused quantity shows on its row.
    fields: h('div', { class: 'hk-supply-list' }, rows.map((r) => h('div', { class: 'field', style: { gap: '0' }, 'data-field': r.key },
      h('div', { class: 'hk-supply' },
        h('div', null, h('strong', null, r.sp.name), h('div', { class: 'small muted' }, r.sp.unit_label || '')),
        r.qty, r.kind),
      h('div', { class: 'error' })))),
    onSubmit: async () => {
      // A negative or decimal quantity is refused on its own row, never rounded or dropped: nothing is sent until every quantity is a whole, non-negative number.
      const refuse = (msg, list) => {
        const err = new ApiError(msg, { status: 400, fields: Object.fromEntries(list.map((r) => [r.key, msg])) });
        err.onRender = (box) => box.replaceChildren();
        throw err;
      };
      const negative = rows.filter((r) => Number(r.qty.value) < 0);
      if (negative.length) refuse(T('Quantity can\'t be negative.'), negative);
      const filled = rows.filter((r) => Number(r.qty.value) > 0);
      const decimal = filled.filter((r) => !Number.isInteger(Number(r.qty.value)));
      if (decimal.length) refuse(T('Quantity must be a whole number.'), decimal);
      // Owners and managers are asked before stock moves (D-77): a use with nothing on hand is refused on its row,
      // and more than is on hand asks first, as the Supplies page does. Staff and cleaners keep the skip-and-name rule.
      const uses = filled.filter((r) => r.askFirst && r.kind.value === 'used');
      const none = uses.filter((r) => Number(r.sp.on_hand) <= 0);
      if (none.length) refuse('Nothing on hand. Restock it first.', none);
      // A use above what is on hand goes out with record_on_hand only once the owner has confirmed it; the server refuses it otherwise.
      const short = uses.filter((x) => Number(x.qty.value) > Number(x.sp.on_hand));
      const items = filled.map((r) => ({ supply_id: r.sp.supply_id, kind: r.kind.value, quantity: Number(r.qty.value), ...(short.includes(r) ? { record_on_hand: true } : {}) }));
      if (!items.length) throw new ApiError(T('Enter a quantity for at least one item.'), { status: 400 });
      for (const r of short) {
        const asked = qtyLabel(Number(r.qty.value), r.sp.unit_label);
        const onHand = qtyLabel(Number(r.sp.on_hand), r.sp.unit_label);
        // Cancel returns false: the form stays open and nothing is recorded.
        if (!await confirmDialog({ title: 'Not enough on hand', text: `You asked to record ${asked} used. On hand is ${onHand}, so only that much is logged as used, and on hand goes to 0.`, confirmText: 'Record what is on hand' })) return false;
      }
      const { skipped, short: shortfall = [] } = await post(`/cleaning-tasks/${task.task_id}/supplies`, { items });
      // A partial shortfall (#34) is named the way a zero stock is: what was on hand and what was recorded.
      const problems = [
        ...shortfall.map((s) => { const n = Number(s.recorded); return T('Only {recorded} of {name} {verb} on hand, so {count} {verb} recorded.', { recorded: qtyLabel(n, s.unit_label), name: s.name, count: n, verb: n === 1 ? 'was' : 'were' }); }),
        ...skipped.map((name) => T('{name} was out of stock, so it wasn\'t recorded.', { name })),
      ];
      // Only cleaners are told to tell their manager.
      toast(problems.length ? [...problems, ...(isCleaner() ? [T('Tell your manager.')] : [])].join(' ') : T('Supplies saved.'), problems.length ? 'error' : 'info');
      onSaved();
    },
  });
}

// An owner or manager is the host, so their repair goes onto their own Maintenance list, not to a host (#36).
function workOrderModal(task, onSaved) {
  formModal({
    title: T('Something broken?'), submitText: canManage() ? 'Log repair' : T('Send to host'),
    fields: [
      field({ name: 'title', label: T('Title'), required: true, maxlength: 150, placeholder: 'e.g. Aircon is leaking' }),
      field({ name: 'description', label: T('What needs fixing?'), type: 'textarea', maxlength: 1000 }),
      field({ name: 'priority', label: T('Priority'), type: 'select', value: 'medium', placeholderOption: false, options: PRIORITIES.map(([k, l]) => [k, T(l)]) }),
    ],
    onSubmit: async (d) => { await post(`/cleaning-tasks/${task.task_id}/work-order`, d); toast(canManage() ? 'Repair logged. It\'s on your Maintenance list.' : T('Sent to the host. Thank you.')); onSaved(); },
  });
}

// Owners and managers: pass or fail each checklist item of a finished task.
function inspectModal(task, onSaved) {
  const photo = photoInput();
  const rows = task.checklist.map((c, i) => {
    const box = h('input', { type: 'checkbox', checked: true, 'aria-label': c.text });
    const word = h('span', { class: 'hk-pf hk-pf--pass' }, 'Pass');
    box.addEventListener('change', () => { word.textContent = box.checked ? 'Pass' : 'Fail'; word.className = `hk-pf hk-pf--${box.checked ? 'pass' : 'fail'}`; });
    return { i, box, node: h('li', null, h('label', { class: 'check' }, box, h('span', { class: 'hk-pf__text' }, c.text), word)) };
  });
  formModal({
    title: 'Inspect cleaning', submitText: 'Save inspection',
    fields: [
      h('p', { class: 'hint' }, 'Untick any item that was not done well. A failed inspection reopens the task.'),
      h('ul', { class: 'hk-checklist' }, rows.map((r) => r.node)),
      field({ name: 'notes', label: 'Notes', type: 'textarea', maxlength: 1000 }),
      photoField(photo),
    ],
    onSubmit: async (d) => {
      const r = await post(`/cleaning-tasks/${task.task_id}/inspect`, { items: rows.map((x) => ({ index: x.i, pass: x.box.checked })), notes: d.notes || null });
      await attachPhoto('inspection', r.inspection?.inspection_id, photo);
      toast(r.inspection?.passed ? 'Inspection passed. Listing marked inspected.'
        : `Sent back for re-cleaning${r.pay_cleared ? '. The pay you set was cleared; it is set again when the clean is finished.' : ''}`);
      onSaved();
    },
  });
}

// Owners and managers edit a job's notes; the server keeps up to 1000 characters.
function notesModal(task, onSaved) {
  formModal({
    title: 'Edit notes', submitText: 'Save notes',
    fields: [field({ name: 'notes', label: 'Notes', type: 'textarea', maxlength: 1000, value: task.notes ?? '' })],
    onSubmit: async (d) => { await patch(`/cleaning-tasks/${task.task_id}`, { notes: d.notes }); toast('Notes saved.'); onSaved(); },
  });
}

function payModal(task, onSaved) {
  formModal({
    title: 'Pay for this clean', submitText: 'Save',
    fields: [field({ name: 'pay_amount', label: 'Amount', type: 'money', required: true, value: task.pay_amount ?? '' })],
    onSubmit: async (d) => { await patch(`/cleaning-tasks/${task.task_id}`, { pay_amount: d.pay_amount }); toast('Pay saved.'); onSaved(); },
  });
}

// Photo thumbnails for a damage report or lost item; each links to the full file.
const thumbs = (files) => (files?.length ? h('div', { class: 'hk-thumbs' }, files.map((f) => h('a', { href: `/api/files/${f.file_id}`, target: '_blank', rel: 'noopener', 'aria-label': f.file_name },
  (f.mime_type || '').startsWith('image/') ? h('img', { src: `/api/files/${f.file_id}`, alt: f.file_name, loading: 'lazy' }) : f.file_name))) : null);

// ---------------------------------------------------------------- detail
export async function housekeepingDetailView(el, { params, rerender }) {
  if (isCleaner()) initGuestLang(state.user.guest_language);
  const r = await get(`/cleaning-tasks/${params.id}`);
  const { task: t, files } = r;
  const isManager = canManage();
  const open = ['todo', 'in_progress'].includes(t.status);
  const inspections = t.inspections || [];
  const workOrders = t.work_orders || [];
  const damageReports = t.damage_reports || [];
  const lostFound = t.lost_found || [];

  const setStatus = async (status, msg) => {
    try { await post(`/cleaning-tasks/${t.task_id}/status`, { status }); toast(msg); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  const finish = async () => {
    const left = uncheckedCount([...items.querySelectorAll('input[type="checkbox"]')].map((b) => b.checked));
    if (left > 0 && !await confirmDialog({ title: T('Mark as done?'), text: T('{n} checklist item(s) not ticked yet.', { n: left }), confirmText: T('Mark done anyway'), cancelText: T('Cancel') })) return;
    setStatus('done', T('Cleaning done. Listing marked clean.'));
  };
  // Reopening clears a pay that was typed or worked out, so it asks first when there is one.
  const reopen = async () => {
    if (t.pay_amount != null && !await confirmDialog({ title: 'Reopen this clean?', text: `Its pay of ${peso(t.pay_amount)} is cleared. It's worked out again from the rate when the clean is finished, so check the amount then.`, confirmText: 'Reopen' })) return;
    setStatus('in_progress', T('Reopened.'));
  };

  const items = h('ul', { class: 'hk-checklist' }, t.checklist.map((c, i) => h('li', null,
    h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', checked: c.done, disabled: !open,
        onchange: async (e) => {
          const box = e.target;
          box.disabled = true;
          try {
            const res = await post(`/cleaning-tasks/${t.task_id}/checklist`, { index: i, done: box.checked });
            progress.textContent = T('{n} of {total} done', { n: res.task.done_count, total: res.task.item_count });
            if (t.status === 'todo') { t.status = 'in_progress'; statusSlot.replaceChildren(statusBadge('in_progress')); startBtn?.remove(); }
          } catch (err) { box.checked = !box.checked; toast(err.message, 'error'); } finally { box.disabled = false; }
        },
      }),
      h('span', null, c.text)))));
  const progress = h('span', { class: 'muted small' }, T('{n} of {total} done', { n: t.done_count, total: t.item_count }));
  const statusSlot = h('span', null, statusBadge(t.status));
  const startBtn = t.status === 'todo' ? h('button', { class: 'btn btn--secondary', onclick: () => setStatus('in_progress', T('Started.')) }, T('Start')) : null;
  const upload = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'input', capture: 'environment', 'aria-label': T('Choose a photo') });
  const actionBtn = (text, fn) => h('button', { class: 'btn btn--secondary hk-action', type: 'button', onclick: () => fn(t, rerender) }, text);

  // The link to Cleaner pay only where the route is open to this role; staff get the same words as plain text.
  const payLink = canOpenCleanerPay(state.user.role) ? h('a', { href: '#/cleaner-pay' }, 'Cleaner pay') : 'Cleaner pay';
  const payCard = isManager
    ? (t.status === 'done' || t.pay_amount != null) && h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Cleaner pay'), t.pay_status && badge(t.pay_status === 'paid' ? 'paid' : 'unpaid', t.pay_status === 'paid' ? 'Paid' : 'Unpaid')),
      h('p', null, t.pay_amount != null ? h('strong', null, peso(t.pay_amount)) : h('span', { class: 'muted' }, payText(t, state.user))),
      t.pay_status !== 'paid' && h('button', { class: 'btn btn--secondary', onclick: () => payModal(t, rerender) }, t.pay_amount != null ? 'Edit pay' : 'Set pay'))
    : t.pay_amount != null && h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, T('Your pay for this clean')), badge(t.pay_status === 'paid' ? 'paid' : 'unpaid', T(t.pay_status === 'paid' ? 'Paid' : 'Not paid yet'))),
      h('p', null, h('strong', null, peso(t.pay_amount))));

  el.replaceChildren(
    h('a', { class: 'back', href: '#/housekeeping' }, `‹ ${T('Housekeeping')}`),
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' }, h('h1', null, T('Clean {unit}', { unit: t.unit_name })), h('p', null, `${t.property_name} · ${dueText(t)}`)),
      h('div', { class: 'page-head__actions' },
        startBtn,
        open && h('button', { class: 'btn btn--primary', onclick: finish }, T('Mark done')),
        // A paid clean cannot be reopened (the server refuses it), so say how to undo the payment instead.
        t.status === 'done' && isPaidClean(t) && (isCleaner()
          ? h('span', { class: 'small muted' }, T('Paid.'))
          : h('span', { class: 'small muted' }, undoPaidLead(state.user.role), payLink, ' first.')),
        canReopen(t, state.user.role) && h('button', { class: 'btn btn--secondary', onclick: reopen }, T('Reopen')),
        // No Inspect on a paid clean (the server refuses it, as with Reopen), and no Copy for cleaner on a cancelled job.
        isManager && t.status === 'done' && t.checklist.length > 0 && !isPaidClean(t) && h('button', { class: 'btn btn--primary', onclick: () => inspectModal(t, rerender) }, 'Inspect'),
        isManager && t.status !== 'cancelled' && h('button', { class: 'btn btn--secondary', onclick: () => copyText(taskText(t)) }, 'Copy for cleaner'),
        isManager && open && h('button', { class: 'btn btn--ghost', onclick: async () => {
          if (await confirmDialog({ title: 'Cancel this cleaning task?', text: 'Use this if the cleaning is no longer needed.', confirmText: 'Cancel task', danger: true })) setStatus('cancelled', 'Task cancelled.');
        } }, 'Cancel task'))),
    h('div', { class: 'grid grid--2' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, T('Checklist')), progress),
          t.checklist.length ? items : h('p', { class: 'muted small' }, T('No checklist items.'))),
        t.status !== 'cancelled' && h('div', { class: 'hk-actions' },
          actionBtn(T('Report damage'), damageModal),
          actionBtn(T('Found an item'), lostFoundModal),
          actionBtn(T('Supplies used'), suppliesModal),
          actionBtn(T('Something broken?'), workOrderModal)),
        inspections.length > 0 && h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, T('Inspections'))),
          h('ul', { class: 'hk-history' }, inspections.map((i) => h('li', null,
            h('div', { class: 'hk-card__top' },
              i.score != null && h('strong', null, `${i.score}%`),
              typeof i.passed === 'boolean' && badge(i.passed ? 'paid' : 'overdue', T(i.passed ? 'Passed' : 'Failed'))),
            h('div', { class: 'small muted' }, metaLine(i.created_at && fmtDateTime(i.created_at), i.inspected_by_name)),
            (i.items || []).some((x) => !x.pass) && h('div', { class: 'small' }, `Failed: ${i.items.filter((x) => !x.pass).map((x) => x.text).join(', ')}`),
            i.notes && h('div', { class: 'small', style: { whiteSpace: 'pre-wrap' } }, i.notes))))),
        damageReports.length > 0 && h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, T('Report damage'))),
          h('ul', { class: 'hk-history' }, damageReports.map((d) => h('li', null,
            h('div', { class: 'hk-card__top' }, h('span', { style: { whiteSpace: 'pre-wrap' } }, d.description), d.status && h('span', { class: 'small muted' }, d.status)),
            h('div', { class: 'small muted' }, `${fmtDateTime(d.created_at)}${d.reported_by_name ? ` · ${d.reported_by_name}` : ''}${isManager && d.estimated_cost != null ? ` · ${peso(d.estimated_cost)}` : ''}`),
            thumbs(d.files))))),
        lostFound.length > 0 && h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, T('Found an item'))),
          h('ul', { class: 'hk-history' }, lostFound.map((l) => h('li', null,
            h('div', { class: 'hk-card__top' }, h('strong', null, l.description), LOST_STATUS[l.status] && h('span', { class: 'small muted' }, T(LOST_STATUS[l.status]))),
            h('div', { class: 'small muted' }, metaLine(l.found_where, l.found_on && fmtDate(l.found_on), l.found_by_name)),
            thumbs(l.files))))),
        workOrders.length > 0 && h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, T('Linked work orders'))),
          h('ul', { class: 'hk-history' }, workOrders.map((w) => h('li', null, h('strong', null, w.title), w.status && h('span', { class: 'small muted' }, ` · ${w.status}`)))))),
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, T('Details')), statusSlot),
          h('dl', { class: 'dl' },
            h('dt', null, T('Assigned to')), h('dd', null, assigneeText(t),
              isManager && h('div', null, h('button', { class: 'linkbtn', onclick: () => assignModal(t, rerender) }, 'Change'))),
            h('dt', null, T('Due')), h('dd', null, fmtDate(t.due_date)),
            h('dt', null, T('Next guest')), h('dd', null, nextGuestText(t)),
            t.departing_guest && [h('dt', null, T('After stay of')), h('dd', null, t.departing_guest)],
            (t.notes || isManager) && [h('dt', null, T('Notes')), h('dd', { style: { whiteSpace: 'pre-wrap' } }, t.notes || '—',
              isManager && h('div', null, h('button', { class: 'linkbtn', onclick: () => notesModal(t, rerender) }, 'Edit notes')))],
            t.completed_at && [h('dt', null, T('Finished')), h('dd', null, `${fmtDateTime(t.completed_at)}${t.completed_by_name ? ` · ${t.completed_by_name}` : ''}`)]),
          t.booking_id && isManager && h('p', { class: 'small', style: { marginTop: '10px' } }, h('a', { href: `#/reservations/${t.booking_id}` }, 'Open the reservation'))),
        payCard,
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, T('Photos'))),
          h('p', { class: 'muted small' }, T('Add photos of the finished unit or any damage found.')),
          files?.length ? filesList(files) : h('p', { class: 'muted small' }, T('No photos yet.')),
          h('div', { class: 'form', style: { marginTop: '12px' } }, upload,
            h('button', {
              class: 'btn btn--secondary', onclick: async (e) => {
                if (!upload.files[0]) { toast(T('Choose a photo first.'), 'error'); return; }
                e.target.disabled = true;
                try { await uploadFile('cleaning', t.task_id, upload.files[0]); toast(T('Photo uploaded.')); rerender(); } catch (err) { toast(err.code === 'UNSUPPORTED_FILE' || err.status === 413 ? T('Upload a JPG, PNG or WEBP photo up to 10 MB.') : err.message, 'error'); e.target.disabled = false; }
              },
            }, T('Upload photo')))))));
}
