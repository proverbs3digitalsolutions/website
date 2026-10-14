// Guest inbox: conversation list, thread with composer, reservation summary;
// plus message templates and automatic messages.

import { get, post, patch, qs } from '../api.js';
import {
  h, icon, peso, fmtDate, fmtDateTime, badge, field, formModal, confirmDialog, emptyState, toast, openModal, todayManila,
} from '../ui.js';
import { state, navigate } from '../app.js';
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

// The header line and the view menu counts. Opening a thread redraws them from the server's counts.
const unreadText = (n) => (Number(n) ? `${n} unread` : 'Guest messages by email');
const viewLabel = ([k, t], counts) => `${t}${Number(counts[k]) ? ` (${counts[k]})` : ''}`;

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
  // A listing or property the workspace doesn't have (an old or edited link) is dropped here, so no chip shows a raw id.
  if (!stUnits.some((u) => u.unit_id === filters.unit_id)) filters.unit_id = '';
  if (!properties.some((p) => p.property_id === filters.property_id)) filters.property_id = '';
  // Two listings can share a name; only those get the property added, so the dropdown and its chip stay short.
  const repeated = new Set(stUnits.map((u) => u.unit_name).filter((n, i, all) => all.indexOf(n) !== i));
  const items = h('div');
  const viewSelect = h('select', { class: 'input input--sm', 'aria-label': 'Show' },
    VIEWS.map(([k, t]) => h('option', { value: k, selected: k === filters.view }, viewLabel([k, t], counts.counts))));
  viewSelect.addEventListener('change', () => { filters.view = viewSelect.value; rememberFilters('inbox', filters); load(); });
  const unreadLine = h('p', null, unreadText(counts.counts.unread));

  async function load() {
    history.replaceState(null, '', href(selected));
    viewSelect.value = filters.view;
    el.querySelector('.inbox__back')?.setAttribute('href', href(null));
    let list;
    try {
      list = await get(`/inbox${qs(changed(filters, { ...defaults, view: '' }))}`);
    } catch (err) {
      // A bad filter in the address must not replace the whole page; the filter bar stays so it can be cleared.
      items.replaceChildren(emptyState({ title: "Couldn't load conversations", text: err.message }));
      return;
    }
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
            previewText(c.last_body) || h('span', { class: 'muted' }, 'No messages yet')),
          h('div', { class: 'chips' },
            Number(c.failed_count) > 0 && badge('voided', 'Not sent'),
            Number(c.scheduled_count) > 0 && badge('unpaid', `${c.scheduled_count} scheduled`),
            c.assigned_name && h('span', { class: 'badge' }, c.assigned_name))))))
      : emptyState(filtered ? { title: 'No results found', text: 'Try removing a filter.' }
        : filters.view === 'open' ? { title: 'No conversations yet', text: 'Open a reservation and choose "Message guest" to start one. Guest replies show up here.' }
          : { title: 'Nothing here', text: 'Try another view.' }));
  }

  // Opening a thread reads it on the server, so redraw what still shows it as unread: its row, the header
  // line, the view counts and the menu badge. If the count request fails, the next page load catches up.
  async function refreshCounts() {
    items.querySelector('.inbox__item.is-active')?.classList.remove('is-unread');
    const counts = await get('/inbox/counts').then((r) => r.counts, () => null);
    if (!counts) return;
    const n = Number(counts.unread) || 0;
    unreadLine.textContent = unreadText(counts.unread);
    VIEWS.forEach(([k, t], i) => { viewSelect.options[i].textContent = viewLabel([k, t], counts); });
    document.querySelectorAll('a[href="#/inbox"] .navbadge').forEach((b) => {
      if (n) { b.textContent = n > 99 ? '99+' : String(n); b.setAttribute('aria-label', `${n} unread`); } else b.remove();
    });
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
      { name: 'unit_id', label: 'Listing', all: 'All listings', options: stUnits.map((u) => [u.unit_id, repeated.has(u.unit_name) ? `${u.unit_name} · ${u.property_name || ''}` : u.unit_name]) },
      assignees.length > 1 && { name: 'assigned', label: 'Assigned to', all: 'Anyone', options: [['unassigned', 'Not assigned'], ...assignees.map((a) => [a.user_id, a.full_name])] },
      { name: 'attention', label: 'Needs attention', all: 'Any', options: [['awaiting_reply', 'Guest wrote last'], ['failed', 'Message not sent'], ['scheduled', 'Has scheduled messages']] },
      { name: 'msg', keys: ['msg_from', 'msg_to'], label: 'Last message between', type: 'daterange' },
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
      h('div', { class: 'page-head__title' }, h('h1', null, 'Inbox'), unreadLine),
      h('div', { class: 'page-head__actions' },
        h('a', { class: 'btn btn--secondary', href: '#/inbox-settings' }, 'Templates & automatic messages'))),
    h('div', { class: 'inbox-alerts' }, statusAlerts(status)),
    h('div', { class: `inbox${selected ? ' inbox--open' : ''}` }, listPane, threadPane));

  if (selected) {
    try {
      await renderThread(threadPane, selected, { status, back: href(null), rerender });
      await refreshCounts();
    } catch (err) {
      threadPane.replaceChildren(h('div', { class: 'card' }, emptyState({ title: err.status === 404 ? 'Not found' : "Couldn't load", text: err.message })));
    }
  }
}

// ---------------------------------------------------------------- thread
async function renderThread(pane, id, { status, back, rerender }) {
  const [{ conversation: c, messages }, { templates }, { assignees }] = await Promise.all([
    get(`/inbox/${id}`), get('/message-templates'), get(`/inbox/assignees${qs({ conversation_id: id })}`),
  ]);

  const act = async (fn, msg) => {
    try { await fn(); if (msg) toast(msg); rerender(); } catch (err) { toast(err.message, 'error'); }
  };

  // The server refuses an assignee who can't see this reservation; show why and put the dropdown back.
  const assign = async (e) => {
    try { await patch(`/inbox/${id}`, { assigned_to: e.target.value || null }); toast('Assignment updated.'); } catch (err) { toast(err.fields.assigned_to || err.message, 'error'); }
    rerender();
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

  // Back to the list, not the thread: re-opening the thread would mark it read again.
  const markUnread = async () => {
    try { await patch(`/inbox/${id}`, { unread: true }); toast('Marked as unread.'); navigate(back, { replace: true }); } catch (err) { toast(err.message, 'error'); }
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
          onchange: assign,
        }, h('option', { value: '' }, 'Unassigned'), c.assigned_to && !assignees.some((a) => a.user_id === c.assigned_to) && h('option', { value: c.assigned_to, selected: true }, c.assigned_name), assignees.map((a) => h('option', { value: a.user_id, selected: a.user_id === c.assigned_to }, a.full_name))),
        c.snoozed_until && new Date(c.snoozed_until) > new Date()
          ? h('button', { class: 'btn btn--secondary btn--sm', onclick: () => act(() => patch(`/inbox/${id}`, { snoozed_until: null }), 'Unsnoozed.') }, 'Unsnooze')
          : h('button', { class: 'btn btn--secondary btn--sm', onclick: snooze }, 'Snooze'),
        h('button', { class: 'btn btn--secondary btn--sm', onclick: markUnread }, 'Mark unread'),
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
      messageBody(m),
      meta);
  };

  const thread = h('div', { class: 'inbox__messages', tabindex: '0', role: 'region', 'aria-label': 'Conversation messages', 'aria-live': 'polite' },
    messages.length ? messages.map(bubble) : h('p', { class: 'muted small center' }, 'No messages yet. Write the first one below.'));

  pane.replaceChildren(
    h('div', { class: 'card card--flush inbox__main' }, header, thread, composer(c, templates, status, rerender, assignees)),
    summary(c));
  thread.scrollTop = thread.scrollHeight;
}

// Very long messages show their first part with a "Show more" button.
const LONG_MESSAGE = 1200;
const PREVIEW_LENGTH = 800;
function messageBody(m) {
  const full = String(m.body ?? '');
  const show = (t) => (m.direction === 'note' ? renderMentions(t) : t);
  const box = h('div', { class: 'msg__body' }, show(full));
  if (full.length <= LONG_MESSAGE) return box;
  let open = false;
  const toggle = h('button', { class: 'linkbtn', type: 'button', 'aria-expanded': 'false' });
  const paint = () => {
    box.replaceChildren(...[show(open ? full : `${full.slice(0, PREVIEW_LENGTH)}…`)].flat());
    toggle.textContent = open ? 'Show less' : 'Show more';
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => { open = !open; paint(); });
  paint();
  return h('div', null, box, toggle);
}

// The chosen composer mode for each conversation, kept across the re-render after every save
// (otherwise the next internal note would go to the guest).
const composerModes = new Map();

// "@[Full Name](user_id)" shows as a highlighted "@Full Name"; the stored text stays as typed.
// Same pattern as MENTION_RE in src/routes/inbox.js, so only mentions the server saved are highlighted.
const MENTION = /@\[([^\]\n]{1,120})\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;
function renderMentions(text) {
  const out = [];
  let last = 0;
  String(text ?? '').replace(MENTION, (m, name, _id, idx) => {
    if (idx > last) out.push(text.slice(last, idx));
    out.push(h('span', { class: 'mention' }, `@${name}`));
    last = idx + m.length;
    return m;
  });
  if (!out.length) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// The list preview shows a mention as "@Name" with no user id.
export function previewText(text) {
  return String(text ?? '').replace(MENTION, (_m, name) => `@${name}`);
}

// Typing "@" in the note box lists teammates; arrows + Enter pick, Esc closes.
function mentionPicker(body, people) {
  const list = h('ul', { class: 'mention-list', role: 'listbox', id: `ml-${Math.random().toString(36).slice(2, 7)}`, 'aria-label': 'Team members', hidden: true });
  let items = []; let active = 0; let start = -1;
  const close = () => { list.hidden = true; items = []; start = -1; body.removeAttribute('aria-activedescendant'); };
  const mark = () => {
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    if (list.children[active]) body.setAttribute('aria-activedescendant', list.children[active].id);
  };
  const pick = (p) => {
    const caret = body.selectionStart;
    const ins = `@[${p.full_name}](${p.user_id}) `;
    body.value = body.value.slice(0, start) + ins + body.value.slice(caret);
    const pos = start + ins.length;
    body.setSelectionRange(pos, pos);
    close();
    body.dispatchEvent(new Event('input'));
    body.focus();
  };
  const update = () => {
    const before = body.value.slice(0, body.selectionStart);
    const m = /(^|\s)@([^@\n[\]]{0,30})$/.exec(before);
    if (!m || !body.closest('.composer--note')) return close();
    const q = m[2].toLowerCase();
    items = people.filter((p) => p.full_name.toLowerCase().includes(q)).slice(0, 6);
    if (!items.length) return close();
    start = before.length - m[2].length - 1;
    active = Math.min(active, items.length - 1);
    list.replaceChildren(...items.map((p, i) => h('li', {
      role: 'option', id: `${list.id}-${i}`, class: 'mention-list__item',
      onmousedown: (e) => { e.preventDefault(); pick(p); },
    }, p.full_name)));
    list.hidden = false;
    mark();
  };
  body.setAttribute('aria-controls', list.id);
  body.addEventListener('input', () => { active = 0; update(); });
  body.addEventListener('click', update);
  body.addEventListener('blur', close);
  body.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; mark(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  return { list, close };
}

// A template goes below the typed message. Null when the result would be over the message limit, so nothing is added part way.
export function insertBelow(typed, templateBody) {
  const head = String(typed ?? '').trimEnd();
  const next = head ? `${head}\n\n${templateBody}` : templateBody;
  return next.length > 10000 ? null : next;
}

function composer(c, templates, status, rerender, assignees = []) {
  let mode = composerModes.get(c.conversation_id) || 'message';
  const subject = h('input', { class: 'input input--sm', name: 'subject', maxlength: 200, placeholder: `Subject (default: ${c.subject})`, 'aria-label': 'Subject' });
  const body = h('textarea', { class: 'input', name: 'body', maxlength: 10000, placeholder: `Write to ${c.guest_name}…`, 'aria-label': 'Message' });
  const counter = h('div', { class: 'small muted', hidden: true });
  const updateCounter = () => {
    const left = 10000 - body.value.length;
    counter.hidden = left > 1000;
    counter.textContent = left <= 0 ? 'Limit reached: 10,000 characters. Anything longer is cut off.' : `${left.toLocaleString('en-US')} characters left`;
  };
  body.addEventListener('input', updateCounter);
  const errId = `cerr-${c.conversation_id}`;
  const sendAt = h('input', { class: 'input input--sm', type: 'datetime-local', 'aria-label': 'Send later at', 'aria-describedby': errId });
  const err = h('div', { class: 'error', role: 'alert', id: errId });
  // Typing, or changing or clearing the send-later time, drops a stale error so it doesn't sit on screen.
  body.addEventListener('input', () => { err.textContent = ''; });
  ['input', 'change'].forEach((ev) => sendAt.addEventListener(ev, () => { sendAt.removeAttribute('aria-invalid'); err.textContent = ''; }));
  const modeHint = h('div', { class: 'small muted', role: 'status' });
  const sendBtn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Send');
  const draftKey = `bh-draft:msg:${c.conversation_id}`;
  try { body.value = sessionStorage.getItem(draftKey) || ''; } catch { /* ignore */ }
  updateCounter();
  body.addEventListener('input', () => { try { sessionStorage.setItem(draftKey, body.value); } catch { /* ignore */ } });
  // The subject is kept the same way, so switching conversations doesn't lose it.
  const subjKey = `bh-draft:subj:${c.conversation_id}`;
  try { subject.value = sessionStorage.getItem(subjKey) || ''; } catch { /* ignore */ }
  subject.addEventListener('input', () => { try { sessionStorage.setItem(subjKey, subject.value); } catch { /* ignore */ } });

  const tplSelect = h('select', {
    class: 'input input--sm', 'aria-label': 'Insert template',
    onchange: async (e) => {
      const tid = e.target.value;
      e.target.value = '';
      if (!tid) return;
      try {
        const r = await get(`/message-templates/${tid}/render${qs({ booking_id: c.booking_id })}`);
        // The template goes below what the host has typed, and a subject they typed is kept. Too long to fit: add nothing.
        const next = insertBelow(body.value, r.body);
        if (next === null) { toast('Adding this template would go over the 10,000-character limit.', 'error'); return; }
        if (body.value.trim()) toast('Template added below your message.');
        body.value = next;
        if (!subject.value.trim()) subject.value = r.subject;
        body.dispatchEvent(new Event('input'));
        subject.dispatchEvent(new Event('input'));
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

  const picker = mentionPicker(body, assignees);
  const modeTabs = h('div', { class: 'tabs tabs--compact', role: 'tablist' },
    [['message', 'Message guest'], ['note', 'Internal note']].map(([k, t]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(k === mode),
      onclick: () => setMode(k),
    }, t)));
  const setMode = (k) => {
    mode = k;
    composerModes.set(c.conversation_id, k);
    [...modeTabs.children].forEach((b, i) => b.setAttribute('aria-selected', String(i === (k === 'note' ? 1 : 0))));
    form.classList.toggle('composer--note', mode === 'note');
    sendBtn.textContent = mode === 'note' ? 'Save note' : 'Send';
    if (mode !== 'note') picker.close();
    body.placeholder = mode === 'note' ? 'Only your team sees notes.' : `Write to ${c.guest_name}…`;
    modeHint.textContent = mode === 'note' ? 'Internal note: only your team sees this. It is not emailed to the guest.' : c.guest_email ? `This will be emailed to ${c.guest_name}.` : 'Add an email address before you can send this.';
  };

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
      if (mode === 'message' && /@\[[^\]\n]+\]\([0-9a-f-]{36}\)|\{\{[^}\n]*\}\}/i.test(body.value)
        && !await confirmDialog({
          title: 'Send this to the guest?',
          text: 'The message contains internal mention text (@[Name](id)) or an unfilled {{variable}}. The guest will see it exactly as typed.',
          confirmText: 'Send anyway',
        })) return;
      // A send-later time that has already passed would go out at once with no warning; ask first.
      let scheduleFor = mode === 'message' && sendAt.value ? new Date(sendAt.value) : null;
      if (scheduleFor && scheduleFor <= new Date()) {
        if (!await confirmDialog({ title: 'That time has passed. Send it now?', text: 'The message goes out straight away instead of at the time you picked.', confirmText: 'Send now' })) return;
        scheduleFor = null;
      }
      busy = true;
      sendBtn.disabled = true;
      try {
        const payload = { body: body.value, note: mode === 'note' };
        if (mode === 'message') {
          if (subject.value.trim()) payload.subject = subject.value.trim();
          if (scheduleFor) payload.send_at = scheduleFor.toISOString();
        }
        const r = await post(`/inbox/${c.conversation_id}/messages`, payload);
        try { sessionStorage.removeItem(draftKey); sessionStorage.removeItem(subjKey); } catch { /* ignore */ }
        if (r.message.status === 'failed') toast(`Saved, but the email was not sent: ${r.message.error}`, 'error');
        else if (r.mentions.length) toast(`Note saved. ${r.mentions.map((x) => x.full_name).join(', ')} mentioned.`);
        else toast({ note: 'Note saved.', scheduled: `Scheduled for ${fmtDateTime(r.message.scheduled_at)}.`, sent: 'Sent.' }[r.message.status] || 'Saved.');
        rerender();
      } catch (ex) {
        err.textContent = ex.offline ? "You're offline. Your message is kept; try again when you're back online." : (ex.fields.body || ex.fields.send_at || ex.message);
        if (ex.fields?.send_at) { sendAt.setAttribute('aria-invalid', 'true'); sendAt.focus(); }
      } finally { busy = false; sendBtn.disabled = false; }
    },
  },
  h('div', { class: 'composer__top' }, modeTabs, h('div', { class: 'composer__tools' }, tplSelect, aiBtn)),
  noEmail,
  h('div', { class: 'composer__subject' }, subject),
  h('div', { class: 'composer__body' }, body, picker.list),
  counter,
  modeHint,
  err,
  h('div', { class: 'composer__actions' },
    h('label', { class: 'composer__later small muted' }, 'Send later (optional) ', sendAt),
    sendBtn));
  setMode(mode);
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

// The day count sent with an automatic message. The two triggers that don't use a count always store 0, whatever the
// hidden box holds. On the before and after triggers a blank count goes as null, so the server refuses it.
export function daysToSend(trigger, days) {
  if (['booking_created', 'check_in_day'].includes(trigger)) return 0;
  return days === '' ? null : days;
}

export function describeAutomation(a) {
  const t = a.send_time;
  const n = a.offset_days;
  const days = `${n} day${n === 1 ? '' : 's'}`;
  switch (a.trigger_event) {
    case 'booking_created': return 'Right after a reservation is added (manually or from a channel)';
    case 'check_in_day': return `On check-in day at ${t}`;
    // Zero days is the day itself; "0 days before" reads oddly.
    case 'before_check_in': return n ? `${days} before check-in at ${t}` : `On check-in day at ${t}`;
    case 'before_check_out': return n ? `${days} before check-out at ${t}` : `On check-out day at ${t}`;
    case 'after_check_out': return n ? `${days} after check-out at ${t}` : `On check-out day at ${t}`;
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
          field({ name: 'send_time', label: 'Send at (Philippine time)', type: 'time', value: a?.send_time || '10:00', hint: 'Leave blank for 10:00.' })),
        field({ name: 'enabled', label: 'Turned on', type: 'checkbox', value: a ? a.enabled : true }),
        h('p', { class: 'hint' }, 'Only guests with an email address get automatic messages. Turning one on never sends to stays whose time has already passed.'),
      ],
      onSubmit: async (d) => {
        d.offset_days = daysToSend(d.trigger_event, d.offset_days);
        // A blank send time means 10:00, as the form says.
        d.send_time = d.send_time || '10:00';
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
      automations.length ? h('ul', { class: 'list' }, automations.map((a) => h('li', null, h('div', { class: 'row row--stack-sm' },
        h('div', { class: 'row__main' },
          h('span', { class: 'row__title' }, a.name),
          h('span', { class: 'row__sub' }, `${describeAutomation(a)} · sends "${a.template_name}"`),
          h('span', { class: 'row__sub' }, `${a.sent_count} sent so far`)),
        h('div', { class: 'row__end' },
          a.enabled ? badge('active', 'On') : badge('archived', 'Off'),
          canEdit && h('div', { class: 'chips' },
            h('button', { class: 'btn btn--secondary btn--sm', 'aria-label': `${a.enabled ? 'Turn off' : 'Turn on'} automatic message: ${a.name}`, onclick: () => toggle(a, !a.enabled) }, a.enabled ? 'Turn off' : 'Turn on'),
            h('button', { class: 'btn btn--ghost btn--sm', 'aria-label': `Edit automatic message: ${a.name}`, onclick: () => editAutomation(a) }, 'Edit'),
            h('button', { class: 'btn btn--ghost btn--sm', 'aria-label': `Delete automatic message: ${a.name}`, onclick: () => removeAutomation(a) }, 'Delete')))))))
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
          h('button', { class: 'btn btn--ghost btn--sm', 'aria-label': `Edit template: ${t.name}`, onclick: () => editTemplate(t) }, 'Edit'),
          !t.system_key && h('button', { class: 'btn btn--ghost btn--sm', 'aria-label': `Delete template: ${t.name}`, onclick: () => archiveTemplate(t) }, 'Delete'))))))));
}
