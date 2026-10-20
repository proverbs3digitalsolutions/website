// Daily close: an end-of-day checklist for owners and managers (D-72).

import { get, post, qs } from '../api.js';
import { h, peso, fmtDate, fmtDateTime, field, formModal, emptyState, toast, todayManila, confirmDialog } from '../ui.js';
import { addDays } from './reservations.js';

// The line under a stored close that the viewer cannot change (closed.whole_workspace says which kind of close it is).
export const lockedCloseText = (closed) => (closed.whole_workspace
  ? 'This day was closed for the whole workspace. Only an owner can change it.'
  : "This day was closed for properties you don't all manage. Only an owner or the manager who covers them all can change it.");

const METHOD = { cash: 'Cash', bank_transfer: 'Bank transfer', gcash: 'GCash', maya: 'Maya', card: 'Card', channel_payout: 'Channel payout', other: 'Other' };

// A YYYY-MM-DD string that names a real calendar day in 2000 to 2100, the range the server accepts (2027-02-29, 2026-02-30 and 1900-01-01 do not).
function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s < '2000-01-01' || s > '2100-12-31') return false;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === s;
}

// Checks the day a page was opened with before anything is loaded, so the server never refuses it.
// Missing means today. A date after tomorrow is clamped to tomorrow; a date that is not real falls back to today.
// The message says which happened, shown inline on the page.
export function closeDayFor(raw, today = todayManila()) {
  const tomorrow = addDays(today, 1);
  if (!raw) return { date: today, message: null };
  if (!isRealDate(raw)) return { date: today, message: "That date isn't valid, so this shows today." };
  if (raw > tomorrow) return { date: tomorrow, message: 'You can close a day up to tomorrow, so this shows tomorrow.' };
  return { date: raw, message: null };
}

function section(s) {
  const { items, count } = s;
  const methods = s.by_method || [];
  const done = count === 0;
  // Payments recorded is a record of the day, not work left to do, so its count is neutral; open work stays amber.
  const record = s.key === 'payments_today';
  return h('section', { class: 'card dc-section', 'aria-labelledby': `dc-${s.key}` },
    h('div', { class: 'card__head' },
      h('h2', { id: `dc-${s.key}` }, s.title),
      h('span', { class: done ? 'badge badge--paid' : record ? 'badge' : 'badge badge--partial' }, done ? 'All clear' : String(count))),
    s.total != null && h('p', { class: 'dc-total' }, 'Total ', h('strong', null, peso(s.total))),
    methods.length > 0 && h('ul', { class: 'list' }, methods.map((m) => h('li', null, h('div', { class: 'row' },
      h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, METHOD[m.method] || m.method), h('span', { class: 'row__sub' }, `${m.count} payment${m.count === 1 ? '' : 's'}`)),
      h('div', { class: 'row__end' }, h('strong', null, peso(m.total))))))),
    items.length > 0 && h('ul', { class: 'list' }, items.map((i) => {
      const main = h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, i.text), i.detail && h('span', { class: 'row__sub' }, i.detail));
      const end = i.amount != null && h('div', { class: 'row__end' }, peso(i.amount));
      return h('li', null, h('a', { class: 'row dc-link', href: i.link }, main, end));
    })),
    done && h('p', { class: 'muted small' }, 'Nothing to do here.'));
}

export async function dailyCloseView(el, { query, rerender }) {
  const today = todayManila();
  const { date, message } = closeDayFor(query.date, today);
  const [day, hist] = await Promise.all([
    get(`/daily-close${qs({ date })}`),
    get(`/daily-closes${qs({ from: addDays(today, -60), to: today })}`).catch(() => ({ closes: [] })),
  ]);
  const { closed, sections } = day;
  // Payments recorded is a record of the day, not work left to do.
  const open = sections.filter((s) => s.key !== 'payments_today').reduce((n, s) => n + s.count, 0);

  const picker = h('input', { class: 'input input--sm', type: 'date', value: date, max: addDays(today, 1), 'aria-label': 'Day to close', 'aria-describedby': message ? 'dc-date-msg' : undefined });
  picker.addEventListener('change', () => { if (picker.value) location.hash = `#/daily-close${qs({ date: picker.value === today ? '' : picker.value })}`; });

  const closeDay = () => formModal({
    title: closed ? 'Update the daily close' : 'Close the day', submitText: closed ? 'Update close' : 'Close the day',
    fields: [
      !closed && h('p', { class: 'muted small' }, `Closing saves this checklist as the record for ${fmtDate(date)}. You can reopen it later.`),
      h('p', { class: 'muted small' }, `${fmtDate(date)}. ${open ? `${open} item${open === 1 ? ' is' : 's are'} still open. They are saved in the close so you can see them later.` : 'Everything on the checklist is clear.'}`),
      field({ name: 'note', label: 'Note (optional)', type: 'textarea', value: closed?.note || '', maxlength: 1000, placeholder: 'Anything the next shift should know' }),
    ],
    onSubmit: async (d) => { await post('/daily-close', { date, note: d.note }); toast(closed ? 'Close updated.' : 'Day closed.'); rerender(); },
  });

  let reopening = false; // aria-busy + flag, not disabled: a disabled focused button drops focus to BODY
  const reopen = async (e) => {
    if (reopening) return;
    const btn = e.currentTarget; // currentTarget is null after the first await
    if (!await confirmDialog({ title: `Reopen ${fmtDate(date)}?`, text: `The saved close (by ${closed.closed_by_name || 'a team member'}, ${fmtDateTime(closed.closed_at)}) is removed. You can close the day again.`, confirmText: 'Reopen day' })) return;
    reopening = true; btn.setAttribute('aria-busy', 'true');
    try { await post('/daily-close/reopen', { date }); toast('Day reopened.'); rerender(); } catch (err) { toast(err.message, 'error'); reopening = false; btn.removeAttribute('aria-busy'); }
  };

  const closes = hist.closes;
  el.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' }, h('h1', null, 'Daily close'), h('p', null, 'Check the day is wrapped up, then close it')),
      // The group names the header's buttons, so after Reopen day the focus guard lands on Close the day (its shared fallback).
      h('div', { class: 'page-head__actions', role: 'group', 'aria-label': 'Daily close actions' }, picker, closed?.can_change && h('button', { class: 'btn btn--secondary', 'data-focus-key': 'dc-reopen', onclick: reopen }, 'Reopen day'), (!closed || closed.can_change) && h('button', { class: 'btn btn--primary', 'data-focus-key': 'dc-close', onclick: closeDay }, closed ? 'Update close' : 'Close the day'))),
    message && h('div', { class: 'alert alert--warn', id: 'dc-date-msg', role: 'alert' }, message),
    closed
      ? h('div', { class: 'alert alert--ok', role: 'status' }, `${fmtDate(date)} was closed on ${fmtDateTime(closed.closed_at)} by ${closed.closed_by_name || 'a team member'}${closed.note ? `: ${closed.note}` : ''}`)
      : h('div', { class: `alert ${open ? 'alert--warn' : 'alert--info'}`, role: 'status' }, `${fmtDate(date)} is not closed yet.${open ? ` ${open} item${open === 1 ? '' : 's'} to look at.` : ''}`),
    closed && !closed.can_change && h('p', { class: 'muted small' }, lockedCloseText(closed)),
    sections.length ? h('div', { class: 'dc-grid' }, sections.map(section)) : emptyState({ iconName: 'file', title: 'Nothing to check', text: 'No checklist items for this day.' }),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Past closes')),
      closes.length ? h('ul', { class: 'list' }, closes.map((c) => h('li', null, h('a', { class: 'row dc-link', href: `#/daily-close${qs({ date: c.close_date === today ? '' : c.close_date })}` },
        h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, fmtDate(c.close_date)), h('span', { class: 'row__sub' }, `${fmtDateTime(c.closed_at)} · ${c.closed_by_name || 'Team member'}${c.note ? ` · ${c.note}` : ''}`))))))
        : h('p', { class: 'muted small' }, 'No days closed yet.')));
}
