// Short-term homepage: daily overview, trends and revenue.

import { get, post, qs } from '../api.js';
import { h, icon, peso, fmtDate, fmtMonth, manilaDay, badge, emptyState, toast, todayManila } from '../ui.js';
import { state, navigate } from '../app.js';
import { barChart, lineChart, SERIES } from '../charts.js';
import { launchpadReminder } from './launchpad.js';
import { depositsDueCard } from './deposits.js';
import { CHANNEL_LABEL } from './reservations.js';

const shortDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const pesoWhole = (v) => `₱${Math.round(Number(v || 0)).toLocaleString('en-PH')}`;

function tabs(options, current, onPick) {
  return h('div', { class: 'tabs tabs--compact', role: 'tablist' }, options.map(([v, t]) =>
    h('button', { role: 'tab', 'aria-selected': String(v === current), onclick: () => onPick(v) }, t)));
}

function change(cur, prev) {
  const c = Number(cur); const p = Number(prev);
  if (!p) return null;
  const pct = Math.round(((c - p) / p) * 100);
  return h('span', { class: `delta ${pct >= 0 ? 'delta--up' : 'delta--down'}` }, `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct)}% vs previous month`);
}

async function stayAction(id, action, rerender) {
  try { await post(`/reservations/${id}/stay-status`, { action }); toast(action === 'check_in' ? 'Checked in.' : 'Checked out. Listing marked for cleaning.'); rerender(); } catch (err) { toast(err.message, 'error'); }
}

// ---------------------------------------------------------------- daily overview
async function overviewCard() {
  const card = h('section', { class: 'card' });
  let range = 'today';
  async function load() {
    const o = await get(`/stays/overview${qs({ range })}`);
    const checkedIn = o.arrivals.filter((a) => a.checked_in_at).length;
    const checkedOut = o.departures.filter((a) => a.checked_out_at).length;
    const tile = (value, label, sub, href) => h(href ? 'a' : 'div', { class: 'stat stat--flat', href }, h('div', { class: 'stat__value' }, value), h('div', { class: 'stat__label' }, label), sub && h('div', { class: 'stat__sub' }, sub));
    const row = (b, kind) => h('li', null, h('div', { class: 'row' },
      h('a', { class: 'row__main', href: `#/reservations/${b.booking_id}` },
        h('span', { class: 'row__title' }, b.guest_name || b.guest_label || 'Guest'),
        h('span', { class: 'row__sub' }, `${b.property_name} · ${b.unit_name}${range !== 'today' ? ` · ${shortDay(kind === 'in' ? b.check_in : b.check_out)}` : ''}${b.num_guests ? ` · ${b.num_guests} guest${b.num_guests > 1 ? 's' : ''}` : ''}`)),
      h('div', { class: 'row__end' },
        kind === 'in'
          ? (b.checked_in_at ? badge('paid', 'Checked in') : (range === 'today' ? h('button', { class: 'btn btn--primary btn--sm', onclick: () => stayAction(b.booking_id, 'check_in', load) }, 'Check in') : badge(b.channel, label(b.channel))))
          : (b.checked_out_at ? badge('paid', 'Checked out') : (range === 'today' && b.checked_in_at ? h('button', { class: 'btn btn--secondary btn--sm', onclick: () => stayAction(b.booking_id, 'check_out', load) }, 'Check out') : badge(b.channel, label(b.channel)))))));
    card.replaceChildren(
      h('div', { class: 'card__head' }, h('h2', null, 'Daily overview'),
        tabs([['today', 'Today'], ['tomorrow', 'Tomorrow'], ['7d', '7 days']], range, (v) => { range = v; load(); })),
      h('div', { class: 'stats' },
        // With nothing due the tile is a plain count, not "0/0" (D-115).
        o.arrivals.length ? tile(`${checkedIn}/${o.arrivals.length}`, 'Checked in', range === 'today' ? null : 'Arrivals', '#/reservations?view=arrivals_today') : tile('0', 'Arrivals', null, '#/reservations?view=arrivals_today'),
        o.departures.length ? tile(`${checkedOut}/${o.departures.length}`, 'Checked out', range === 'today' ? null : 'Departures', '#/reservations?view=departures_today') : tile('0', 'Departures', null, '#/reservations?view=departures_today'),
        tile(String(o.turnovers.length), 'Turnovers', 'Same-day out & in'),
        tile(String(o.staying.length), 'Staying', `${o.guests_staying} guest${o.guests_staying === 1 ? '' : 's'} in total`, '#/reservations?view=hosting')),
      Number(o.dirty_listings) > 0 && h('a', { class: 'alert alert--warn', href: '#/listings?cleaning=dirty', style: { display: 'block', marginBottom: '12px' } },
        `🧹 ${o.dirty_listings} listing${o.dirty_listings > 1 ? 's need' : ' needs'} cleaning`),
      h('div', { class: 'grid grid--2' },
        h('div', null, h('h3', { class: 'subhead' }, 'Arrivals'),
          o.arrivals.length ? h('ul', { class: 'list' }, o.arrivals.map((b) => row(b, 'in'))) : h('p', { class: 'muted small' }, 'No arrivals.')),
        h('div', null, h('h3', { class: 'subhead' }, 'Departures'),
          o.departures.length ? h('ul', { class: 'list' }, o.departures.map((b) => row(b, 'out'))) : h('p', { class: 'muted small' }, 'No departures.'))));
  }
  await load().catch((err) => card.replaceChildren(h('div', { class: 'alert alert--error' }, err.message)));
  return card;
}

// ---------------------------------------------------------------- trends
async function trendsCard() {
  const card = h('section', { class: 'card' });
  let days = 7;
  async function load() {
    const t = await get(`/stays/trends${qs({ days })}`);
    const labels = t.series.map((s) => shortDay(s.day).replace(/^\w+, /, ''));
    card.replaceChildren(
      h('div', { class: 'card__head' }, h('h2', null, 'Trends overview'), tabs([[7, '7 days'], [30, '30 days']], days, (v) => { days = v; load(); })),
      h('div', { class: 'chips trend-chips' },
        h('span', { class: 'trend-chip' }, h('span', { class: 'chart-swatch', style: { background: SERIES[0] } }), h('b', null, t.totals.check_ins), ' Check-ins'),
        h('span', { class: 'trend-chip' }, h('span', { class: 'chart-swatch', style: { background: SERIES[1] } }), h('b', null, t.totals.check_outs), ' Check-outs'),
        h('span', { class: 'trend-chip' }, h('span', { class: 'chart-swatch', style: { background: SERIES[2] } }), h('b', null, t.totals.turnovers), ' Turnovers'),
        h('span', { class: 'trend-chip' }, h('b', null, `${t.totals.occupancy}%`), ' Occupancy')),
      barChart({
        labels, ariaLabel: `Check-ins, check-outs and turnovers for the next ${days} days`,
        series: [
          { name: 'Check-ins', values: t.series.map((s) => s.check_ins) },
          { name: 'Check-outs', values: t.series.map((s) => s.check_outs) },
          { name: 'Turnovers', values: t.series.map((s) => s.turnovers) },
        ],
        fmt: (v) => String(Math.round(Number(v))),
        integer: true,
      }),
      h('h3', { class: 'subhead', style: { marginTop: '18px' } }, 'Occupancy'),
      lineChart({
        labels, height: 160, ariaLabel: `Occupancy for the next ${days} days`,
        series: [{ name: 'Occupancy', values: t.series.map((s) => s.occupancy) }],
        fmt: (v) => `${Math.round(Number(v))}%`,
      }));
  }
  await load().catch((err) => card.replaceChildren(h('div', { class: 'alert alert--error' }, err.message)));
  return card;
}

// ---------------------------------------------------------------- revenue
async function revenueSection() {
  const section = h('section');
  let month = null;
  async function load() {
    const r = await get(`/stays/revenue${qs({ month })}`);
    month = r.current.month;
    const [y, m] = month.split('-').map(Number);
    const shift = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); month = d.toISOString().slice(0, 7); load(); };
    const days = Math.max(r.current.days_in_month, r.previous.days_in_month);
    const byDay = (arr) => { const map = new Map(arr.map((x) => [x.day, Number(x.adr)])); return Array.from({ length: days }, (_, i) => (map.has(i + 1) ? map.get(i + 1) : null)); };
    const byWeek = (arr) => { const map = new Map(arr.map((x) => [x.week, Number(x.revenue)])); return [1, 2, 3, 4, 5].map((w) => map.get(w) || 0); };
    const lastDay = r.current.days_in_month;
    const weekLabels = ['1–7', '8–14', '15–21', '22–28', `29–${lastDay}`].map((x) => x);
    section.replaceChildren(
      h('div', { class: 'page-head', style: { marginTop: '8px' } },
        h('h2', null, 'Revenue'),
        h('div', { class: 'chips' },
          h('button', { class: 'btn btn--ghost btn--sm', 'aria-label': 'Previous month', onclick: () => shift(-1) }, '‹'),
          h('strong', null, fmtMonth(`${month}-01`)),
          h('button', { class: 'btn btn--ghost btn--sm', 'aria-label': 'Next month', onclick: () => shift(1) }, '›'))),
      h('div', { class: 'grid grid--2' },
        h('div', { class: 'card' },
          h('div', { class: 'stat__label' }, 'Average daily rate'),
          h('div', { class: 'hero-num' }, pesoWhole(r.current.adr)), change(r.current.adr, r.previous.adr),
          h('p', { class: 'muted small' }, `${r.current.booked_nights} nights booked · ${r.current.occupancy}% occupancy`),
          lineChart({
            labels: Array.from({ length: days }, (_, i) => String(i + 1)), height: 180, ariaLabel: 'Average daily rate by day, this month vs previous month',
            series: [{ name: fmtMonth(`${month}-01`), values: byDay(r.current.daily_adr) }, { name: fmtMonth(`${r.previous.month}-01`), values: byDay(r.previous.daily_adr), color: SERIES[2], dashed: true }],
            fmt: (v) => (v === null || v === undefined ? '—' : pesoWhole(v)),
          })),
        h('div', { class: 'card' },
          h('div', { class: 'stat__label' }, 'Total revenue'),
          h('div', { class: 'hero-num' }, pesoWhole(r.current.total_revenue)), change(r.current.total_revenue, r.previous.total_revenue),
          h('p', { class: 'muted small' }, `Stays ${pesoWhole(r.current.accommodation)} + cleaning and extras ${pesoWhole(r.current.fees)}`),
          barChart({
            labels: weekLabels, height: 180, ariaLabel: 'Accommodation revenue by week, this month vs previous month',
            series: [{ name: fmtMonth(`${month}-01`), values: byWeek(r.current.weekly) }, { name: fmtMonth(`${r.previous.month}-01`), values: byWeek(r.previous.weekly), color: SERIES[2] }],
            fmt: (v, axis) => (axis ? pesoWhole(v).replace(/,000$/, 'k') : pesoWhole(v)),
          }))),
      h('p', { class: 'muted small', style: { marginTop: '8px' } }, 'Stay revenue is spread across the nights of each booking; cleaning and other fees count in the check-in month. Imported Airbnb/Booking.com stays show ₱0 until you add their amounts.'));
  }
  await load().catch((err) => section.replaceChildren(h('div', { class: 'alert alert--error' }, err.message)));
  return section;
}

// Owners and managers: guest payment screenshots waiting to be checked. Links to the oldest one.
async function proofsAlert() {
  if (state.user.role === 'staff') return null;
  let proofs;
  try { ({ proofs } = await get('/payment-proofs?status=pending')); } catch { return null; }
  if (!proofs.length) return null;
  return h('a', { class: 'alert alert--warn', href: `#/reservations/${proofs[0].booking_id}`, style: { display: 'block' } },
    `Payments to check (${proofs.length}). Open the oldest one to confirm or reject it.`);
}

// Owners and managers: supplies at or below their par level.
async function suppliesAlert() {
  if (['staff', 'cleaner'].includes(state.user.role)) return null;
  let low;
  try { low = await get('/supplies/low-count'); } catch { return null; }
  if (!Number(low.count)) return null;
  return h('a', { class: 'alert alert--warn', href: '#/supplies', style: { display: 'block' } }, `Supplies running low (${low.count})`);
}

// Owners and managers: conversations assigned to me.
async function assignedAlert() {
  if (!['owner', 'manager'].includes(state.user.role)) return null;
  let r;
  try { r = await get('/inbox/assigned-count'); } catch { return null; }
  const n = Number(r.count);
  if (!n) return null;
  return h('a', { class: 'alert alert--info', href: '#/inbox?view=mine', style: { display: 'block' } }, `Assigned to you (${n})`);
}

// The channel and the link's host, so two links on one listing read differently.
const feedName = (p) => `${label(p.channel)}${p.host ? ` (${p.host})` : ''}`;
const SYNC_TEXT = {
  stale: (p) => `${p.unit_name}: the ${feedName(p)} calendar hasn’t updated since ${fmtDate(manilaDay(p.since))}. Bookings may be out of date.`,
  failing: (p) => (p.channel ? `${p.unit_name} · ${feedName(p)}: ${p.message}` : `${p.unit_name}: ${p.message}`),
  overlap: (p) => `${p.unit_name}: a ${feedName(p)} booking overlaps another (${fmtDate(p.check_in)} to ${fmtDate(p.check_out)}). Fix it to avoid a double booking.`,
};
// One row per listing and kind, with how many links share it (first row's wording, feed order kept).
export function groupSyncProblems(problems) {
  const rows = new Map();
  for (const p of problems) {
    const key = `${p.unit_id}|${p.kind}`;
    if (rows.has(key)) rows.get(key).n += 1; else rows.set(key, { p, n: 1 });
  }
  return [...rows.values()];
}
export const syncRowText = ({ p, n }) => `${SYNC_TEXT[p.kind](p)}${n > 1 ? ` (${n} links)` : ''}`;
// Owners and managers: calendar sync problems.
async function syncAlert() {
  if (!['owner', 'manager'].includes(state.user.role)) return null;
  let r;
  try { r = await get('/sync-health'); } catch { return null; }
  const rows = groupSyncProblems(r.problems);
  if (!rows.length) return null;
  return h('div', { class: 'alert alert--warn sync-alert', role: 'status' },
    h('strong', null, `Calendar sync problems (${rows.length})`),
    h('ul', { class: 'sync-alert__list' }, rows.map((row) => h('li', null, syncRowText(row), ' ', h('a', { href: `#/listings?focus=${row.p.unit_id}` }, 'Open listing')))));
}

// After 9 PM Manila, owners and managers are nudged to close the day.
async function dayCloseAlert() {
  if (!['owner', 'manager'].includes(state.user.role)) return null;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Manila' }).format(new Date()));
  if (hour < 21) return null;
  let r;
  try { r = await get(`/daily-close${qs({ date: todayManila() })}`); } catch { return null; }
  if (r.closed) return null;
  return h('a', { class: 'alert alert--warn', href: '#/daily-close', style: { display: 'block' } }, 'Today isn’t closed yet. Close the day.');
}

const label = (v) => CHANNEL_LABEL[v];

// Owners only: has this workspace ever had a reservation? The onboarding check already knows (its "reservation" step),
// so Home reads that rather than counting bookings. 1 or 0 is all the first-run card needs; null means not known.
async function reservationsSeen() {
  if (state.user.role !== 'owner') return null;
  let o;
  try { o = await get('/onboarding'); } catch { return null; }
  return o.steps.find((x) => x.key === 'reservation')?.done ? 1 : 0;
}

// A workspace with no reservation yet: say what to connect first, above the charts that are all zeros.
// "Connect calendar" opens the first listing's Channels dialog; with no listings it just goes to Listings.
export const channelsLink = (listings) => (listings?.[0]?.unit_id ? `#/listings?channels=${listings[0].unit_id}` : '#/listings');

export function firstRunCard({ reservations, listings, syncProblem }) {
  if (reservations !== 0) return null;
  // A calendar is already connected: say so rather than asking again. If its sync is failing, the banner above says that.
  if ((listings || []).some((l) => Number(l.channel_count) > 0)) {
    if (syncProblem) return null;
    return h('div', { class: 'card cta-card' },
      h('span', { class: 'cta-card__icon', 'aria-hidden': 'true' }, icon('calendar')),
      h('div', { class: 'cta-card__text' },
        h('p', null, 'Your calendar is connected. Bookings from it show here after the next sync.')));
  }
  return h('div', { class: 'card cta-card' },
    h('span', { class: 'cta-card__icon', 'aria-hidden': 'true' }, icon('calendar')),
    h('div', { class: 'cta-card__text' },
      h('p', null, 'No bookings yet. Connect your Airbnb or Booking.com calendar to see them here.')),
    h('div', { class: 'cta-card__actions' },
      h('a', { class: 'btn btn--primary', href: channelsLink(listings) }, 'Connect calendar')));
}

// A chart measures its space on the next frame, and the cards are built before they are on the page. Once they are
// attached, the charts' own resize handler redraws them at the real width.
const redrawCharts = () => globalThis.window?.dispatchEvent(new Event('resize'));

// The trend and revenue charts fold into a closed section while there are no bookings. A chart sizes itself to the
// space it is drawn into, and a closed section has none, so the charts are drawn the first time it opens.
function chartsFold() {
  let drawn = false;
  const fold = h('details', { class: 'form-section' }, h('summary', null, 'Trends and revenue'));
  fold.addEventListener('toggle', () => {
    if (!fold.open || drawn) return;
    drawn = true;
    Promise.all([trendsCard(), revenueSection()]).then((cards) => { fold.append(...cards); redrawCharts(); });
  });
  return fold;
}

export async function homeView(el, { rerender } = {}) {
  // The cards fetch their own data and are awaited below before anything is drawn: Home is drawn once, in one go,
  // and nothing moves while the cards fill in.
  const [{ listings }, onboard, deposits, proofAlert, lowAlert, assigned, sync, closeAlert, seen] = await Promise.all([get('/listings'), launchpadReminder(rerender), depositsDueCard(), proofsAlert(), suppliesAlert(), assignedAlert(), syncAlert(), dayCloseAlert(), reservationsSeen()]);
  const first = state.user.full_name.split(' ')[0];
  const head = h('div', { class: 'page-head' },
    h('div', { class: 'page-head__title' }, h('h1', null, `Welcome back, ${first}`), h('p', null, `${state.user.organization_name} · ${fmtDate(todayManila())}`)),
    listings.length > 0 && h('div', { class: 'page-head__actions' },
      state.user.role !== 'staff' && h('a', { class: 'btn btn--primary', href: '#/reservations?new=1' }, icon('plus'), 'New reservation'),
      h('a', { class: 'btn btn--secondary', href: '#/calendar' }, 'Calendar')));
  if (!listings.length) {
    el.replaceChildren(head, onboard, h('div', { class: 'card' }, emptyState({
      iconName: 'building', title: state.user.role === 'owner' ? 'Add your first listing' : 'No listings assigned to you yet',
      text: 'A listing is a unit you rent out per night — like a condo unit in a tower. Add it with its nightly rate, then connect your Airbnb or Booking.com calendar.',
      action: state.user.role !== 'staff' && h('button', { class: 'btn btn--primary', onclick: () => navigate('#/listings?new=1') }, icon('plus'), 'Add listing'),
    })));
    return;
  }
  const start = firstRunCard({ reservations: seen, listings, syncProblem: Boolean(sync) });
  const [overview, charts] = await Promise.all([overviewCard(), start ? chartsFold() : Promise.all([trendsCard(), revenueSection()])]);
  el.replaceChildren(head, h('div', { class: 'stack' }, start, assigned, sync, closeAlert, proofAlert, lowAlert, onboard, overview, deposits, charts));
  redrawCharts();
}
