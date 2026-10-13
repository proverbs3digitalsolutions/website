// Daily close: an end-of-day checklist for owners and managers (D-72).

import { get, post, qs } from '../api.js';
import { h, peso, fmtDate, fmtDateTime, field, formModal, emptyState, toast, todayManila } from '../ui.js';
import { addDays } from './reservations.js';

const METHOD = { cash: 'Cash', bank_transfer: 'Bank transfer', gcash: 'GCash', maya: 'Maya', card: 'Card', channel_payout: 'Channel payout', other: 'Other' };

// A YYYY-MM-DD string that names a real calendar day (2027-02-29 and 2026-02-30 do not).
function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === s;
}

// Checks the day a page was opened with before anything is loaded, so the server never refuses it.
// Missing means today. A date after tomorrow is clamped to tomorrow; a date that is not real falls back to today.
// The message says which happened, shown inline on the page.
export function closeDayFor(raw, today = todayManila()) {
  const tomorrow = addDays(today, 1);
  if (!raw) return { date: today, message: null };
  if (!isRealDate(raw)) return { date: today, message: "That date isn't valid." };
  if (raw > tomorrow) return { date: tomorrow, message: 'You can close a day up to tomorrow, so this shows tomorrow.' };
  return { date: raw, message: null };
}

function section(s) {
  const { items, count } = s;
  const methods = s.by_method || [];
  const done = count === 0;
  return h('section', { class: 'card dc-section', 'aria-labelledby': `dc-${s.key}` },
    h('div', { class: 'card__head' },
      h('h2', { id: `dc-${s.key}` }, s.title),
      h('span', { class: `badge ${done ? 'badge--paid' : 'badge--partial'}` }, done ? 'All clear' : String(count))),
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
      h('p', { class: 'muted small' }, `${fmtDate(date)}. ${open ? `${open} item${open === 1 ? ' is' : 's are'} still open. They are saved in the close so you can see them later.` : 'Everything on the checklist is clear.'}`),
      field({ name: 'note', label: 'Note (optional)', type: 'textarea', value: closed?.note || '', maxlength: 1000, placeholder: 'Anything the next shift should know' }),
    ],
    onSubmit: async (d) => { await post('/daily-close', { date, note: d.note }); toast('Day closed.'); rerender(); },
  });

  const closes = hist.closes;
  el.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' }, h('h1', null, 'Daily close'), h('p', null, 'Check the day is wrapped up, then close it')),
      h('div', { class: 'page-head__actions' }, picker, h('button', { class: 'btn btn--primary', onclick: closeDay }, closed ? 'Update close' : 'Close the day'))),
    message && h('div', { class: 'alert alert--warn', id: 'dc-date-msg', role: 'alert' }, message),
    closed
      ? h('div', { class: 'alert alert--ok', role: 'status' }, `Closed ${fmtDateTime(closed.closed_at)} by ${closed.closed_by_name || 'a team member'}${closed.note ? `: ${closed.note}` : ''}`)
      : h('div', { class: `alert ${open ? 'alert--warn' : 'alert--info'}`, role: 'status' }, `${fmtDate(date)} is not closed yet.${open ? ` ${open} item${open === 1 ? '' : 's'} to look at.` : ''}`),
    sections.length ? h('div', { class: 'dc-grid' }, sections.map(section)) : emptyState({ iconName: 'file', title: 'Nothing to check', text: 'No checklist items for this day.' }),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Past closes')),
      closes.length ? h('ul', { class: 'list' }, closes.map((c) => h('li', null, h('a', { class: 'row dc-link', href: `#/daily-close${qs({ date: c.close_date === today ? '' : c.close_date })}` },
        h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, fmtDate(c.close_date)), h('span', { class: 'row__sub' }, `${fmtDateTime(c.closed_at)} · ${c.closed_by_name || 'Team member'}${c.note ? ` · ${c.note}` : ''}`))))))
        : h('p', { class: 'muted small' }, 'No days closed yet.')));
}
