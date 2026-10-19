// BalayHub assistant: the chat button on every app page. Answers "how do I…?"
// questions from the help center, and hands off to a support ticket.

import { get, post } from './api.js';
import { h, icon } from './ui.js';
import { state, navigate } from './app.js';

const KEY = 'bh-assistant';
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || []; } catch { return []; } };
const save = (msgs) => { try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-40))); } catch { /* ignore */ } };

let enabled = null; // null = not checked yet
let panel = null;
// Clears the "Type a question first." message in the open panel; set when the panel is built.
let clearAskError = () => {};

export async function assistantEnabled() {
  // Cleaners are refused the assistant, so don't ask the server for them (rbac#4).
  if (state.user?.role === 'cleaner') return false;
  if (enabled === null) {
    try { enabled = (await get('/assistant')).enabled; } catch { enabled = false; }
  }
  return enabled;
}
export const resetAssistant = () => { enabled = null; panel?.remove(); panel = null; try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } };

const STARTERS = {
  owner: ['How do I connect my Airbnb calendar?', 'Paano mag-record ng bayad ng guest?', 'How do I invite my staff?', 'How do I send the gate pass to the condo admin?'],
  manager: ['How do I connect my Airbnb calendar?', 'Paano mag-record ng bayad ng guest?', 'How do automatic guest messages work?', 'How do I return a security deposit?'],
  staff: ['How do I mark a unit as cleaned?', 'Paano mag-record ng bayad ng guest?', 'Where do I see today’s check-ins?', 'How do I record a security deposit?'],
};
const STARTERS_LONG = ['How do I add a tenant and lease?', 'Paano mag-record ng bayad sa upa?', 'How do I see who is overdue?', 'How do I log a repair?'];

// Hand the chat over to a support ticket.
function toTicket(msgs) {
  const firstQ = msgs.find((m) => m.role === 'user')?.content || 'Question from the assistant chat';
  const transcript = msgs.map((m) => `${m.role === 'user' ? 'Me' : 'Assistant'}: ${m.content}`).join('\n\n');
  try {
    sessionStorage.setItem('bh-support-prefill', JSON.stringify({
      subject: firstQ.replace(/\s+/g, ' ').slice(0, 140),
      body: `I asked the BalayHub assistant but still need help.\n\n--- Chat ---\n${transcript}`.slice(0, 7900),
    }));
  } catch { /* ignore */ }
  closeAssistant();
  navigate('#/help/new');
}

export function closeAssistant() {
  if (!panel) return;
  const hadFocus = panel.contains(document.activeElement);
  panel.hidden = true;
  const fab = document.querySelector('.assist-fab');
  fab?.setAttribute('aria-expanded', 'false');
  if (hadFocus) fab?.focus(); // closing the panel gives focus back to the Ask button, not the page body
}

export function openAssistant(question) {
  if (!panel) panel = buildPanel();
  clearAskError();
  panel.hidden = false;
  document.querySelector('.assist-fab')?.setAttribute('aria-expanded', 'true');
  const input = panel.querySelector('textarea');
  if (question) { input.value = question; panel.querySelector('form').requestSubmit(); } else input.focus();
}

function buildPanel() {
  let msgs = load();
  let busy = false;
  const list = h('div', { class: 'assist__list', 'aria-live': 'polite' });
  const longTerm = state.user?.business_type === 'long_term';
  const input = h('textarea', { class: 'input', rows: 2, maxlength: 2000, placeholder: longTerm ? 'Ask anything, e.g. how do I record rent? (English or Tagalog)' : 'Ask anything about BalayHub… (English or Tagalog)', 'aria-label': 'Your question' });
  const sendBtn = h('button', { class: 'btn btn--primary', type: 'submit', 'aria-label': 'Send' }, 'Send');
  // Sits above the box, so an empty Send says what to do where the person is looking.
  const askError = h('div', { class: 'error', role: 'alert' });
  const askNote = h('div', { class: 'field', style: { padding: '0 12px' } }, askError);
  input.addEventListener('input', () => { askError.textContent = ''; });
  clearAskError = () => { askError.textContent = ''; };

  const bubble = (m) => h('div', { class: `assist__msg assist__msg--${m.role}` },
    h('div', { class: 'assist__text' }, m.content),
    m.articles?.length > 0 && h('div', { class: 'assist__articles' },
      h('div', { class: 'small muted' }, 'Related guides'),
      m.articles.map((a) => h('details', { class: 'help-article' }, h('summary', null, a.title), h('div', { class: 'help-article__body' }, a.body.map((p) => h('p', null, p)))))),
    m.offer_ticket && h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => toTicket(msgs) }, 'Contact support with this chat'),
    m.failed && h('div', { class: 'alert alert--error', role: 'alert' }, "Couldn't answer. ",
      h('button', { class: 'link-btn', type: 'button', style: { color: 'inherit' }, onclick: () => retry(m) }, 'Try again'), ' or ',
      h('button', { class: 'link-btn', type: 'button', style: { color: 'inherit' }, onclick: () => toTicket(msgs) }, 'contact support'), '.'));

  // Ask the same question again: take the failed bubble out and send it as a new question.
  const retry = (m) => { const i = msgs.indexOf(m); if (busy || i < 0) return; msgs.splice(i, 1); input.value = m.content; form.requestSubmit(); };

  function draw() {
    const starters = state.user.business_type === 'long_term' ? STARTERS_LONG : (STARTERS[state.user.role] || STARTERS.owner);
    list.replaceChildren(
      h('div', { class: 'assist__msg assist__msg--assistant' }, h('div', { class: 'assist__text' },
        `Hi ${state.user.full_name.split(' ')[0]}! I’m the BalayHub assistant. Ask me how to do anything in BalayHub — in English, Tagalog or Taglish.`)),
      !msgs.length && h('div', { class: 'assist__starters' }, starters.map((q) => h('button', { type: 'button', onclick: () => { input.value = q; form.requestSubmit(); } }, q))),
      ...msgs.map(bubble),
      busy && h('div', { class: 'assist__msg assist__msg--assistant assist__typing', role: 'status' }, h('span'), h('span'), h('span'), h('span', { class: 'sr-only' }, 'Thinking…')));
    list.scrollTop = list.scrollHeight;
  }

  const form = h('form', { class: 'assist__form', onsubmit: async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (busy) return;
    if (!q) { askError.textContent = 'Type a question first.'; input.focus(); return; }
    askError.textContent = '';
    const asked = { role: 'user', content: q };
    msgs.push(asked);
    input.value = '';
    busy = true; sendBtn.disabled = true; draw();
    try {
      // Failed questions stay on screen but are not sent back as history.
      const res = await post('/assistant/chat', { messages: msgs.filter((m) => !m.failed).map(({ role, content }) => ({ role, content })), page: location.hash.split('?')[0] });
      msgs.push({ role: 'assistant', content: res.reply, articles: res.articles, offer_ticket: res.offer_ticket });
    } catch {
      // Keep the question in the chat with an inline note, so it isn't lost.
      asked.failed = true;
    } finally {
      busy = false; sendBtn.disabled = false; save(msgs); draw(); input.focus();
    }
  } }, input, sendBtn);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });

  const el = h('section', { class: 'assist', role: 'dialog', 'aria-label': 'BalayHub assistant' },
    h('header', { class: 'assist__head' },
      h('div', null, h('strong', null, 'BalayHub assistant'), h('div', { class: 'small' }, 'Answers from the BalayHub guides')),
      h('div', { class: 'assist__actions' },
        h('button', { type: 'button', class: 'assist__icon', title: 'New chat', 'aria-label': 'New chat', onclick: () => { msgs = []; save(msgs); clearAskError(); draw(); input.focus(); } }, icon('plus')),
        h('button', { type: 'button', class: 'assist__icon', title: 'Close', 'aria-label': 'Close', onclick: closeAssistant }, '×'))),
    list,
    askNote,
    form,
    h('p', { class: 'assist__foot' }, longTerm ? 'It can’t see your tenants, leases or rent records and may make mistakes. ' : 'It can’t see your bookings or guests and may make mistakes. ',
      h('a', { href: '#/help/new', onclick: (e) => { e.preventDefault(); if (msgs.length) toTicket(msgs); else { closeAssistant(); navigate('#/help/new'); } } }, 'Talk to a person')));
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAssistant(); });
  draw();
  document.body.append(el);
  return el;
}

// The Ask button, added to the app shell. Below 960px it sits in the top bar (the slot app.js leaves for it), so it never covers
// page content on a phone. From 960px up it floats over the page.
const PHONE = '(max-width: 959px)';

export function assistantButton() {
  const btn = h('button', { class: 'assist-fab', type: 'button', 'aria-label': 'Ask the BalayHub assistant', 'aria-expanded': 'false', hidden: true,
    onclick: () => (panel && !panel.hidden ? closeAssistant() : openAssistant()) }, icon('chat'), h('span', null, 'Ask'));
  assistantEnabled().then((on) => { btn.hidden = !on; });
  return btn;
}

// Moves the button into the top bar on a phone, and back into the shell above that. Called once the shell is on the page.
export function placeAssistantButton() {
  const btn = document.querySelector('.assist-fab');
  if (!btn) return;
  const slot = document.querySelector('.topbar__assist');
  const inBar = Boolean(slot && globalThis.matchMedia?.(PHONE).matches);
  btn.classList.toggle('assist-fab--bar', inBar);
  (inBar ? slot : document.querySelector('.shell'))?.append(btn);
}
// Keep the button in the right place when the window crosses the phone width.
globalThis.matchMedia?.(PHONE).addEventListener('change', placeAssistantButton);
