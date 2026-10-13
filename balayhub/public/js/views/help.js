// Help & support: help articles, contacting BalayHub Support, and following a
// ticket from "Received" to "Resolved". Also the support queue for BalayHub's
// own platform admins.

import { get, post, qs, uploadFile } from '../api.js';
import {
  h, icon, fmtDateTime, badge, field, makeForm, emptyState, searchBox, pageHead, toast, confirmDialog, filesList, label } from '../ui.js';
import { state, navigate } from '../app.js';
import { currentTheme } from '../themeswitch.js';
import { assistantEnabled, openAssistant } from '../assistant.js';

const TOPICS = [
  ['question', 'Question — how do I…?'],
  ['problem', 'Something isn\'t working'],
  ['payments', 'Payments & billing'],
  ['account', 'Account & access'],
  ['feature', 'Suggestion or feature request'],
  ['other', 'Other'],
];
const STEPS = [['new', 'Received'], ['in_progress', 'In progress'], ['waiting_on_customer', 'Waiting for you'], ['resolved', 'Resolved']];
const STATUS_BADGE = { new: 'open', in_progress: 'in_progress', waiting_on_customer: 'partial', resolved: 'resolved', closed: 'voided' };
const statusBadge = (t, admin) => badge(STATUS_BADGE[t.status], admin && t.status === 'waiting_on_customer' ? 'Waiting on customer' : t.status_label);
const OPEN = ['new', 'in_progress', 'waiting_on_customer'];

function articleCard(a, open = false) {
  return h('details', { class: 'help-article', open },
    h('summary', null, a.title),
    h('div', { class: 'help-article__body' }, a.body.map((p) => h('p', null, p))));
}

// ---------------------------------------------------------------- help center
export async function helpView(el, { query }) {
  const filters = { q: query.q || '', view: query.view || 'open', tq: query.tq || '' };
  const { categories, articles } = await get('/help/articles');
  const articlesBox = h('div', { class: 'stack' });
  const ticketsBox = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist' });

  async function drawArticles() {
    if (filters.q) {
      const res = await get(`/help/articles${qs({ q: filters.q })}`);
      articlesBox.replaceChildren(h('div', { class: 'card' },
        h('div', { class: 'card__head' }, h('h2', null, `Results for “${filters.q}”`)),
        res.articles.length ? h('div', { class: 'help-list' }, res.articles.map((a, i) => articleCard(a, i === 0)))
          : emptyState({ iconName: 'help', title: 'No articles found', text: 'Try other words, or ask BalayHub Support.', action: h('a', { class: 'btn btn--primary', href: '#/help/new' }, 'Contact support') })));
      return;
    }
    articlesBox.replaceChildren(...categories.map((c) => {
      const list = articles.filter((a) => a.category === c.key);
      return list.length && h('div', { class: 'card' }, h('div', { class: 'card__head' }, h('h2', null, c.name)), h('div', { class: 'help-list' }, list.map((a) => articleCard(a))));
    }).filter(Boolean));
  }

  async function drawTickets() {
    tabs.replaceChildren(...[['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([v, t]) =>
      h('button', { role: 'tab', 'aria-selected': String(filters.view === v), onclick: () => { filters.view = v; sync(); drawTickets(); } }, t)));
    const { tickets } = await get(`/support/tickets${qs({ view: filters.view, q: filters.tq })}`);
    ticketsBox.replaceChildren(tickets.length
      ? h('ul', { class: 'list' }, tickets.map((t) => h('li', null, h('a', { class: 'row', href: `#/help/tickets/${t.ticket_id}` },
        h('div', { class: 'row__main' },
          h('span', { class: 'row__title' }, t.subject),
          h('span', { class: 'row__sub' }, `${t.number} · ${t.category_label} · updated ${fmtDateTime(t.updated_at)}`),
          state.user.role === 'owner' && t.created_by_name && h('span', { class: 'row__sub' }, `Opened by ${t.created_by_name}`)),
        h('div', { class: 'row__end' }, t.priority === 'urgent' && badge('urgent'), statusBadge(t))))))
      : h('p', { class: 'muted', style: { padding: '8px 2px' } }, filters.tq ? 'No tickets match your search.' : filters.view === 'open' ? 'No open tickets. If something is wrong, contact support and we’ll help.' : 'No tickets yet.'));
  }

  const sync = () => history.replaceState(null, '', `#/help${qs({ q: filters.q, view: filters.view === 'open' ? '' : filters.view, tq: filters.tq })}`);
  const articleSearch = searchBox({ value: filters.q, placeholder: 'Search help — e.g. connect Airbnb, refund, gate pass', onSearch: (q) => { filters.q = q; sync(); drawArticles(); } });
  articleSearch.classList.add('search--wide');
  const [aiOn] = await Promise.all([assistantEnabled(), drawArticles(), drawTickets()]);
  const askInput = h('input', { class: 'input', maxlength: 2000, placeholder: 'e.g. Paano i-connect ang Airbnb calendar ko?', 'aria-label': 'Ask the assistant' });
  const askCard = aiOn && h('form', { class: 'card help-ask', onsubmit: (e) => { e.preventDefault(); openAssistant(askInput.value.trim() || undefined); askInput.value = ''; } },
    h('div', { class: 'help-ask__title' }, icon('chat'), h('div', null, h('h2', null, 'Ask the BalayHub assistant'), h('p', { class: 'muted small' }, 'Instant answers in English, Tagalog or Taglish, any time.'))),
    h('div', { class: 'help-ask__row' }, askInput, h('button', { class: 'btn btn--primary', type: 'submit' }, 'Ask')));

  el.replaceChildren(
    pageHead({ title: 'Help & support', sub: 'Guides for every part of BalayHub, and a direct line to our team', actions: h('a', { class: 'btn btn--primary', href: '#/help/new' }, icon('plus'), 'Contact support') }),
    h('div', { class: 'help-hero card' },
      h('h2', null, 'How can we help?'),
      articleSearch,
      h('p', { class: 'muted small' }, 'Can’t find it? ', h('a', { href: '#/help/new' }, 'Open a support ticket'), ' — we usually reply within 1 business day.')),
    askCard,
    h('div', { class: 'grid grid--help' },
      articlesBox,
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, state.user.role === 'owner' ? 'Support tickets' : 'Your tickets')),
          tabs,
          h('div', { class: 'toolbar' }, searchBox({ value: filters.tq, placeholder: 'Search ticket subject or number', onSearch: (q) => { filters.tq = q; sync(); drawTickets(); } })),
          ticketsBox),
        h('div', { class: 'card help-howit' },
          h('div', { class: 'card__head' }, h('h2', null, 'How support works')),
          h('ol', { class: 'help-steps' },
            h('li', null, h('strong', null, 'Received. '), 'You get a ticket number by email right away.'),
            h('li', null, h('strong', null, 'In progress. '), 'Our team looks into it. Urgent tickets go first.'),
            h('li', null, h('strong', null, 'Waiting for you. '), 'If we need more details, we ask here and by email.'),
            h('li', null, h('strong', null, 'Resolved. '), 'Not fixed? Reply within 14 days and it reopens.'))))));
}

// ---------------------------------------------------------------- new ticket
export async function helpNewView(el, { query }) {
  const suggestBox = h('div', { class: 'help-suggest', 'aria-live': 'polite' });
  let t;
  const suggest = (text) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      if (text.trim().length < 4) { suggestBox.replaceChildren(); return; }
      try {
        const { articles } = await get(`/help/articles${qs({ q: text })}`);
        suggestBox.replaceChildren(articles.length ? h('div', { class: 'card card--soft' },
          h('p', { class: 'small' }, h('strong', null, 'These guides might answer it right away:')),
          h('div', { class: 'help-list' }, articles.slice(0, 3).map((a) => articleCard(a)))) : '');
      } catch { /* suggestions are optional */ }
    }, 400);
  };

  const screenshot = h('input', { type: 'file', class: 'input', accept: 'image/jpeg,image/png,image/webp,application/pdf', 'aria-label': 'Screenshot or file' });
  const subject = field({ name: 'subject', label: 'Subject', required: true, maxlength: 150, placeholder: 'e.g. Airbnb bookings not showing on my calendar', value: query.subject || '' });
  subject.querySelector('input').addEventListener('input', (e) => suggest(e.target.value));

  const form = makeForm({
    submitText: 'Send to support',
    draftKey: 'support-new',
    fields: [
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'category', label: 'Topic', type: 'select', required: true, value: query.topic || '', options: TOPICS }),
        field({ name: 'priority', label: 'How urgent?', type: 'select', required: true, value: 'normal', placeholderOption: false,
          options: [['normal', 'Normal'], ['urgent', 'Urgent — guests or payments affected now']] })),
      subject,
      suggestBox,
      field({ name: 'body', label: 'What happened?', type: 'textarea', required: true, maxlength: 8000,
        placeholder: 'What were you trying to do, what did you expect, and what happened instead? Include the reservation, listing or guest name if it’s about one.' }),
      h('div', { class: 'field' }, h('label', null, 'Screenshot (optional)'), screenshot,
        h('div', { class: 'hint' }, 'Please hide passwords and guests’ ID numbers before you send a screenshot.')),
      h('p', { class: 'muted small' }, 'We also send which page you came from, your browser and screen size, so we can see what you see.'),
    ],
    cancel: () => navigate('#/help'),
    onSubmit: async (data) => {
      const res = await post('/support/tickets', {
        ...data,
        context: {
          page: state.lastPage || '', browser: navigator.userAgent, screen: `${window.innerWidth}x${window.innerHeight}`,
          theme: currentTheme() === 'system' ? `system (${matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'})` : currentTheme(), language: navigator.language,
        },
      });
      if (screenshot.files[0]) {
        try { await uploadFile('support', res.ticket_id, screenshot.files[0]); } catch (err) { toast(`Ticket sent, but the screenshot didn't upload: ${err.message}`, 'error'); }
      }
      toast(`Ticket ${res.number} sent. We'll email you when we reply.`);
      navigate(`#/help/tickets/${res.ticket_id}`, { replace: true });
    },
  });
  // Handed over from the assistant chat.
  let prefill = null;
  try { prefill = JSON.parse(sessionStorage.getItem('bh-support-prefill')); sessionStorage.removeItem('bh-support-prefill'); } catch { /* ignore */ }
  if (prefill) {
    subject.querySelector('input').value = prefill.subject || '';
    form.querySelector('textarea[name=body]').value = prefill.body || '';
    if (!form.querySelector('select[name=category]').value) form.querySelector('select[name=category]').value = 'question';
  }
  if (query.subject || prefill?.subject) suggest(query.subject || prefill.subject);

  el.replaceChildren(
    pageHead({ title: 'Contact support', sub: 'Tell us what’s going on. You’ll get a ticket number and can follow every step here.', back: { href: '#/help', label: 'Help & support' } }),
    h('div', { class: 'card', style: { maxWidth: '720px' } }, form));
}

// ---------------------------------------------------------------- shared timeline
function progress(status) {
  const idx = status === 'closed' ? 3 : STEPS.findIndex(([k]) => k === status);
  return h('ol', { class: 'tracker', 'aria-label': 'Ticket progress' }, STEPS.map(([k, text], i) =>
    h('li', { class: `tracker__step${i < idx ? ' is-done' : ''}${i === idx ? ' is-current' : ''}`, 'aria-current': i === idx ? 'step' : null },
      h('span', { class: 'tracker__dot' }, i < idx ? '✓' : String(i + 1)), h('span', { class: 'tracker__label' }, text))));
}

function eventText(e) {
  switch (e.kind) {
    case 'created': return 'Ticket received';
    case 'status': return `${e.from_label || 'Status'} → ${e.to_label}${e.note ? ` · ${e.note}` : ''}`;
    case 'assigned': return `Picked up by ${e.actor_name || 'BalayHub Support'}`;
    case 'rated': return `Rated the help ${e.note}`;
    default: return e.note || e.kind;
  }
}

function timeline(messages, events) {
  const items = [
    ...messages.map((m) => ({ at: m.created_at, node: h('div', { class: `msg ${m.internal ? 'msg--note' : m.author_kind === 'support' ? 'msg--in' : 'msg--out'}` },
      h('div', { class: 'msg__body' }, m.body),
      h('div', { class: 'msg__meta' }, h('strong', null, m.internal ? `Internal note · ${m.author_name || 'Support'}` : (m.author_name || (m.author_kind === 'support' ? 'BalayHub Support' : 'Customer'))), ' · ', fmtDateTime(m.created_at))) })),
    ...events.map((e) => ({ at: e.created_at, node: h('div', { class: 'tl-event' }, h('span', { class: 'tl-event__dot', 'aria-hidden': 'true' }), h('span', null, eventText(e)), h('span', { class: 'muted' }, ` · ${fmtDateTime(e.created_at)}`)) })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));
  return h('div', { class: 'thread' }, items.map((i) => i.node));
}

function stars(onPick) {
  return h('div', { class: 'stars', role: 'radiogroup', 'aria-label': 'Rating' }, [1, 2, 3, 4, 5].map((n) =>
    h('button', { type: 'button', class: 'star', role: 'radio', 'aria-label': `${n} out of 5`, onclick: (e) => {
      e.currentTarget.parentNode.querySelectorAll('.star').forEach((s, i) => { s.classList.toggle('is-on', i < n); s.setAttribute('aria-checked', String(i + 1 === n)); });
      onPick(n);
    } }, '★')));
}

// ---------------------------------------------------------------- customer ticket
export async function helpTicketView(el, { params, rerender }) {
  const { ticket: t, messages, events, files } = await get(`/support/tickets/${params.id}`);
  const open = OPEN.includes(t.status);
  const canReply = open || t.can_reopen;

  const reply = h('textarea', { class: 'input', maxlength: 8000, rows: 4, 'aria-label': 'Your reply',
    placeholder: t.status === 'waiting_on_customer' ? 'Answer the question from support…' : t.status === 'resolved' ? 'Still not fixed? Reply here and we’ll reopen it.' : 'Add more details…' });
  const attach = h('input', { type: 'file', class: 'input', accept: 'image/jpeg,image/png,image/webp,application/pdf', 'aria-label': 'Attach a file' });
  const send = async (e) => {
    const btn = e.currentTarget;
    if (!reply.value.trim() && !attach.files[0]) { toast('Write a message or attach a file first.', 'error'); return; }
    btn.disabled = true;
    try {
      if (attach.files[0]) await uploadFile('support', t.ticket_id, attach.files[0]);
      if (reply.value.trim()) await post(`/support/tickets/${t.ticket_id}/reply`, { body: reply.value.trim() });
      toast(t.status === 'resolved' ? 'Ticket reopened. We’ll take another look.' : 'Sent to support.');
      rerender();
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  };

  let rating = 0;
  const ratingComment = h('input', { class: 'input', maxlength: 1000, placeholder: 'Anything we could do better? (optional)', 'aria-label': 'Comment' });
  const rateCard = !open && h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, t.rating ? 'Your rating' : 'How did we do?')),
    t.rating
      ? h('p', null, `${'★'.repeat(t.rating)}${'☆'.repeat(5 - t.rating)}`, t.rating_comment && h('span', { class: 'muted' }, ` · ${t.rating_comment}`))
      : h('div', { class: 'form' }, stars((n) => { rating = n; }), ratingComment,
        h('div', null, h('button', { class: 'btn btn--secondary btn--sm', onclick: async (e) => {
          if (!rating) { toast('Choose 1 to 5 stars.', 'error'); return; }
          e.currentTarget.disabled = true;
          try { await post(`/support/tickets/${t.ticket_id}/rate`, { rating, comment: ratingComment.value.trim() || null }); toast('Thanks for the feedback!'); rerender(); } catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; }
        } }, 'Send rating'))));

  el.replaceChildren(
    pageHead({
      title: t.subject, sub: `${t.number} · ${t.category_label} · opened ${fmtDateTime(t.created_at)}${t.created_by_name && state.user.role === 'owner' ? ` by ${t.created_by_name}` : ''}`,
      back: { href: '#/help', label: 'Help & support' },
      actions: open && h('button', { class: 'btn btn--secondary', onclick: async (e) => {
        if (!await confirmDialog({ title: 'Mark as solved?', text: 'Close this ticket because the problem is fixed? You can still reply within 14 days to reopen it.', confirmText: 'Yes, it’s solved', cancelText: 'Keep it open' })) return;
        e.target.disabled = true;
        try { await post(`/support/tickets/${t.ticket_id}/resolve`); toast('Marked as solved. Thank you!'); rerender(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
      } }, 'Mark as solved'),
    }),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Progress'), h('div', { class: 'chips' }, t.priority === 'urgent' && badge('urgent'), statusBadge(t))),
      progress(t.status),
      h('p', { class: 'muted small', style: { marginTop: '10px' } },
        { new: 'We received your ticket and will reply soon — usually within 1 business day.',
          in_progress: 'Our team is working on it. We’ll update you here and by email.',
          waiting_on_customer: 'We replied and need something from you. Please answer below.',
          resolved: t.can_reopen ? 'We marked this resolved. Not fixed? Reply below within 14 days and it reopens.' : 'This ticket is resolved.',
          closed: 'This ticket is closed. If you need more help, open a new ticket and mention this number.' }[t.status])),
    h('div', { class: 'grid grid--help' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Conversation')),
          timeline(messages, events),
          canReply ? h('div', { class: 'form', style: { marginTop: '14px' } }, reply, attach,
            h('div', null, h('button', { class: 'btn btn--primary', onclick: send }, t.status === 'resolved' ? 'Reply and reopen' : 'Send reply')))
            : h('div', { style: { marginTop: '14px' } }, h('a', { class: 'btn btn--secondary', href: `#/help/new${qs({ subject: `Follow-up on ${t.number}: ${t.subject}`.slice(0, 150) })}` }, 'Open a follow-up ticket')))),
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('div', { class: 'card__head' }, h('h2', null, 'Attachments')), filesList(files)),
        rateCard)));
}

// ---------------------------------------------------------------- BalayHub support queue
export async function adminSupportView(el, { query }) {
  if (!state.user.is_platform_admin) {
    el.replaceChildren(h('div', { class: 'card' }, emptyState({ title: 'Not found', text: "This page doesn't exist." })));
    return;
  }
  const filters = { status: query.status ?? 'open', category: query.category || '', priority: query.priority || '', mine: query.mine || '', q: query.q || '' };
  const listCard = h('div', { class: 'card card--flush' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const cat = h('select', { class: 'input', 'aria-label': 'Topic' }, h('option', { value: '' }, 'All topics'), TOPICS.map(([k, v]) => h('option', { value: k, selected: k === filters.category }, v.split(' — ')[0])));
  const pri = h('select', { class: 'input', 'aria-label': 'Priority' }, h('option', { value: '' }, 'Any priority'), h('option', { value: 'urgent', selected: filters.priority === 'urgent' }, 'Urgent only'));
  const mine = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: filters.mine === '1' }), h('span', null, 'Assigned to me'));
  cat.addEventListener('change', () => { filters.category = cat.value; load(); });
  pri.addEventListener('change', () => { filters.priority = pri.value; load(); });
  mine.querySelector('input').addEventListener('change', (e) => { filters.mine = e.target.checked ? '1' : ''; load(); });

  async function load() {
    history.replaceState(null, '', `#/admin/support${qs(filters)}`);
    const { tickets, counts } = await get(`/admin/support/tickets${qs(filters)}`);
    const n = (k) => (counts[k] ? ` (${counts[k]})` : '');
    tabs.replaceChildren(...[['open', 'All open'], ['new', `New${n('new')}`], ['in_progress', `In progress${n('in_progress')}`], ['waiting_on_customer', `Waiting on customer${n('waiting_on_customer')}`], ['resolved', 'Resolved'], ['closed', 'Closed'], ['', 'All']].map(([s, text]) =>
      h('button', { role: 'tab', 'aria-selected': String(filters.status === s), onclick: () => { filters.status = s; load(); } }, text)));
    listCard.replaceChildren(tickets.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Ticket', 'Workspace', 'Topic', 'Status', 'Assigned', 'Updated'].map((x) => h('th', null, x)))),
        h('tbody', null, tickets.map((t) => h('tr', { class: 'row-link', tabindex: 0, onclick: () => navigate(`#/admin/support/${t.ticket_id}`), onkeydown: (e) => { if (e.key === 'Enter') navigate(`#/admin/support/${t.ticket_id}`); } },
          h('td', null, h('strong', null, t.subject), h('div', { class: 'muted small' }, `${t.number} · ${t.created_by_name || '—'} · ${t.created_by_email || ''}`)),
          h('td', null, t.workspace),
          h('td', null, t.category_label),
          h('td', null, h('div', { class: 'chips' }, t.priority === 'urgent' && badge('urgent'), statusBadge(t, true))),
          h('td', null, t.assigned_name || h('span', { class: 'muted' }, 'Unassigned')),
          h('td', { class: 'small' }, fmtDateTime(t.updated_at)))))))
      : emptyState({ iconName: 'help', title: 'No tickets here', text: 'Nothing matches these filters.' }));
  }
  await load();
  el.replaceChildren(
    pageHead({ title: 'Support queue', sub: 'Tickets from every workspace. Urgent and new tickets are listed first.', back: { href: '#/admin', label: 'Platform admin' } }),
    h('div', { class: 'toolbar' }, searchBox({ value: filters.q, placeholder: 'Search subject, ticket no., workspace or email', onSearch: (q) => { filters.q = q; load(); } }), cat, pri, mine),
    tabs, listCard);
}

export async function adminSupportTicketView(el, { params, rerender }) {
  if (!state.user.is_platform_admin) {
    el.replaceChildren(h('div', { class: 'card' }, emptyState({ title: 'Not found', text: "This page doesn't exist." })));
    return;
  }
  const { ticket: t, messages, events, files, workspace } = await get(`/admin/support/tickets/${params.id}`);
  const body = h('textarea', { class: 'input', maxlength: 8000, rows: 5, 'aria-label': 'Reply', placeholder: 'Write to the customer, or an internal note…' });
  const internal = h('input', { type: 'checkbox' });
  const nextStatus = h('select', { class: 'input', 'aria-label': 'Status after sending' },
    h('option', { value: '' }, 'Status: automatic (waiting on customer)'),
    STEPS.concat([['closed', 'Closed']]).map(([k, v]) => h('option', { value: k }, `Set to: ${v}`)));
  const act = async (e, fn, msg) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await fn(); toast(msg); rerender(); } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  };
  const ctx = t.context || {};
  el.replaceChildren(
    pageHead({ title: t.subject, sub: `${t.number} · ${t.category_label} · ${workspace?.name || ''}`, back: { href: '#/admin/support', label: 'Support queue' },
      actions: [
        !t.assigned_to && h('button', { class: 'btn btn--secondary', onclick: (e) => act(e, () => post(`/admin/support/tickets/${t.ticket_id}/assign`), 'Assigned to you.') }, 'Assign to me'),
        OPEN.includes(t.status) && h('button', { class: 'btn btn--primary', onclick: (e) => act(e, () => post(`/admin/support/tickets/${t.ticket_id}/status`, { status: 'resolved' }), 'Marked resolved.') }, 'Mark resolved'),
      ] }),
    h('div', { class: 'card' }, h('div', { class: 'card__head' }, h('h2', null, 'Progress'), h('div', { class: 'chips' }, t.priority === 'urgent' && badge('urgent'), statusBadge(t, true))), progress(t.status)),
    h('div', { class: 'grid grid--help' },
      h('div', { class: 'card' },
        h('div', { class: 'card__head' }, h('h2', null, 'Conversation')),
        timeline(messages, events),
        h('div', { class: 'form', style: { marginTop: '14px' } }, body,
          h('div', { class: 'toolbar' }, h('label', { class: 'check' }, internal, h('span', null, 'Internal note (customer won’t see it)')), nextStatus),
          h('div', null, h('button', { class: 'btn btn--primary', onclick: (e) => {
            if (!body.value.trim()) { toast('Write a message first.', 'error'); return; }
            act(e, () => post(`/admin/support/tickets/${t.ticket_id}/reply`, { body: body.value.trim(), internal: internal.checked, ...(nextStatus.value ? { status: nextStatus.value } : {}) }),
              internal.checked ? 'Note saved.' : 'Reply sent to the customer.');
          } }, 'Send')))),
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Customer')),
          h('dl', { class: 'dl' },
            h('dt', null, 'Name'), h('dd', null, t.created_by_name || '—'),
            h('dt', null, 'Email'), h('dd', null, t.created_by_email || '—'),
            h('dt', null, 'Role'), h('dd', null, t.created_by_role ? label(t.created_by_role) : '—'),
            h('dt', null, 'Workspace'), h('dd', null, workspace ? `${workspace.name} · ${workspace.plan}` : '—'),
            h('dt', null, 'Page'), h('dd', null, ctx.page || '—'),
            h('dt', null, 'Screen'), h('dd', null, [ctx.screen, ctx.theme, ctx.language].filter(Boolean).join(' · ') || '—'),
            h('dt', null, 'Browser'), h('dd', { class: 'small' }, ctx.browser || '—'),
            h('dt', null, 'First reply'), h('dd', null, t.first_response_at ? fmtDateTime(t.first_response_at) : 'Not yet'),
            t.rating && [h('dt', null, 'Rating'), h('dd', null, `${t.rating}/5${t.rating_comment ? ` · ${t.rating_comment}` : ''}`)])),
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Attachments')),
          files.length ? h('div', { class: 'files' }, files.map((f) => h('a', { class: 'file-link', href: `/api/admin/support/files/${f.file_id}`, target: '_blank', rel: 'noopener' }, icon('file'), f.file_name)))
            : h('p', { class: 'muted small' }, 'No attachments.')),
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Change status')),
          h('div', { class: 'chips' }, STEPS.concat([['closed', 'Closed']]).filter(([k]) => k !== t.status).map(([k, v]) =>
            h('button', { class: 'btn btn--secondary btn--sm', onclick: (e) => act(e, () => post(`/admin/support/tickets/${t.ticket_id}/status`, { status: k }), `Moved to ${v}.`) }, v)))))));
}
