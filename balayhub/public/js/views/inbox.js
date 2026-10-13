// Guest inbox: conversation list, thread with composer, reservation summary;
// plus message templates and automatic messages.

import { get, post, patch, qs } from '../api.js';
import {
  h, icon, peso, fmtDate, fmtDateTime, badge, field, formModal, confirmDialog, emptyState, toast, openModal, todayManila,
} from '../ui.js';
import { state } from '../app.js';
import { initFilters, filterBar, rememberFilters, changed } from '../filters.js';
import { CHANNEL_LABEL } from './reservations.js';

const VIEWS = [
  ['open', 'All open'],
  ['unread', 'Unread'],
  ['mine', 'Assigned to me'],
  ['upcoming', 'Upcoming stays'],
  ['hosting', 'Currently hosting'],
  ['snoozed', 'Snoozed'],
  ['archived', 'Archived'],
];

// Unread badge for the navigation (refreshed on each page load).
export async function unreadCount() {
  if (!state.user || state.user.role === 'staff') return 0;
  try { return Number((await get('/inbox/counts')).counts.unread) || 0; } catch { return 0; }
}

function shortWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(d) === todayManila();
  return d.toLocaleString('en-PH', sameDay
    ? { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }
    : { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' });
}

function stayLabel(c) {
  const today = todayManila();
  if (c.booking_status === 'cancelled') return badge('voided', 'Cancelled');
  if (c.checked_out_at || c.check_out < today) return badge('paid', 'Checked out');
  if (c.checked_in_at) return badge('active', 'In house');
  if (c.check_in <= today) return badge('partial', 'Not checked in');
  return badge('unpaid', 'Upcoming');
}

function statusAlerts(status) {
  const out = [];
  if (!status.sending) {
    out.push(h('div', { class: 'alert alert--warn' }, 'Email sending is not set up on the server yet, so messages can\'t be sent. Follow EMAIL-SETUP.md (step 7 of the server guide).'));
  } else if (!status.replies.configured) {
    out.push(h('div', { class: 'alert alert--info' }, 'Guest replies currently arrive in your email inbox only. Showing them here needs a one-time setup on the server; ask whoever set up BalayHub for you.'));
  } else if (status.replies.last_error) {
    out.push(h('div', { class: 'alert alert--warn' }, `Couldn't check for guest replies: ${status.replies.last_error}`));
  }
  return out;
}

// ---------------------------------------------------------------- page
export async function inboxView(el, { params, query, rerender }) {
  const defaults = { view: 'open', q: '', unread: '', channel: '', property_id: '', unit_id: '', stay: '', assigned: '', msg_from: '', msg_to: '', attention: '', sort: '' };
  const selected = params.id || null;
  // A link straight to one conversation (e.g. "Message guest") starts unfiltered,
  // so saved filters can't hide the conversation it opens.
  const linked = selected && !Object.keys(defaults).some((k) => query[k]);
  const filters = linked ? { ...defaults } : initFilters('inbox', query, defaults);
  if (!VIEWS.some(([k]) => k === filters.view)) filters.view = 'open';
  const [counts, status, { properties }, { units }, { assignees }] = await Promise.all([
    get('/inbox/counts'), get('/inbox/status'), get('/properties'), get('/units'), get('/inbox/assignees'),
  ]);
  // Links keep the current filters, so opening a conversation doesn't reset the list.
  const href = (id) => `#/inbox${id ? `/${id}` : ''}${qs(changed(filters, { ...defaults, view: '' }))}`;
  const stUnits = units.filter((u) => u.nightly_rate !== null && u.nightly_rate !== undefined);
  const items = h('div');
  const viewSelect = h('select', { class: 'input input--sm', 'aria-label': 'Show' },
    VIEWS.map(([k, t]) => h('option', { value: k, selected: k === filters.view }, `${t}${counts.counts[k] !== undefined && Number(counts.counts[k]) ? ` (${counts.counts[k]})` : ''}`)));
  viewSelect.addEventListener('change', () => { filters.view = viewSelect.value; rememberFilters('inbox', filters); load(); });

  async function load() {
    history.replaceState(null, '', href(selected));
    viewSelect.value = filters.view;
    const list = await get(`/inbox${qs(changed(filters, { ...defaults, view: '' }))}`);
    const filtered = Object.keys(changed(filters, defaults)).some((k) => k !== 'view' && k !== 'sort');
    items.replaceChildren(list.conversations.length
      ? h('ul', { class: 'list inbox__items' }, list.conversations.map((c) => h('li', null,
        h('a', { class: `inbox__item${c.conversation_id === selected ? ' is-active' : ''}${c.unread ? ' is-unread' : ''}`, href: href(c.conversation_id) },
          h('div', { class: 'inbox__item-top' },
            h('strong', null, c.guest_name),
            h('span', { class: 'muted small' }, shortWhen(c.last_message_at))),
          h('div', { class: 'small muted' }, `${c.unit_name} · ${fmtDate(c.check_in)} – ${fmtDate(c.check_out)}`),
          h('div', { class: 'inbox__preview' },
            c.last_direction === 'out' && h('span', { class: 'muted' }, 'You: '),
            c.last_direction === 'note' && h('span', { class: 'muted' }, 'Note: '),
            c.last_body || h('span', { class: 'muted' }, 'No messages yet')),
          h('div', { class: 'chips' },
            Number(c.failed_count) > 0 && badge('voided', 'Not sent'),
            Number(c.scheduled_count) > 0 && badge('unpaid', `${c.scheduled_count} scheduled`),
            c.assigned_name && h('span', { class: 'badge' }, c.assigned_name))))))
      : emptyState(filtered ? { title: 'No results found', text: 'Try removing a filter.' }
        : filters.view === 'open' ? { title: 'No conversations yet', text: 'Open a reservation and choose "Message guest" to start one. Guest replies show up here.' }
          : { title: 'Nothing here', text: 'Try another view.' }));
    el.querySelector('.inbox__back')?.setAttribute('href', href(null));
  }

  const bar = filterBar({
    key: 'inbox', values: filters, defaults, onChange: load,
    extra: viewSelect,
    search: { placeholder: 'Search guest, listing or code' },
    quick: [{ name: 'unread', label: 'Unread only', type: 'check' }],
    more: [
      { name: 'stay', label: 'Stay', all: 'Any stay', options: [['upcoming', 'Upcoming'], ['in_house', 'Staying now'], ['past', 'Checked out'], ['cancelled', 'Cancelled']] },
      { name: 'channel', label: 'Channel', all: 'All channels', options: Object.entries(CHANNEL_LABEL) },
      properties.length > 1 && { name: 'property_id', label: 'Property', all: 'All properties', options: properties.map((p) => [p.property_id, p.property_name]) },
      { name: 'unit_id', label: 'Listing', all: 'All listings', options: stUnits.map((u) => [u.unit_id, `${u.unit_name}${properties.length > 1 ? ` · ${u.property_name || ''}` : ''}`]) },
      assignees.length > 1 && { name: 'assigned', label: 'Assigned to', all: 'Anyone', options: [['unassigned', 'Not assigned'], ...assignees.map((a) => [a.user_id, a.full_name])] },
      { name: 'attention', label: 'Needs attention', all: 'Any', options: [['awaiting_reply', 'Guest wrote last'], ['failed', 'Message not sent'], ['scheduled', 'Has scheduled messages']] },
      { name: 'msg_from', label: 'Last message from', type: 'date' },
      { name: 'msg_to', label: 'Last message to', type: 'date' },
      { name: 'sort', label: 'Sort by', all: 'Unread first', options: [['recent', 'Latest message'], ['oldest', 'Oldest message'], ['check_in', 'Check-in date']] },
    ].filter(Boolean),
  });
  await load();

  const listPane = h('div', { class: `inbox__list card card--flush${selected ? ' inbox__list--hide-sm' : ''}` },
    h('div', { class: 'inbox__filters' }, bar),
    items);

  let threadPane;
  if (selected) {
    threadPane = h('div', { class: 'inbox__thread' }, h('div', { class: 'skeleton' }));
  } else {
    threadPane = h('div', { class: 'inbox__thread inbox__thread--empty card' },
      emptyState({ title: 'Select a conversation', text: 'Messages you send are emailed to the guest. Their replies come back here.', iconName: 'inbox' }));
  }

  el.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' }, h('h1', null, 'Inbox'),
        h('p', null, Number(counts.counts.unread) ? `${counts.counts.unread} unread` : 'Guest messages by email')),
      h('div', { class: 'page-head__actions' },
        h('a', { class: 'btn btn--secondary', href: '#/inbox-settings' }, 'Templates & automatic messages'))),
    h('div', { class: 'inbox-alerts' }, statusAlerts(status)),
    h('div', { class: `inbox${selected ? ' inbox--open' : ''}` }, listPane, threadPane));

  if (selected) {
    try {
      await renderThread(threadPane, selected, { status, back: href(null), rerender });
    } catch (err) {
      threadPane.replaceChildren(h('div', { class: 'card' }, emptyState({ title: err.status === 404 ? 'Not found' : "Couldn't load", text: err.message })));
    }
  }
}

// ---------------------------------------------------------------- thread
async function renderThread(pane, id, { status, back, rerender }) {
  const [{ conversation: c, messages }, { templates }, { assignees }] = await Promise.all([
    get(`/inbox/${id}`), get('/message-templates'), get('/inbox/assignees'),
  ]);

  const act = async (fn, msg) => {
    try { await fn(); if (msg) toast(msg); rerender(); } catch (err) { toast(err.message, 'error'); }
  };

  const snooze = () => {
    const tomorrow = new Date(Date.now() + 86400000);
    const opts = [
      ['3 hours', new Date(Date.now() + 3 * 3600000)],
      ['Tomorrow 9 AM', new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(tomorrow)}T09:00:00+08:00`)],
      ['Day before check-in', new Date(`${c.check_in}T09:00:00+08:00`)],
      ['1 week', new Date(Date.now() + 7 * 86400000)],
    ].map(([t, d]) => [t, new Date(d.getTime() - 86400000 * (t === 'Day before check-in' ? 1 : 0))]).filter(([, d]) => d > new Date());
    const m = openModal({
      title: 'Snooze until…',
      body: h('div', { class: 'stack' }, opts.map(([t, d]) => h('button', {
        class: 'btn btn--secondary btn--block',
        onclick: () => { m.close(); act(() => patch(`/inbox/${id}`, { snoozed_until: d.toISOString() }), `Snoozed until ${fmtDateTime(d)}.`); },
      }, `${t} · ${fmtDateTime(d)}`))),
    });
  };

  const header = h('div', { class: 'inbox__head' },
    h('a', { class: 'back inbox__back', href: back }, '‹ Inbox'),
    h('div', { class: 'inbox__head-main' },
      h('div', null,
        h('h2', null, c.guest_name),
        h('div', { class: 'small muted' }, `${c.unit_name} · ${fmtDate(c.check_in)} – ${fmtDate(c.check_out)}`)),
      h('div', { class: 'inbox__head-actions' },
        h('select', {
          class: 'input input--sm', 'aria-label': 'Assigned to',
          onchange: (e) => act(() => patch(`/inbox/${id}`, { assigned_to: e.target.value || null }), 'Assignment updated.'),
        }, h('option', { value: '' }, 'Unassigned'), assignees.map((a) => h('option', { value: a.user_id, selected: a.user_id === c.assigned_to }, a.full_name))),
        c.snoozed_until && new Date(c.snoozed_until) > new Date()
          ? h('button', { class: 'btn btn--secondary btn--sm', onclick: () => act(() => patch(`/inbox/${id}`, { snoozed_until: null }), 'Unsnoozed.') }, 'Unsnooze')
          : h('button', { class: 'btn btn--secondary btn--sm', onclick: snooze }, 'Snooze'),
        h('button', { class: 'btn btn--secondary btn--sm', onclick: () => act(() => patch(`/inbox/${id}`, { unread: true }), 'Marked as unread.') }, 'Mark unread'),
        c.status === 'open'
          ? h('button', { class: 'btn btn--secondary btn--sm', onclick: () => act(() => patch(`/inbox/${id}`, { status: 'archived' }), 'Archived.') }, 'Archive')
          : h('button', { class: 'btn btn--secondary btn--sm', onclick: () => act(() => patch(`/inbox/${id}`, { status: 'open' }), 'Moved to open.') }, 'Unarchive'))));

  const bubble = (m) => {
    const who = m.direction === 'in' ? (m.from_name || c.guest_name) : (m.sent_by_name || m.from_name || 'Automatic');
    let meta;
    if (m.status === 'scheduled') {
      meta = h('div', { class: 'msg__meta' }, `Scheduled for ${fmtDateTime(m.scheduled_at)} · `,
        h('button', { class: 'linkbtn', onclick: async () => {
          if (!await confirmDialog({ title: 'Cancel this scheduled message?', text: 'It will not be sent.', confirmText: 'Cancel message', danger: true })) return;
          act(() => post(`/inbox/messages/${m.message_id}/cancel`), 'Scheduled message cancelled.');
        } }, 'Cancel'));
    } else if (m.status === 'failed') {
      meta = h('div', { class: 'msg__meta msg__meta--err' }, `Not sent: ${m.error || 'unknown error'} · `,
        h('button', { class: 'linkbtn', onclick: () => act(async () => {
          const r = await post(`/inbox/messages/${m.message_id}/retry`);
          if (!r.ok) throw new Error(r.error || 'Still could not send it.');
        }, 'Sent.') }, 'Retry'));
    } else if (m.status === 'cancelled') {
      meta = h('div', { class: 'msg__meta' }, 'Cancelled (not sent)');
    } else {
      const kind = { automated: 'Automatic message', receipt: 'Receipt', confirmation: 'Booking confirmation' }[m.kind];
      meta = h('div', { class: 'msg__meta' },
        [who, m.direction === 'note' ? 'internal note' : null, kind, fmtDateTime(m.sent_at || m.created_at), m.direction === 'out' && m.to_email ? `to ${m.to_email}` : null].filter(Boolean).join(' · '));
    }
    return h('div', { class: `msg msg--${m.direction}${m.status === 'cancelled' ? ' msg--cancelled' : ''}` },
      m.direction === 'out' && m.subject && h('div', { class: 'msg__subject' }, m.subject),
      h('div', { class: 'msg__body' }, m.body),
      meta);
  };

  const thread = h('div', { class: 'inbox__messages', 'aria-live': 'polite' },
    messages.length ? messages.map(bubble) : h('p', { class: 'muted small center' }, 'No messages yet. Write the first one below.'));

  pane.replaceChildren(
    h('div', { class: 'card card--flush inbox__main' }, header, thread, composer(c, templates, status, rerender)),
    summary(c));
  thread.scrollTop = thread.scrollHeight;
}

function composer(c, templates, status, rerender) {
  let mode = 'message';
  const subject = h('input', { class: 'input input--sm', name: 'subject', maxlength: 200, placeholder: `Subject (default: ${c.subject})`, 'aria-label': 'Subject' });
  const body = h('textarea', { class: 'input', name: 'body', maxlength: 10000, placeholder: `Write to ${c.guest_name}…`, 'aria-label': 'Message' });
  const sendAt = h('input', { class: 'input input--sm', type: 'datetime-local', 'aria-label': 'Send later at' });
  const err = h('div', { class: 'error', role: 'alert' });
  const sendBtn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Send');
  const draftKey = `bh-draft:msg:${c.conversation_id}`;
  try { body.value = sessionStorage.getItem(draftKey) || ''; } catch { /* ignore */ }
  body.addEventListener('input', () => { try { sessionStorage.setItem(draftKey, body.value); } catch { /* ignore */ } });

  const tplSelect = h('select', {
    class: 'input input--sm', 'aria-label': 'Insert template',
    onchange: async (e) => {
      const tid = e.target.value;
      e.target.value = '';
      if (!tid) return;
      try {
        const r = await get(`/message-templates/${tid}/render${qs({ booking_id: c.booking_id })}`);
        subject.value = r.subject;
        body.value = r.body;
        body.dispatchEvent(new Event('input'));
        body.focus();
      } catch (ex) { toast(ex.message, 'error'); }
    },
  }, h('option', { value: '' }, 'Insert template…'), templates.map((t) => h('option', { value: t.template_id }, t.name)));

  const aiBtn = status.ai_drafts && h('button', {
    class: 'btn btn--secondary btn--sm', type: 'button',
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Drafting…';
      try {
        const r = await post(`/inbox/${c.conversation_id}/ai-draft`, { instructions: body.value.trim().slice(0, 500) });
        body.value = r.draft;
        body.dispatchEvent(new Event('input'));
        toast('Draft ready. Read it and edit before sending.');
      } catch (ex) { toast(ex.message, 'error'); } finally { btn.disabled = false; btn.textContent = '✨ Draft reply with AI'; }
    },
  }, '✨ Draft reply with AI');

  const modeTabs = h('div', { class: 'tabs tabs--compact', role: 'tablist' },
    [['message', 'Message guest'], ['note', 'Internal note']].map(([k, t]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(k === mode),
      onclick: (e) => {
        mode = k;
        modeTabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b === e.currentTarget)));
        form.classList.toggle('composer--note', mode === 'note');
        sendBtn.textContent = mode === 'note' ? 'Save note' : 'Send';
        body.placeholder = mode === 'note' ? 'Only your team sees notes.' : `Write to ${c.guest_name}…`;
      },
    }, t)));

  const noEmail = !c.guest_email && h('div', { class: 'alert alert--warn small' },
    'This guest has no email address yet. ', c.booking_id && h('a', { href: `#/reservations/${c.booking_id}` }, 'Open the reservation'), ' to add one, or save an internal note.');

  let busy = false;
  const form = h('form', {
    class: 'composer',
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      err.textContent = '';
      if (!body.value.trim()) { err.textContent = 'Write a message first.'; body.focus(); return; }
      busy = true;
      sendBtn.disabled = true;
      try {
        const payload = { body: body.value, note: mode === 'note' };
        if (mode === 'message') {
          if (subject.value.trim()) payload.subject = subject.value.trim();
          if (sendAt.value) payload.send_at = new Date(sendAt.value).toISOString();
        }
        const r = await post(`/inbox/${c.conversation_id}/messages`, payload);
        try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ }
        if (r.message.status === 'failed') toast(`Saved, but the email was not sent: ${r.message.error}`, 'error');
        else toast({ note: 'Note saved.', scheduled: `Scheduled for ${fmtDateTime(r.message.scheduled_at)}.`, sent: 'Sent.' }[r.message.status] || 'Saved.');
        rerender();
      } catch (ex) {
        err.textContent = ex.offline ? "You're offline. Your message is kept; try again when you're back online." : ex.message;
      } finally { busy = false; sendBtn.disabled = false; }
    },
  },
  h('div', { class: 'composer__top' }, modeTabs, h('div', { class: 'composer__tools' }, tplSelect, aiBtn)),
  noEmail,
  h('div', { class: 'composer__subject' }, subject),
  body,
  err,
  h('div', { class: 'composer__actions' },
    h('label', { class: 'composer__later small muted' }, 'Send later (optional) ', sendAt),
    sendBtn));
  return form;
}

function summary(c) {
  return h('aside', { class: 'card inbox__summary' },
    h('div', { class: 'card__head' }, h('h2', null, 'Reservation'), h('a', { href: `#/reservations/${c.booking_id}` }, 'Open')),
    h('div', { class: 'chips' }, stayLabel(c), h('span', { class: `badge badge--ch-${c.channel}` }, CHANNEL_LABEL[c.channel] || c.channel)),
    h('dl', { class: 'dl', style: { marginTop: '12px' } },
      h('dt', null, 'Listing'), h('dd', null, `${c.unit_name}, ${c.property_name}`),
      h('dt', null, 'Check-in'), h('dd', null, fmtDate(c.check_in)),
      h('dt', null, 'Check-out'), h('dd', null, fmtDate(c.check_out)),
      h('dt', null, 'Guests'), h('dd', null, c.num_guests ? String(c.num_guests) : '—'),
      h('dt', null, 'Total'), h('dd', null, peso(c.total_amount)),
      h('dt', null, 'Balance'), h('dd', { class: Number(c.balance) > 0 ? 'amount--neg' : '' }, peso(c.balance)),
      h('dt', null, 'Code'), h('dd', null, c.confirmation_code),
      h('dt', null, 'Email'), h('dd', null, c.guest_email || '—'),
      h('dt', null, 'Mobile'), h('dd', null, c.guest_phone ? h('a', { href: `tel:${c.guest_phone.replace(/[^\d+]/g, '')}` }, c.guest_phone) : '—')));
}

// Open (or start) the conversation for a reservation.
export async function messageGuest(bookingId, navigate) {
  try {
    const r = await post(`/reservations/${bookingId}/conversation`);
    navigate(`#/inbox/${r.conversation_id}`);
  } catch (err) { toast(err.message, 'error'); }
}

// ---------------------------------------------------------------- templates & automations
const TRIGGER_LABEL = {
  booking_created: 'When a reservation is created',
  before_check_in: 'Days before check-in',
  check_in_day: 'On check-in day',
  before_check_out: 'Days before check-out',
  after_check_out: 'Days after check-out',
};

function describeAutomation(a) {
  const t = a.send_time;
  switch (a.trigger_event) {
    case 'booking_created': return 'Right after a reservation is added (manually or from a channel)';
    case 'check_in_day': return `On check-in day at ${t}`;
    case 'before_check_in': return `${a.offset_days} day${a.offset_days === 1 ? '' : 's'} before check-in at ${t}`;
    case 'before_check_out': return `${a.offset_days} day${a.offset_days === 1 ? '' : 's'} before check-out at ${t}`;
    case 'after_check_out': return `${a.offset_days} day${a.offset_days === 1 ? '' : 's'} after check-out at ${t}`;
    default: return a.trigger_event;
  }
}

export async function inboxSettingsView(el, { rerender }) {
  const [{ templates, variables }, { automations, can_edit: canEdit, sending }] = await Promise.all([get('/message-templates'), get('/automations')]);

  // Templates apply to the whole workspace, so only the owner can change them.
  const canEditTemplates = state.user.role === 'owner';

  const editTemplate = (t) => formModal({
    title: t ? 'Edit template' : 'New template',
    submitText: 'Save template',
    fields: [
      field({ name: 'name', label: 'Template name', required: true, value: t?.name, maxlength: 80 }),
      field({ name: 'subject', label: 'Email subject', required: true, value: t?.subject, maxlength: 200 }),
      field({ name: 'body', label: 'Message', type: 'textarea', required: true, value: t?.body, maxlength: 5000 }),
      h('div', { class: 'hint' }, 'You can use these and they are filled in for each guest: ',
        variables.map((v) => h('code', { class: 'var' }, `{{${v}}}`))),
    ],
    onSubmit: async (d) => {
      if (t) await patch(`/message-templates/${t.template_id}`, d); else await post('/message-templates', d);
      toast('Template saved.');
      rerender();
    },
  });

  const archiveTemplate = async (t) => {
    if (!await confirmDialog({ title: `Delete "${t.name}"?`, text: 'Messages already sent are kept.', confirmText: 'Delete', danger: true })) return;
    try { await post(`/message-templates/${t.template_id}/archive`); toast('Template deleted.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };

  const editAutomation = (a) => {
    const modal = formModal({
      title: a ? 'Edit automatic message' : 'New automatic message',
      submitText: 'Save',
      fields: [
        field({ name: 'name', label: 'Name', required: true, value: a?.name, maxlength: 120 }),
        field({ name: 'template_id', label: 'Template to send', type: 'select', required: true, value: a?.template_id, options: templates.map((t) => [t.template_id, t.name]) }),
        field({ name: 'trigger_event', label: 'When', type: 'select', required: true, value: a?.trigger_event || 'before_check_in', placeholderOption: false, options: Object.entries(TRIGGER_LABEL) }),
        h('div', { class: 'form-row form-row--2' },
          field({ name: 'offset_days', label: 'Number of days', type: 'number', min: 0, max: 30, value: a?.offset_days ?? 1, inputmode: 'numeric' }),
          field({ name: 'send_time', label: 'Send at (Philippine time)', type: 'time', value: a?.send_time || '10:00' })),
        field({ name: 'enabled', label: 'Turned on', type: 'checkbox', value: a ? a.enabled : true }),
        h('p', { class: 'hint' }, 'Only guests with an email address get automatic messages. Turning one on never sends to stays whose time has already passed.'),
      ],
      onSubmit: async (d) => {
        d.offset_days = d.offset_days === '' ? 0 : Number(d.offset_days);
        if (a) await patch(`/automations/${a.automation_id}`, d); else await post('/automations', d);
        toast('Automatic message saved.');
        rerender();
      },
    });
    const form = modal.el.querySelector('form');
    const sync = () => {
      const tr = form.elements.trigger_event.value;
      form.querySelector('[data-field="offset_days"]').hidden = ['booking_created', 'check_in_day'].includes(tr);
      form.querySelector('[data-field="send_time"]').hidden = tr === 'booking_created';
    };
    form.elements.trigger_event.addEventListener('change', sync);
    sync();
  };

  const toggle = async (a, enabled) => {
    try { await patch(`/automations/${a.automation_id}`, { enabled }); toast(enabled ? 'Turned on.' : 'Turned off.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  const removeAutomation = async (a) => {
    if (!await confirmDialog({ title: `Delete "${a.name}"?`, text: 'Messages already sent are kept.', confirmText: 'Delete', danger: true })) return;
    try { await post(`/automations/${a.automation_id}/remove`); toast('Deleted.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };

  el.replaceChildren(
    h('a', { class: 'back', href: '#/inbox' }, '‹ Inbox'),
    h('div', { class: 'page-head' }, h('div', { class: 'page-head__title' }, h('h1', null, 'Templates & automatic messages'),
      h('p', null, 'Save replies you send often, and let BalayHub send the routine ones for you.'))),
    !sending && h('div', { class: 'alert alert--warn', style: { marginBottom: '16px' } }, 'Email sending is not set up on the server yet. Automatic messages will not go out until it is.'),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Automatic messages'),
        canEdit && h('button', { class: 'btn btn--primary btn--sm', onclick: () => editAutomation(null) }, icon('plus'), 'Add')),
      !canEdit && h('p', { class: 'muted small' }, 'Only the workspace owner can change these.'),
      automations.length ? h('ul', { class: 'list' }, automations.map((a) => h('li', null, h('div', { class: 'row' },
        h('div', { class: 'row__main' },
          h('span', { class: 'row__title' }, a.name),
          h('span', { class: 'row__sub' }, `${describeAutomation(a)} · sends "${a.template_name}"`),
          h('span', { class: 'row__sub' }, `${a.sent_count} sent so far`)),
        h('div', { class: 'row__end' },
          a.enabled ? badge('active', 'On') : badge('archived', 'Off'),
          canEdit && h('div', { class: 'chips' },
            h('button', { class: 'btn btn--secondary btn--sm', onclick: () => toggle(a, !a.enabled) }, a.enabled ? 'Turn off' : 'Turn on'),
            h('button', { class: 'btn btn--ghost btn--sm', onclick: () => editAutomation(a) }, 'Edit'),
            h('button', { class: 'btn btn--ghost btn--sm', onclick: () => removeAutomation(a) }, 'Delete')))))))
        : h('p', { class: 'muted small' }, 'No automatic messages yet.')),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Message templates'),
        canEditTemplates && h('button', { class: 'btn btn--primary btn--sm', onclick: () => editTemplate(null) }, icon('plus'), 'New template')),
      !canEditTemplates && h('p', { class: 'muted small' }, 'Only the workspace owner can change these.'),
      h('ul', { class: 'list' }, templates.map((t) => h('li', null, h('div', { class: 'row' },
        h('div', { class: 'row__main' },
          h('span', { class: 'row__title' }, t.name),
          h('span', { class: 'row__sub' }, t.subject)),
        canEditTemplates && h('div', { class: 'row__end chips' },
          h('button', { class: 'btn btn--ghost btn--sm', onclick: () => editTemplate(t) }, 'Edit'),
          !t.system_key && h('button', { class: 'btn btn--ghost btn--sm', onclick: () => archiveTemplate(t) }, 'Delete'))))))));
}
