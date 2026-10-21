// Reports for short-term rentals: performance by period, by channel and listing,
// the yearly income summary for your bookkeeper, and security deposits.
// Each tab has its own filters (property, listing, channel, period), remembered per person.

import { get, qs } from '../api.js';
import { h, peso, pageHead, todayManila, emptyState, toast, label } from '../ui.js';
import { navigate } from '../app.js';
import { initFilters, filterBar, rememberFilters, changed, outOfWindow, OUT_OF_WINDOW } from '../filters.js';
import { depositsPanel } from './deposits.js';
import { CHANNEL_LABEL, SOURCE_LABEL } from './reservations.js';
import { exportHint, dateFieldError } from './reports.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pct = (n) => (n === null || n === undefined ? '—' : `${n}%`);
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
// A real calendar day as YYYY-MM-DD (2026-02-30 is not).
function isDay(v) {
  const d = new Date(`${v}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
// Days from one YYYY-MM-DD to another, counted the way the export route does (src/routes/stayreports.js daysBetween).
const spanDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// The period a link means. A link with a from or to date and no period is a custom range (links from before the period was in the address).
export function periodFromLink(query) {
  if (query.period) return query.period;
  return query.from || query.to ? 'range' : '';
}

// Choosing a period drops the other periods' keys, so the address and a reload show only the period on screen (#23).
export function periodPatch(period) {
  if (period === 'year') return { period, month: '', from: '', to: '' };
  if (period === 'range') return { period, month: '', year: '' };
  return { period: '', year: '', from: '', to: '' };
}

// The values the From and To boxes show: what the person typed (even a refused date) wins over the pair the report runs on (#20). Pure.
export function periodBoxes(typed, filters) {
  return { from: typed.from ?? filters.from, to: typed.to ?? filters.to };
}

// The status sentence for refused custom dates, one per refused box. Pure.
export function refusedDatesText(typed) {
  return ['from', 'to'].filter((k) => typed[k] !== undefined)
    .map((k) => `The ${k === 'from' ? 'From' : 'To'} date isn't used until you fix it.`).join(' ');
}

// The listings a Listing choice can name: the chosen property's, or all of them when no property is chosen (#27). Pure.
export function listingsFor(listings, propertyId) {
  if (!propertyId) return listings;
  return listings.filter((l) => String(l.property_id) === String(propertyId));
}

// The day before an exclusive end date, as YYYY-MM-DD. Pure.
export const lastDay = (toExclusive) => new Date(Date.parse(`${toExclusive}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

// One line per channel whose stays have no channel fee entered: a count and a link to those bookings, never money. Pure of data; `link` builds the address.
export function missingFeeNotes(rows, link) {
  return (rows || []).map((m) => h('p', { class: 'muted small' },
    `${m.stays} ${m.label} ${m.stays === 1 ? 'stay has' : 'stays have'} no channel fee entered. `,
    h('a', { href: link(m.channel) }, 'See the bookings')));
}

function stat(label, value, sub) {
  return h('div', { class: 'stat stat--flat' }, h('div', { class: 'stat__value' }, value), h('div', { class: 'stat__label' }, label), sub && h('div', { class: 'muted small' }, sub));
}

// Horizontal bars (revenue share), labelled in text: the bars only repeat the numbers.
function shareBars(rows, value, label) {
  const max = Math.max(...rows.map((r) => Number(value(r))), 1);
  return h('ul', { class: 'sharebars' }, rows.map((r) => h('li', null,
    h('span', { class: 'sharebars__label' }, label(r)),
    h('span', { class: 'sharebars__track', 'aria-hidden': 'true' }, h('span', { class: 'sharebars__bar', style: { width: `${Math.max(2, (100 * Number(value(r))) / max)}%` } })),
    h('span', { class: 'sharebars__value' }, peso(value(r))))));
}

export async function stayReportsView(el, { query = {} }) {
  const tab = ['tax', 'deposits'].includes(query.tab) ? query.tab : 'performance';
  const thisYear = Number(todayManila().slice(0, 4));
  const setUrl = (q) => history.replaceState(null, '', `#/stay-reports${qs({ tab: tab === 'performance' ? '' : tab, ...q })}`);
  const tabBtn = (key, text) => h('button', { role: 'tab', 'aria-selected': String(tab === key), tabindex: tab === key ? '0' : '-1', class: tab === key ? 'is-active' : '', onclick: () => navigate(key === 'performance' ? '#/stay-reports' : `#/stay-reports?tab=${key}`) }, text);
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Report type' }, tabBtn('performance', 'Performance'), tabBtn('tax', 'Income summary (for taxes)'), tabBtn('deposits', 'Deposits'));

  if (tab === 'deposits') {
    const panel = await depositsPanel({ query, onUrl: setUrl });
    el.replaceChildren(pageHead({ title: 'Reports', sub: 'Short-term rentals' }), tabs, panel);
    return;
  }

  // Property / listing / channel filters shared by both report tabs. The Listing choices are the chosen property's (#27).
  const { listings } = await get('/listings');
  const properties = [...new Map(listings.map((l) => [l.property_id, l.property_name])).entries()];
  const scopeFieldsFor = (propertyId) => [
    properties.length > 1 && { name: 'property_id', label: 'Property', all: 'All properties', options: properties },
    listings.length > 1 && { name: 'unit_id', label: 'Listing', all: 'All listings', options: listingsFor(listings, propertyId).map((l) => [l.unit_id, `${l.unit_name}${properties.length > 1 ? ` · ${l.property_name}` : ''}`]) },
    { name: 'channel', label: 'Channel', all: 'All channels', options: Object.entries(CHANNEL_LABEL) },
  ].filter(Boolean);
  // filterBar() reads its choices once, so the bar is drawn again when the property changes: the Listing choices then follow it,
  // and filterBar drops a listing that is not among them (#27).
  const barBox = h('div');
  function drawBar(c) {
    const shownFor = c.values.property_id;
    barBox.replaceChildren(filterBar({ key: c.key, values: c.values, defaults: c.defaults, extra: c.extra,
      quick: [...(c.before || []), ...scopeFieldsFor(c.values.property_id)],
      onChange: () => { if (c.values.property_id !== shownFor) drawBar(c); c.load(); } }));
  }
  const scopeOf = (f) => ({ property_id: f.property_id, unit_id: f.unit_id, channel: f.channel });
  const exportLink = h('a', { class: 'btn btn--secondary', download: '' }, 'Download CSV');
  // Export has no address while a custom range is incomplete or runs backwards: the hint says why, as /#/reports does (#28).
  const exportNote = h('span', { class: 'muted small', id: 'stay-report-export-note' });
  const exportReady = (ready, hint) => {
    exportNote.hidden = ready;
    exportNote.textContent = ready ? '' : hint;
    if (ready) exportLink.removeAttribute('aria-disabled'); else { exportLink.removeAttribute('href'); exportLink.setAttribute('aria-disabled', 'true'); }
  };
  const box = h('div');
  const fail = (err) => { toast(err.message, 'error'); box.replaceChildren(h('div', { class: 'card' }, emptyState({ iconName: 'chart', title: 'Couldn\'t load this report', text: err.message }))); };

  if (tab === 'tax') {
    const defaults = { year: '', property_id: '', unit_id: '', channel: '' };
    const filters = initFilters('stay-reports-tax', query, defaults);
    const years = [thisYear - 1, thisYear - 2, thisYear - 3].map((y) => [String(y), String(y)]);
    async function load() {
      const year = /^\d{4}$/.test(filters.year) ? Number(filters.year) : thisYear;
      setUrl(changed(filters, defaults));
      const apiQ = qs({ year, ...scopeOf(filters) });
      exportLink.href = `/api/stay-reports/export${apiQ}&kind=tax`;
      let t;
      try { t = await get(`/stay-reports/tax${apiQ}`); } catch (err) { fail(err); return; }
      const row = (label, x, strong) => h('tr', { class: strong ? 'is-total' : null },
        h('td', null, label), h('td', { class: 'num' }, peso(x.revenue)), h('td', { class: 'num' }, peso(x.received)),
        h('td', { class: 'num' }, peso(x.channel_fees)), h('td', { class: 'num' }, peso(x.expenses)), h('td', { class: 'num' }, peso(x.net)),
        h('td', { class: 'num' }, peso(x.refunds)), h('td', { class: 'num' }, peso(x.net_received)));
      box.replaceChildren(
        filters.channel ? h('p', { class: 'muted small' }, 'Expenses aren\'t split by channel, so they are left out while a channel is chosen.') : '',
        h('div', { class: 'card' },
          h('div', { class: 'grid grid--4 stats' },
            stat('Revenue earned', peso(t.totals.revenue), 'Nights counted in their month; cleaning and extras at check-in.'),
            stat('Net received', peso(t.totals.net_received), `${peso(t.totals.received)} paid in − ${peso(t.totals.refunds)} refunded`),
            stat('Expenses', peso(t.totals.expenses)), stat('Net income', peso(t.totals.net), 'earned − channel fees − expenses'))),
        h('div', { class: 'card card--flush' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact' },
          h('thead', null, h('tr', null, ['Month', 'Revenue earned', 'Payments received', 'Channel fees', 'Expenses', 'Net', 'Refunds', 'Net received'].map((x, i) => h('th', { class: i ? 'num' : null }, x)))),
          h('tbody', null,
            t.months.map((m) => row(`${MONTHS[Number(m.month.slice(5)) - 1]} ${year}`, m)),
            t.quarters.map((q) => row(`${q.quarter} total`, q, true)),
            row(`${year} total`, t.totals, true))))),
        h('div', { class: 'card' },
          h('h2', null, 'For your bookkeeper'),
          h('ul', { class: 'muted small' },
            h('li', null, h('strong', null, 'Revenue earned'), ' counts each night of a stay in the month it happens (cleaning, other fees and extra charges on check-in).'),
            h('li', null, h('strong', null, 'Payments received'), ' is the money actually recorded as received that month (cash, GCash, bank…), after voids. Security deposits are not included.'),
            h('li', null, h('strong', null, 'Refunds'), ' is money paid back to guests that month. ', h('strong', null, 'Net received'), ' is payments less refunds. Money kept from a cancelled stay is in Net received, because you collected it, but not in Revenue earned.'),
            h('li', null, 'Most small hosts registered with BIR report gross receipts quarterly. Your accountant decides which figure and tax option apply to you. BalayHub receipts are acknowledgement receipts, not BIR official receipts.'),
            h('li', null, 'Enter channel fees on each reservation and record expenses so the net figures are complete.'))));
    }
    drawBar({ key: 'stay-reports-tax', values: filters, defaults, load, before: [{ name: 'year', label: 'Year', all: String(thisYear), options: years }] });
    await load();
    el.replaceChildren(pageHead({ title: 'Reports', sub: 'Short-term rentals', actions: exportLink }), tabs, barBox, box);
    return;
  }

  // Performance: one month (default), a whole year, or custom dates.
  const defaults = { period: '', month: '', year: '', from: '', to: '', property_id: '', unit_id: '', channel: '' };
  const filters = initFilters('stay-reports', query, defaults);
  if (!filters.period && filters.year && !query.month) filters.period = 'year'; // old links: ?year=2026
  if (!filters.period) filters.period = periodFromLink(query); // a link with from or to and no period is a custom range
  // A link date that is not a real day (2026-02-30, or text) can't be shown: this month is shown, both link dates are dropped, and the status line says why.
  let linkInvalid = periodFromLink(query) === 'range' && [query.from, query.to].some((v) => v && !isDay(v));
  if (linkInvalid) Object.assign(filters, { period: '', from: '', to: '' });
  // initFilters() holds back a range that runs backwards. A shared link keeps its real dates on screen; load() says why.
  // A link date outside 2000 to 2100 is never put back on screen: the status line names that problem instead.
  if (filters.period === 'range' && isDay(query.from) && isDay(query.to) && query.to < query.from && !outOfWindow(query.from) && !outOfWindow(query.to)) { filters.from = query.from; filters.to = query.to; }
  let windowLink = filters.period === 'range' && [query.from, query.to].some((v) => isDay(v) && outOfWindow(v));
  // The period controls sit flat in the filter bar's row (.flt__period in app.css), not in a wrapping chip box.
  const periodBox = h('div', { class: 'flt__period' });
  const status = h('span', { class: 'muted small', id: 'stay-report-status' });
  const notice = h('div');
  const typed = {}; // custom dates the person typed that were refused: they stay in their box until fixed (#20)
  const setPeriod = (patch) => { windowLink = false; linkInvalid = false; if ('period' in patch) { delete typed.from; delete typed.to; } else Object.keys(patch).forEach((k) => delete typed[k]); Object.assign(filters, patch); rememberFilters('stay-reports', filters); load(); };

  // Every refused or missing custom date is marked at its own box (aria-invalid), and the boxes already point at the status line (aria-describedby). N5.
  function markBoxes(serverField) {
    if (filters.period !== 'range') return;
    const bad = new Set(Object.keys(typed));
    if (serverField) bad.add(serverField);
    if (filters.from && filters.to && filters.to < filters.from) bad.add('to');
    if (!(filters.from && filters.to)) ['from', 'to'].forEach((k) => { if (!filters[k]) bad.add(k); });
    if (windowLink) ['from', 'to'].forEach((k) => { if (isDay(filters[k]) && outOfWindow(filters[k])) bad.add(k); });
    for (const [k, name] of [['from', 'From'], ['to', 'To']]) {
      const box = periodBox.querySelector(`[aria-label="${name}"]`);
      if (box) { if (bad.has(k)) box.setAttribute('aria-invalid', 'true'); else box.removeAttribute('aria-invalid'); }
    }
  }

  function drawPeriod() {
    // Drawing the controls again drops focus, so the control that had it gets it back (found by its name).
    const focusName = periodBox.contains(document.activeElement) && document.activeElement.getAttribute('aria-label');
    // Same control size as the Property, Listing and Channel selects, so the whole filter row lines up.
    const sel = h('select', { class: 'input', 'aria-label': 'Period', onchange: (e) => setPeriod(periodPatch(e.target.value)) },
      [['', 'Month'], ['year', 'Whole year'], ['range', 'Custom dates']].map(([v, t]) => h('option', { value: v, selected: filters.period === v }, t)));
    let inputs;
    if (filters.period === 'year') {
      inputs = h('select', { class: 'input', 'aria-label': 'Year', onchange: (e) => setPeriod({ year: e.target.value }) },
        [thisYear, thisYear - 1, thisYear - 2].map((y) => h('option', { value: y, selected: String(y) === (filters.year || String(thisYear)) }, String(y))));
    } else if (filters.period === 'range') {
      // The two dates stay together as one unit (the same .flt__range markup as the daterange fields in filters.js).
      // A year outside 2000 to 2100 is flagged at its own box, the status line under the bar says why, and nothing is sent.
      const shown = periodBoxes(typed, filters);
      const dateBox = (name, key) => h('input', { class: 'input', type: 'date', value: shown[key], 'aria-label': name, 'aria-describedby': 'stay-report-status', 'aria-invalid': typed[key] !== undefined ? 'true' : null,
        onchange: (e) => {
          if (outOfWindow(e.target.value)) { typed[key] = e.target.value; e.target.setAttribute('aria-invalid', 'true'); status.textContent = OUT_OF_WINDOW + ' ' + refusedDatesText(typed); exportReady(false, 'Fix the dates to export.'); /* the page says this date isn't used, so the export can't use the old one either (D-118) */ return; }
          setPeriod({ [key]: e.target.value });
        } });
      inputs = h('div', { class: 'flt__range' }, dateBox('From', 'from'), h('span', { 'aria-hidden': 'true' }, '–'), dateBox('To', 'to'));
    } else {
      inputs = h('input', { class: 'input', type: 'month', value: filters.month || todayManila().slice(0, 7), 'aria-label': 'Month', onchange: (e) => e.target.value && setPeriod({ month: e.target.value }) });
    }
    periodBox.replaceChildren(sel, inputs);
    const again = focusName && periodBox.querySelector(`[aria-label="${focusName}"]`);
    if (again) again.focus();
  }

  async function load() {
    drawPeriod();
    setUrl(changed(filters, defaults));
    // A range that ends before it starts is never sent: this month is shown, and the dates stay in the boxes until fixed.
    const backwards = filters.period === 'range' && Boolean(filters.from && filters.to) && filters.to < filters.from;
    let periodQ;
    if (filters.period === 'year') periodQ = { year: filters.year || thisYear };
    else if (filters.period === 'range' && filters.from && filters.to && !backwards) periodQ = { from: filters.from, to: filters.to };
    else periodQ = { month: filters.month || todayManila().slice(0, 7) };
    status.textContent = linkInvalid ? 'The dates in this link aren\'t valid. Showing this month for now.'
      : windowLink ? `${OUT_OF_WINDOW} Showing this month for now.`
      : backwards ? 'The end date must be after the start date. Showing this month for now.'
      : filters.period === 'range' && !(filters.from && filters.to) ? 'Choose both dates. Showing this month for now.' : '';
    if (Object.keys(typed).length) status.textContent = `${OUT_OF_WINDOW} ` + refusedDatesText(typed); // refused typed dates win (#20)
    markBoxes();
    const apiQ = qs({ ...periodQ, ...scopeOf(filters) });
    // A custom range is exported only once both dates are set, run forwards (#28), span at most two years (D-117) and no typed date is refused (D-118).
    const refused = Object.keys(typed).length > 0;
    const tooLong = filters.period === 'range' && Boolean(filters.from && filters.to) && !backwards && spanDays(filters.from, filters.to) > 731;
    const exportOk = !refused && (filters.period !== 'range' || Boolean(filters.from && filters.to && !backwards && !tooLong));
    exportReady(exportOk, refused ? 'Fix the dates to export.' : tooLong ? 'Choose up to two years to export.' : exportHint({ from: filters.from, to: filters.to }));
    if (exportOk) exportLink.href = `/api/stay-reports/export${apiQ}`;
    let r;
    try { r = await get(`/stay-reports${apiQ}`); } catch (err) {
      const fe = dateFieldError(err);
      if (fe) { // keep the last report, say why under the bar and mark the box (#22)
        status.textContent = fe.text;
        markBoxes(fe.field === 'to' ? 'to' : 'from');
        return;
      }
      fail(err); return;
    }
    // A month that isn't valid is replaced by the month used, here and in the month box, and the page says so.
    if (r.month_invalid) { filters.month = r.period; drawPeriod(); setUrl(changed(filters, defaults)); }
    notice.replaceChildren(r.month_invalid ? h('div', { class: 'alert alert--warn', role: 'alert' }, `That month isn't valid. Showing ${monthName(r.period)}.`) : '');
    if (r.partial && !status.textContent) status.textContent = 'Includes upcoming confirmed stays.';
    // The note under the totals names the period on screen. A bad month was replaced by the server's month, which is r.period.
    const when = periodQ.year ? String(periodQ.year) : periodQ.from ? 'the dates you chose' : monthName(r.period);
    const t = r.totals;
    const narrowed = filters.property_id || filters.unit_id || filters.channel;
    if (!t.nights && !t.stays) {
      box.replaceChildren(h('div', { class: 'card' }, emptyState({ iconName: 'chart', title: narrowed ? 'No results found' : 'No stays in this period',
        text: narrowed ? 'Nothing matches these filters in this period. Try removing a filter or choosing another period.' : 'Choose another month, or add reservations.' })));
      return;
    }
    box.replaceChildren(
      h('div', { class: 'card' },
        h('div', { class: 'grid grid--4 stats stats--stack-phone' },
          stat('Revenue', peso(t.revenue), [`${t.stays} stay${t.stays === 1 ? '' : 's'} · ${t.nights} nights`, h('br'), `Rooms ${peso(t.accommodation)}`, h('br'), `Cleaning and extras ${peso(t.fees)}`]),
          stat('Occupancy', pct(t.occupancy), 'booked nights ÷ open nights'),
          stat('Avg nightly rate', peso(t.adr), `RevPAR ${peso(t.revpar)}`),
          stat('Net (before refunds)', peso(t.net), r.expenses_excluded ? `${peso(t.channel_fees)} channel fees · expenses not split by channel` : `${peso(t.channel_fees)} channel fees · ${peso(t.expenses)} expenses`)),
        h('p', { class: 'muted small' }, `Average stay ${t.avg_stay} nights (whole stays, check-ins in this period)${t.cancelled ? ` · ${t.cancelled} cancelled` : ''}.`),
        // Channel stays with no fee make the net look higher than it is (per channel, linked to those bookings).
        ...missingFeeNotes(r.missing_fees, (c) => `#/reservations${qs({ view: 'all', channel: c, from: r.from, to: lastDay(r.to_exclusive), property_id: filters.property_id, unit_id: filters.unit_id })}`),
        h('p', { class: 'muted small' }, 'Refunds aren\'t deducted here. Profit and loss shows the net after refunds.'),
        h('p', { class: 'muted small' }, `Counts nights in ${when}, including upcoming confirmed stays. Profit and loss counts only stays that have checked out.`),
        h('p', { class: 'muted small' }, 'Rooms counted by night; cleaning and extras by check-in.')),
      h('div', { class: 'grid grid--2' },
        h('div', { class: 'card' }, h('h2', null, 'Revenue by channel'),
          shareBars(r.channels, (c) => c.revenue, (c) => c.label),
          h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact' },
            h('thead', null, h('tr', null, ['Channel', 'Stays', 'Nights', 'Avg rate', 'Channel fees'].map((x, i) => h('th', { class: i ? 'num' : null }, x)))),
            h('tbody', null, r.channels.map((c) => h('tr', null, h('td', null, c.label), h('td', { class: 'num' }, String(c.stays)), h('td', { class: 'num' }, String(c.nights)),
              h('td', { class: 'num' }, peso(c.adr)), h('td', { class: 'num' }, peso(c.channel_fees)))))))),
        h('div', { class: 'card' }, h('h2', null, 'Expenses'),
          r.expenses_excluded ? h('p', { class: 'muted' }, 'Expenses aren\'t split by channel, so they are left out while a channel is chosen.')
            : r.expenses_by_category.length ? h('dl', { class: 'dl' }, r.expenses_by_category.map((e) => [h('dt', null, label(e.category)), h('dd', null, peso(e.amount))]))
              : h('p', { class: 'muted' }, 'No expenses recorded for this period.'),
          h('p', { class: 'small' }, h('a', { href: '#/rent?tab=expenses', class: 'link-tap' }, 'Record an expense')))),
      Array.isArray(r.by_source) && r.by_source.length > 0 && h('div', { class: 'card' }, h('h2', null, 'Direct bookings by source'),
        h('p', { class: 'muted small' }, 'Booked total counts the whole booking from its check-in date. Revenue by channel counts only the nights in this month.'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact' },
          h('thead', null, h('tr', null, ['Source', 'Stays', 'Nights', 'Booked total (check-in basis)'].map((x, i) => h('th', { class: i ? 'num' : null }, x)))),
          h('tbody', null, r.by_source.map((s) => h('tr', null, h('td', null, s.source ? (SOURCE_LABEL[s.source] || s.source) : 'Not tagged'),
            h('td', { class: 'num' }, String(s.stays)), h('td', { class: 'num' }, String(s.nights)), h('td', { class: 'num' }, peso(s.revenue))))))),
        r.by_source.some((s) => !s.source) && h('p', { class: 'muted small' }, 'Booked without a ?src= link, or entered by hand.')),
      h('div', { class: 'card card--flush' },
        h('div', { class: 'card__head', style: { padding: '16px 16px 0' } }, h('h2', null, 'By listing')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact' },
          h('thead', null, h('tr', null, ['Listing', 'Nights', 'Occupancy', 'Avg rate', 'Revenue', 'Of which cleaning & extras', 'Channel fees', 'Expenses', 'Net'].map((x, i) => h('th', { class: i ? 'num' : null }, x)))),
          h('tbody', null, r.units.map((u) => h('tr', null,
            h('td', null, u.unit_name, h('div', { class: 'muted small' }, u.property_name)),
            h('td', { class: 'num' }, String(u.nights)), h('td', { class: 'num' }, pct(u.occupancy)), h('td', { class: 'num' }, peso(u.adr)),
            h('td', { class: 'num' }, peso(u.revenue)), h('td', { class: 'num' }, peso(u.fees)), h('td', { class: 'num' }, peso(u.channel_fees)), h('td', { class: 'num' }, peso(u.expenses)), h('td', { class: 'num' }, peso(u.net)))),
          Number(r.building_expenses) > 0 && h('tr', null, h('td', { colspan: 7 }, 'Whole-property expenses'), h('td', { class: 'num' }, peso(r.building_expenses)), h('td', null, '')))))));
  }
  drawBar({ key: 'stay-reports', values: filters, defaults, load, extra: periodBox });
  await load();
  exportLink.setAttribute('aria-describedby', 'stay-report-export-note');
  el.replaceChildren(pageHead({ title: 'Reports', sub: 'Short-term rentals', actions: h('div', { class: 'chips' }, exportLink, exportNote) }), tabs, barBox, status, notice, box);
}
