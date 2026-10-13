// Owner portal (Phase 2, D-39). Unit owners sign in with an emailed one-time link and see
// their own statements, bookings, payouts and profit and loss. Not part of the team app:
// no sidebar, its own top bar and tabs, English only. All calls go to /api/owner-portal/*;
// a 401 means "signed out of the portal" and sends the owner to #/owner (api.js does not
// treat these as a team session expiry).

import { get, post, qs } from '../api.js';
import { h, brand, peso, fmtDate, fmtMonth, fmtDateTime, field, formModal, confirmDialog, emptyState, errorState, skeleton, toast, todayManila, makeForm } from '../ui.js';
import { navigate } from '../app.js';
import { CHANNEL_LABEL } from './reservations.js';

const TABS = [
  ['home', 'Home', '/owner/home'],
  ['statements', 'Statements', '/owner/statements'],
  ['bookings', 'Bookings', '/owner/bookings'],
  ['money', 'Money', '/owner/money'],
  ['pnl', 'Profit and loss', '/owner/pnl'],
];
const METHOD = { gcash: 'GCash', maya: 'Maya', bank_transfer: 'Bank transfer', cash: 'Cash', other: 'Other' };
const chLabel = (c) => CHANNEL_LABEL[c] || (c === 'booking_com' ? 'Booking.com' : c);
// Calendar day of a timestamp in Manila time (fmtDate alone would slice the UTC date).
const manilaDay = (ts) => (ts ? fmtDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(ts))) : '—');

let meCache = null;
const signedOut = (err) => err?.status === 401;
const monthNow = () => todayManila().slice(0, 7);
const lastMonth = () => addMonths(monthNow(), -1);
function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysIn = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const nightsBetween = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));

async function getMe() {
  if (!meCache) { const d = await get('/owner-portal/me'); meCache = { ...d.owner, units: d.units, workspace_name: d.workspace_name }; }
  return meCache;
}

// Wraps a portal screen: top bar, tabs, loading and error states, signed-out redirect.
function portalScreen(key, title, build) {
  const view = async (el, ctx) => {
    el.replaceChildren(h('div', { class: 'op' }, h('div', { class: 'op__wrap' }, skeleton(3))));
    let me;
    try { me = await getMe(); } catch (err) {
      meCache = null;
      if (signedOut(err)) { navigate('#/owner', { replace: true }); return; }
      el.replaceChildren(h('div', { class: 'op' }, h('div', { class: 'op__wrap' }, errorState(err, () => view(el, ctx))))); return;
    }
    const body = h('main', { class: 'op__main', id: 'main', tabindex: '-1' }, skeleton(3));
    el.replaceChildren(h('div', { class: 'op' },
      h('header', { class: 'op__top' }, h('div', { class: 'op__top-in' },
        brand('#/owner/home'),
        h('div', { class: 'op__who' },
          h('span', { class: 'op__ws' }, me.workspace_name || ''),
          h('span', { class: 'op__name' }, me.full_name || '')),
        h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: signOut }, 'Sign out'))),
      h('nav', { class: 'op__tabs', 'aria-label': 'Owner portal' }, h('div', { class: 'op__tabs-in' },
        TABS.map(([k, text, path]) => h('a', { href: `#${path}`, 'aria-current': k === key ? 'page' : null }, text)))),
      h('div', { class: 'op__wrap' }, body)));
    document.title = `${title} — BalayHub owner portal`;
    el.querySelector('.op__tabs [aria-current]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    try { await build(body, ctx, me); } catch (err) {
      if (signedOut(err)) { meCache = null; navigate('#/owner', { replace: true }); return; }
      body.replaceChildren(errorState(err, () => view(el, ctx)));
    }
  };
  return view;
}

async function signOut() {
  try { await post('/owner-portal/logout'); } catch { /* already signed out */ }
  meCache = null;
  navigate('#/owner', { replace: true });
}

// Runs a section's request; one failing section shouldn't blank the whole page.
async function load(promise) {
  try { return { ok: true, v: await promise }; } catch (err) { if (signedOut(err)) throw err; return { ok: false, err }; }
}
const sectionError = (r) => h('p', { class: 'alert alert--error', role: 'alert' }, r.err?.message || "Couldn't load this section.");

// ---------------------------------------------------------------- sign in
function authCard(...children) {
  return h('div', { class: 'op op--auth' }, h('main', { class: 'op__authbox', id: 'main' },
    h('div', { class: 'op__authbrand' }, brand('#/owner')),
    h('div', { class: 'card op__authcard' }, children)));
}

export async function ownerSignInView(el) {
  document.title = 'Owner sign in — BalayHub';
  // Already signed in? Skip the form.
  try { await getMe(); navigate('#/owner/home', { replace: true }); return; } catch { meCache = null; }
  const show = (...c) => el.replaceChildren(authCard(...c));
  const form = () => makeForm({
    fields: field({ name: 'email', label: 'Your email', type: 'email', required: true, autocomplete: 'email', hint: 'Use the email address your property manager has on file for you.' }),
    submitText: 'Email me a sign-in link',
    onSubmit: async (data) => {
      await post('/owner-portal/login', { email: data.email });
      show(
        h('h1', null, 'Check your email'),
        h('p', { class: 'muted' }, `If ${data.email} is set up for the owner portal, a sign-in link is on its way. It works once and expires in 30 minutes.`),
        h('p', { class: 'small muted' }, "Can't find it? Check your spam folder, or ask your property manager to invite you."),
        h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => show(...intro()) }, 'Use a different email'));
    },
  });
  const intro = () => [
    h('h1', null, 'Owner portal'),
    h('p', { class: 'muted' }, 'See your statements, bookings and payouts. We will email you a link to sign in. No password needed.'),
    form(),
    h('p', { class: 'op__authfoot small muted' }, 'Are you a host or team member? ', h('a', { href: '#/login' }, 'Log in here'))];
  show(...intro());
}

export async function ownerLinkView(el, { query }) {
  document.title = 'Signing in — BalayHub';
  const fail = (msg) => el.replaceChildren(authCard(
    h('h1', null, "This link doesn't work"),
    h('p', { class: 'muted' }, msg),
    h('a', { class: 'btn btn--primary', href: '#/owner' }, 'Get a new link')));
  if (!query.token) { fail('The sign-in link is incomplete. Request a new one.'); return; }
  el.replaceChildren(authCard(h('h1', null, 'Signing you in…'), skeleton(1)));
  const token = query.token;
  history.replaceState(null, '', '#/owner/signin'); // keep the one-time token out of the address bar/history (replaceState fires no hashchange)
  try {
    await post('/owner-portal/session', { token });
    meCache = null;
    navigate('#/owner/home', { replace: true });
  } catch (err) {
    fail(err.offline ? err.message : 'It may have expired or already been used. Links work once and last 30 minutes.');
  }
}

// ---------------------------------------------------------------- home
const KIND_TEXT = { check_in: 'Check-in', check_out: 'Check-out', cleaning: 'Cleaning', maintenance: 'Maintenance', expense: 'Expense', statement: 'Statement', payout: 'Payout' };
const kindText = (k) => KIND_TEXT[k] || String(k || 'Update').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export const ownerHomeView = portalScreen('home', 'Home', async (body, _ctx, me) => {
  const today = todayManila();
  const end = addDays(today, 30);
  const [bk, st, ac] = await Promise.all([
    load(get(`/owner-portal/bookings${qs({ from: today, to: end })}`)),
    load(get('/owner-portal/statements')),
    load(get('/owner-portal/activity?limit=30')),
  ]);
  const stays = bk.ok ? bk.v.bookings.filter((b) => b.kind === 'reservation' && b.status !== 'cancelled') : [];
  const upcoming = stays.filter((b) => String(b.check_in).slice(0, 10) >= today);
  const nights = stays.reduce((n, b) => {
    const a = String(b.check_in).slice(0, 10) > today ? String(b.check_in).slice(0, 10) : today;
    const z = String(b.check_out).slice(0, 10) < end ? String(b.check_out).slice(0, 10) : end;
    return n + nightsBetween(a, z);
  }, 0);
  const latest = st.ok ? st.v.statements[0] : null;
  const feed = ac.ok ? ac.v.activity : [];

  body.replaceChildren(
    h('h1', null, `Hello, ${String(me.full_name || '').split(' ')[0] || 'owner'}`),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Upcoming stays'), h('div', { class: 'stat__value' }, bk.ok ? String(upcoming.length) : '—'), h('div', { class: 'stat__sub' }, 'Next 30 days')),
      h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Nights booked'), h('div', { class: 'stat__value' }, bk.ok ? String(nights) : '—'), h('div', { class: 'stat__sub' }, 'Next 30 days'))),
    h('section', { class: 'card', 'aria-labelledby': 'op-latest' },
      h('h2', { id: 'op-latest' }, 'Latest statement'),
      !st.ok ? sectionError(st)
        : latest ? h('a', { class: 'op__row', href: `#/owner/statements/${latest.month}` },
          h('span', null, h('strong', null, latest.month_label || fmtMonth(latest.month)), h('span', { class: 'muted small op__sub' }, `Published ${manilaDay(latest.published_at)}`)),
          h('span', { class: 'op__amt' }, h('strong', null, peso(latest.payout)), h('span', { class: 'muted small op__sub' }, paidText(latest))))
          : h('p', { class: 'muted' }, 'Your first statement will show here once your property manager publishes it.')),
    h('section', { class: 'card', 'aria-labelledby': 'op-act' },
      h('h2', { id: 'op-act' }, 'Recent activity'),
      !ac.ok ? sectionError(ac)
        : feed.length ? feedList(feed)
          : emptyState({ title: 'Nothing yet', text: 'Check-ins, cleanings, repairs and payouts on your units will show here.', iconName: 'calendar' })));
});

const FEED_MAX = 10;
function feedList(feed) {
  const item = (a) => h('li', null,
    h('div', { class: 'op__feedhead' }, h('span', { class: 'op__kind' }, kindText(a.kind)), h('strong', { class: 'op__feedtitle' }, a.title)),
    h('div', { class: 'op__feedmeta muted small' }, a.unit_name && h('span', null, a.unit_name), h('time', { datetime: a.at }, fmtDateTime(a.at))));
  const ul = h('ul', { class: 'list op__feed' }, feed.slice(0, FEED_MAX).map(item));
  if (feed.length <= FEED_MAX) return ul;
  const more = h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => { ul.append(...feed.slice(FEED_MAX).map(item)); more.remove(); } }, `Show ${feed.length - FEED_MAX} more`);
  return h('div', null, ul, h('div', { class: 'op__more' }, more));
}

function paidText(s) {
  const paid = Number(s.paid || 0); const due = Number(s.payout || 0);
  if (due <= 0) return 'Nothing to pay out';
  if (paid >= due) return 'Paid in full';
  return paid > 0 ? `Paid ${peso(paid)} so far` : 'Not paid yet';
}

// ---------------------------------------------------------------- statements
export const ownerStatementsListView = portalScreen('statements', 'Statements', async (body) => {
  const list = (await get('/owner-portal/statements')).statements;
  body.replaceChildren(
    h('h1', null, 'Statements'),
    list.length ? h('div', { class: 'card' }, h('ul', { class: 'list' }, list.map((s) => h('li', null,
      h('a', { class: 'op__row', href: `#/owner/statements/${s.month}` },
        h('span', null, h('strong', null, s.month_label || fmtMonth(s.month)), h('span', { class: 'muted small op__sub' }, `Published ${manilaDay(s.published_at)}`)),
        h('span', { class: 'op__amt' }, h('strong', null, peso(s.payout)), h('span', { class: 'muted small op__sub' }, paidText(s))))))))
      : h('div', { class: 'card' }, emptyState({ title: 'No statements yet', text: 'Statements appear here after your property manager publishes them, usually in the first days of the month.', iconName: 'file' })));
});

export const ownerStatementView = portalScreen('statements', 'Statement', async (body, { params }) => {
  const month = params.month;
  const d = await get(`/owner-portal/statements/${encodeURIComponent(month)}`);
  const s = d.statement;
  const payouts = d.payouts || [];
  const t = s.totals || {};
  const o = s.owner || {};
  const num = (v, l) => h('td', { class: 'num', 'data-label': l }, v);
  const txt = (v, l) => h('td', { 'data-label': l }, v);
  const row = (text, value, opts = {}) => [h('dt', null, text), h('dd', { class: opts.cls || null }, opts.strong ? h('strong', null, value) : value)];
  const topup = Number(s.reserve?.topup || 0); // missing on old snapshots
  const owed = Number(t.payout) < 0;
  const receipt = (e) => e.has_receipt && e.receipt_file_id
    ? h('a', { href: `/api/owner-portal/receipts/${encodeURIComponent(e.receipt_file_id)}`, target: '_blank', rel: 'noopener' }, 'Receipt') : '—';
  document.title = `${s.month_label || fmtMonth(month)} statement — BalayHub owner portal`;

  body.replaceChildren(
    h('a', { class: 'back no-print', href: '#/owner/statements' }, '‹ All statements'),
    h('div', { class: 'op__head no-print' },
      h('h1', null, `${s.month_label || fmtMonth(month)} statement`),
      h('button', { class: 'btn btn--primary', type: 'button', onclick: () => window.print() }, 'Print or save as PDF')),
    h('div', { class: 'card receipt statement op__statement' },
      h('div', { class: 'receipt__head' },
        h('div', null, h('h2', null, s.workspace || ''), h('div', { class: 'muted small' }, `Prepared for ${o.full_name || ''}`)),
        h('div', { class: 'receipt__no' }, h('div', { class: 'subhead' }, 'Owner statement'), h('strong', null, s.month_label || fmtMonth(month)))),
      h('p', { class: 'muted small' }, `Units: ${(s.units || []).map((u) => u.unit_name).join(', ') || 'none'} · ${t.stays || 0} stay${t.stays === 1 ? '' : 's'}, ${t.nights || 0} night${t.nights === 1 ? '' : 's'} (${t.occupancy_pct || 0}% occupancy)`),
      h('h3', { class: 'subhead' }, 'Stays'),
      (s.stays || []).length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact op-stack' },
        h('thead', null, h('tr', null, ['Dates', 'Unit', 'Guest', 'Channel', 'Total', 'Channel fee', o.cleaning_to_manager ? 'Cleaning' : null, 'Net'].filter(Boolean).map((x) => h('th', null, x)))),
        h('tbody', null, s.stays.map((x) => h('tr', null,
          num(`${fmtDate(x.check_in)} – ${fmtDate(x.check_out)}`, 'Dates'), txt(x.unit_name, 'Unit'), txt(x.guest_first_name, 'Guest'),
          txt(chLabel(x.channel), 'Channel'),
          num(x.missing_amount ? 'not entered' : peso(x.total_amount), 'Total'),
          num(Number(x.channel_fee) ? `− ${peso(x.channel_fee)}` : '—', 'Channel fee'),
          o.cleaning_to_manager && num(Number(x.cleaning_fee) ? `− ${peso(x.cleaning_fee)}` : '—', 'Cleaning'),
          num(peso(x.net), 'Net'))))))
        : h('p', { class: 'muted' }, 'No stays checked out this month.'),
      (s.expenses || []).length > 0 && [
        h('h3', { class: 'subhead op__gap' }, 'Expenses'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact op-stack' },
          h('thead', null, h('tr', null, ['Date', 'Unit', 'For', 'Amount', 'Receipt'].map((x) => h('th', null, x)))),
          h('tbody', null, s.expenses.map((e) => h('tr', null,
            num(fmtDate(e.expense_date), 'Date'), txt(e.unit_name, 'Unit'),
            txt([e.description || String(e.category || '').replace('_', ' '), e.vendor_name].filter(Boolean).join(' · '), 'For'),
            num(peso(e.amount), 'Amount'), h('td', { class: 'no-print-link', 'data-label': 'Receipt' }, receipt(e)))))))],
      h('h3', { class: 'subhead op__gap' }, 'Summary'),
      h('dl', { class: 'dl statement__sum' },
        row('Gross bookings', peso(t.gross)),
        row('Less channel fees', `− ${peso(t.channel_fees)}`),
        o.cleaning_to_manager && row('Less cleaning fees', `− ${peso(t.cleaning_fees)}`),
        row('Less refunds', `− ${peso(s.refunded)}`),
        row('Net rental income', peso(t.net_rental), { strong: true }),
        row(s.fee_label, `− ${peso(t.management_fee)}`),
        row('Expenses', `− ${peso(t.expenses)}`),
        topup > 0 && row('Repairs reserve top-up', `− ${peso(topup)}`),
        owed ? row(`You owe ${s.workspace}`, peso(Math.abs(Number(t.payout))), { strong: true, cls: 'amount--neg' }) : row('Payout to you', peso(t.payout), { strong: true, cls: 'statement__payout' })),
      owed && h('p', { class: 'muted small' }, `Expenses were more than this month's income, so ${s.workspace} is owed this amount.`),
      h('h3', { class: 'subhead op__gap' }, 'Payouts'),
      payouts.length ? h('ul', { class: 'list' }, payouts.map((p) => h('li', { class: 'op__row op__row--static' },
        h('span', null, h('strong', null, `${METHOD[p.method] || p.method} · ${fmtDate(p.paid_on)}`), p.reference_number && h('span', { class: 'muted small op__sub' }, `Ref ${p.reference_number}`)),
        h('strong', null, peso(p.amount)))))
        : h('p', { class: 'muted' }, 'No payout recorded for this month yet.'),
      !owed && h('p', { class: 'op__paid' }, `Paid ${peso(d.paid)} of ${peso(t.payout)}`),
      h('p', { class: 'muted small op__gap' }, `Published ${manilaDay(d.published_at)} by ${s.workspace || 'your property manager'}.`)));
});

// ---------------------------------------------------------------- bookings
export const ownerBookingsView = portalScreen('bookings', 'Bookings', async (body, ctx, me) => {
  let month = /^\d{4}-\d{2}$/.test(ctx.query.month || '') ? ctx.query.month : monthNow();
  const units = me.units || [];
  const today = todayManila();

  const draw = async () => {
    const from = `${month}-01`;
    const to = addDays(`${month}-${String(daysIn(month)).padStart(2, '0')}`, 1);
    const r = await load(get(`/owner-portal/bookings${qs({ from, to })}`));
    const items = r.ok ? r.v.bookings.filter((b) => b.status !== 'cancelled') : [];
    const days = daysIn(month);

    const strip = (u) => {
      const mine = items.filter((b) => b.unit_id === u.unit_id);
      const cells = Array.from({ length: days }, (_, i) => {
        const ymd = `${month}-${String(i + 1).padStart(2, '0')}`;
        const hit = mine.find((b) => String(b.check_in).slice(0, 10) <= ymd && ymd < String(b.check_out).slice(0, 10));
        const cls = hit ? (hit.kind === 'block' ? 'op-day--blk' : 'op-day--res') : '';
        return h('span', { class: `op-day ${cls}`, title: `${fmtDate(ymd)}: ${hit ? (hit.kind === 'block' ? 'Blocked' : 'Booked') : 'Free'}`, 'aria-hidden': 'true' }, String(i + 1));
      });
      const booked = cells.filter((c) => c.classList.contains('op-day--res')).length;
      const blocked = cells.filter((c) => c.classList.contains('op-day--blk')).length;
      return h('div', { class: 'op-strip', role: 'img', 'aria-label': `${u.unit_name}: ${booked} nights booked, ${blocked} blocked in ${fmtMonth(month)}` },
        h('div', { class: 'op-strip__name' }, u.unit_name),
        h('div', { class: 'op-strip__days', style: { '--days': days } }, cells));
    };

    const cancelBlock = async (b) => {
      if (!await confirmDialog({ title: 'Cancel this block?', text: `Free up ${b.unit_name} from ${fmtDate(b.check_in)} to ${fmtDate(b.check_out)}?`, confirmText: 'Cancel block', cancelText: 'Keep it', danger: true })) return;
      try { await post(`/owner-portal/blocks/${b.booking_id}/cancel`); toast('Block cancelled.'); await draw(); } catch (err) { if (signedOut(err)) { navigate('#/owner', { replace: true }); return; } toast(err.message, 'error'); }
    };
    const card = (b) => {
      const isBlock = b.kind === 'block';
      const canCancel = isBlock && b.mine && b.check_in > today;
      return h('li', { class: 'op__row op__row--static' },
        h('span', null,
          h('strong', null, `${fmtDate(b.check_in)} – ${fmtDate(b.check_out)}`),
          h('span', { class: 'muted small op__sub' }, [b.unit_name, isBlock ? b.label : b.guest_first_name, `${b.nights} night${b.nights === 1 ? '' : 's'}`, !isBlock && chLabel(b.channel)].filter(Boolean).join(' · '))),
        h('span', { class: 'op__amt' },
          !isBlock && b.gross != null && h('strong', null, peso(b.gross)),
          canCancel && h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => cancelBlock(b) }, 'Cancel block')));
    };
    const blockModal = () => formModal({
      title: 'Block dates',
      submitText: 'Block dates',
      fields: [
        field({ name: 'unit_id', label: 'Unit', type: 'select', required: true, options: units.map((u) => [u.unit_id, u.unit_name]), placeholderOption: 'Choose a unit' }),
        field({ name: 'check_in', label: 'From', type: 'date', required: true, min: today }),
        field({ name: 'check_out', label: 'Until (check-out day)', type: 'date', required: true, min: today, hint: 'The check-out day itself is not blocked. Up to 60 nights.' }),
        field({ name: 'reason', label: 'Reason', type: 'text', maxlength: 200, placeholder: 'Owner stay' }),
      ],
      onSubmit: async (data) => {
        try { await post('/owner-portal/blocks', { ...data, reason: data.reason || undefined }); } catch (err) { if (err?.code === 'PLAN_READ_ONLY' || err?.code === 'DEMO_READ_ONLY') toast(err.message, 'error'); throw err; } // makeForm also shows it inline and keeps the modal usable
        toast('Dates blocked.'); month = data.check_in.slice(0, 7); await draw(); },
    });

    const list = items.slice().sort((a, b) => String(a.check_in).localeCompare(String(b.check_in)));
    body.replaceChildren(
      h('div', { class: 'op__head' }, h('h1', null, 'Bookings'),
        h('button', { class: 'btn btn--primary', type: 'button', onclick: blockModal, disabled: units.length === 0 }, 'Block dates')),
      h('div', { class: 'op__monthnav' },
        h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'aria-label': 'Previous month', onclick: () => { month = addMonths(month, -1); draw(); } }, '‹'),
        h('strong', { 'aria-live': 'polite' }, fmtMonth(month)),
        h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'aria-label': 'Next month', onclick: () => { month = addMonths(month, 1); draw(); } }, '›')),
      !r.ok ? sectionError(r) : [
        h('section', { class: 'card', 'aria-label': 'Month at a glance' },
          units.length ? units.map(strip) : h('p', { class: 'muted' }, 'No units are linked to you yet.'),
          h('p', { class: 'op-legend small muted' }, h('span', { class: 'op-day op-day--res' }), ' Booked ', h('span', { class: 'op-day op-day--blk' }), ' Blocked ', h('span', { class: 'op-day' }), ' Free')),
        h('section', { class: 'card', 'aria-label': 'Bookings this month' },
          h('h2', null, 'This month'),
          list.length ? h('ul', { class: 'list' }, list.map(card)) : emptyState({ title: 'No bookings this month', text: 'Stays and blocked dates on your units show here.', iconName: 'calendar' }))]);
  };
  await draw();
});

// ---------------------------------------------------------------- money
export const ownerMoneyView = portalScreen('money', 'Money', async (body) => {
  const [po, rs] = await Promise.all([load(get('/owner-portal/payouts')), load(get('/owner-portal/reserve'))]);
  const payouts = po.ok ? po.v.payouts : [];
  const rv = rs.ok ? rs.v : {};
  const entries = rs.ok ? rs.v.entries : [];
  const showReserve = rs.ok && (Number(rv.target) > 0 || entries.length > 0);
  body.replaceChildren(
    h('h1', null, 'Money'),
    h('section', { class: 'card', 'aria-labelledby': 'op-po' },
      h('h2', { id: 'op-po' }, 'Payouts to you'),
      !po.ok ? sectionError(po)
        : payouts.length ? h('ul', { class: 'list' }, payouts.map((p) => h('li', { class: 'op__row op__row--static' },
          h('span', null, h('strong', null, `${METHOD[p.method] || p.method} · ${fmtDate(p.paid_on)}`),
            h('span', { class: 'muted small op__sub' }, [p.month && `For ${fmtMonth(p.month)}`, p.reference_number && `Ref ${p.reference_number}`, p.note].filter(Boolean).join(' · '))),
          h('strong', null, peso(p.amount)))))
          : emptyState({ title: 'No payouts yet', text: 'Payouts your property manager records will show here.', iconName: 'cash' })),
    !rs.ok ? h('section', { class: 'card' }, h('h2', null, 'Repairs reserve'), sectionError(rs)) : null,
    showReserve && h('section', { class: 'card', 'aria-labelledby': 'op-rv' },
      h('h2', { id: 'op-rv' }, 'Repairs reserve'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Balance'), h('div', { class: 'stat__value' }, peso(rv.balance))),
        h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Target'), h('div', { class: 'stat__value' }, peso(rv.target)), Number(rv.monthly) > 0 && h('div', { class: 'stat__sub' }, `${peso(rv.monthly)} set aside a month`))),
      entries.length ? h('ul', { class: 'list' }, entries.map((e) => h('li', { class: 'op__row op__row--static' },
        h('span', null, h('strong', null, e.kind === 'withdrawal' ? 'Used for a repair' : 'Set aside'), h('span', { class: 'muted small op__sub' }, [fmtDate(e.entry_date), e.note].filter(Boolean).join(' · '))),
        h('strong', { class: e.kind === 'withdrawal' ? 'amount--neg' : null }, `${e.kind === 'withdrawal' ? '− ' : ''}${peso(e.amount)}`))))
        : h('p', { class: 'muted' }, 'No reserve entries yet.')));
});

// ---------------------------------------------------------------- profit and loss
export const ownerPnlView = portalScreen('pnl', 'Profit and loss', async (body, ctx) => {
  let month = /^\d{4}-\d{2}$/.test(ctx.query.month || '') ? ctx.query.month : lastMonth();
  const draw = async () => {
    const r = await load(get(`/owner-portal/pnl${qs({ month })}`));
    const d = r.ok ? r.v : {};
    const rows = d.rows || [];
    const tot = d.totals || {};
    const money = (v) => peso(v);
    const netCls = (v) => (Number(v) < 0 ? 'amount--neg' : null);
    const cols = [['Stays', 'stays'], ['Nights', 'nights'], ['Gross', 'gross', 1], ['Channel fees', 'channel_fees', 1], ['Refunds', 'refunds', 1], ['Expenses', 'expenses', 1], ['Net', 'net', 1]];
    const cell = (x, [lbl, k, isMoney]) => h('td', { class: `num ${k === 'net' ? netCls(x[k]) || '' : ''}`, 'data-label': lbl }, isMoney ? money(x[k]) : String(x[k] ?? 0));
    body.replaceChildren(
      h('div', { class: 'op__head' }, h('h1', null, 'Profit and loss'),
        h('input', { class: 'input input--sm', type: 'month', value: month, max: monthNow(), 'aria-label': 'Month',
          onchange: (e) => { if (e.target.value) { month = e.target.value; draw(); } } })),
      !r.ok ? sectionError(r)
        : rows.length ? h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact op-pnl' },
          h('caption', { class: 'sr-only' }, `Profit and loss by unit for ${fmtMonth(month)}`),
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Unit'), cols.map(([l]) => h('th', { scope: 'col', class: 'num' }, l)))),
          h('tbody', null,
            rows.map((x) => h('tr', null, h('th', { scope: 'row', 'data-label': 'Unit' }, x.unit_name), cols.map((c) => cell(x, c)))),
            h('tr', { class: 'op-pnl__total' }, h('th', { scope: 'row', 'data-label': 'Total' }, 'Total'), cols.map((c) => cell(tot, c)))))))
          : h('div', { class: 'card' }, emptyState({ title: 'Nothing for this month', text: 'No stays or expenses on your units in this month.', iconName: 'chart' })));
  };
  await draw();
});
