// Reports for short-term rentals: performance by period, by channel and listing,
// the yearly income summary for your bookkeeper, and security deposits.
// Each tab has its own filters (property, listing, channel, period), remembered per person.

import { get, qs } from '../api.js';
import { h, peso, pageHead, todayManila, emptyState, toast, label } from '../ui.js';
import { navigate } from '../app.js';
import { initFilters, filterBar, rememberFilters, changed, outOfWindow, OUT_OF_WINDOW } from '../filters.js';
import { depositsPanel } from './deposits.js';
import { CHANNEL_LABEL, SOURCE_LABEL } from './reservations.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pct = (n) => (n === null || n === undefined ? '—' : `${n}%`);
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
// A real calendar day as YYYY-MM-DD (2026-02-30 is not).
function isDay(v) {
  const d = new Date(`${v}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
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
  const tabBtn = (key, text) => h('button', { role: 'tab', 'aria-selected': String(tab === key), class: tab === key ? 'is-active' : '', onclick: () => navigate(key === 'performance' ? '#/stay-reports' : `#/stay-reports?tab=${key}`) }, text);
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Report type' }, tabBtn('performance', 'Performance'), tabBtn('tax', 'Income summary (for taxes)'), tabBtn('deposits', 'Deposits'));

  if (tab === 'deposits') {
    const panel = await depositsPanel({ query, onUrl: setUrl });
    el.replaceChildren(pageHead({ title: 'Reports', sub: 'Short-term rentals' }), tabs, panel);
    return;
  }

  // Property / listing / channel filters shared by both report tabs.
  const { listings } = await get('/listings');
  const properties = [...new Map(listings.map((l) => [l.property_id, l.property_name])).entries()];
  const scopeFields = [
    properties.length > 1 && { name: 'property_id', label: 'Property', all: 'All properties', options: properties },
    listings.length > 1 && { name: 'unit_id', label: 'Listing', all: 'All listings', options: listings.map((l) => [l.unit_id, `${l.unit_name}${properties.length > 1 ? ` · ${l.property_name}` : ''}`]) },
    { name: 'channel', label: 'Channel', all: 'All channels', options: Object.entries(CHANNEL_LABEL) },
  ].filter(Boolean);
  const scopeOf = (f) => ({ property_id: f.property_id, unit_id: f.unit_id, channel: f.channel });
  const exportLink = h('a', { class: 'btn btn--secondary', download: '' }, 'Download CSV');
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
    const bar = filterBar({
      key: 'stay-reports-tax', values: filters, defaults, onChange: load,
      quick: [{ name: 'year', label: 'Year', all: String(thisYear), options: years }, ...scopeFields],
    });
    await load();
    el.replaceChildren(pageHead({ title: 'Reports', sub: 'Short-term rentals', actions: exportLink }), tabs, bar, box);
    return;
  }

  // Performance: one month (default), a whole year, or custom dates.
  const defaults = { period: '', month: '', year: '', from: '', to: '', property_id: '', unit_id: '', channel: '' };
  const filters = initFilters('stay-reports', query, defaults);
  if (!filters.period && filters.year && !query.month) filters.period = 'year'; // old links: ?year=2026
  // initFilters() holds back a range that runs backwards. A shared link keeps its real dates on screen; load() says why.
  // A link date outside 2000 to 2100 is never put back on screen: the status line names that problem instead.
  if (filters.period === 'range' && isDay(query.from) && isDay(query.to) && query.to < query.from && !outOfWindow(query.from) && !outOfWindow(query.to)) { filters.from = query.from; filters.to = query.to; }
  let windowLink = filters.period === 'range' && [query.from, query.to].some((v) => isDay(v) && outOfWindow(v));
  // The period controls sit flat in the filter bar's row (.flt__period in app.css), not in a wrapping chip box.
  const periodBox = h('div', { class: 'flt__period' });
  const status = h('span', { class: 'muted small', id: 'stay-report-status' });
  const notice = h('div');
  const setPeriod = (patch) => { windowLink = false; Object.assign(filters, patch); rememberFilters('stay-reports', filters); load(); };

  function drawPeriod() {
    // Drawing the controls again drops focus, so the control that had it gets it back (found by its name).
    const focusName = periodBox.contains(document.activeElement) && document.activeElement.getAttribute('aria-label');
    // Same control size as the Property, Listing and Channel selects, so the whole filter row lines up.
    const sel = h('select', { class: 'input', 'aria-label': 'Period', onchange: (e) => setPeriod({ period: e.target.value }) },
      [['', 'Month'], ['year', 'Whole year'], ['range', 'Custom dates']].map(([v, t]) => h('option', { value: v, selected: filters.period === v }, t)));
    let inputs;
    if (filters.period === 'year') {
      inputs = h('select', { class: 'input', 'aria-label': 'Year', onchange: (e) => setPeriod({ year: e.target.value }) },
        [thisYear, thisYear - 1, thisYear - 2].map((y) => h('option', { value: y, selected: String(y) === (filters.year || String(thisYear)) }, String(y))));
    } else if (filters.period === 'range') {
      // The two dates stay together as one unit (the same .flt__range markup as the daterange fields in filters.js).
      // A year outside 2000 to 2100 is flagged at its own box, the status line under the bar says why, and nothing is sent.
      const dateBox = (name, key) => h('input', { class: 'input', type: 'date', value: filters[key], 'aria-label': name, 'aria-describedby': 'stay-report-status',
        onchange: (e) => {
          if (outOfWindow(e.target.value)) { e.target.setAttribute('aria-invalid', 'true'); status.textContent = OUT_OF_WINDOW; return; }
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
    status.textContent = windowLink ? `${OUT_OF_WINDOW} Showing this month for now.`
      : backwards ? 'The end date must be after the start date. Showing this month for now.'
      : filters.period === 'range' && !(filters.from && filters.to) ? 'Choose both dates. Showing this month for now.' : '';
    const apiQ = qs({ ...periodQ, ...scopeOf(filters) });
    exportLink.href = `/api/stay-reports/export${apiQ}`;
    let r;
    try { r = await get(`/stay-reports${apiQ}`); } catch (err) { fail(err); return; }
    // A month that isn't valid is replaced by the month used, here and in the month box, and the page says so.
    if (r.month_invalid) { filters.month = r.period; drawPeriod(); setUrl(changed(filters, defaults)); }
    notice.replaceChildren(r.month_invalid ? h('div', { class: 'alert alert--warn', role: 'alert' }, `That month isn't valid. Showing ${monthName(r.period)}.`) : '');
    if (r.partial && !status.textContent) status.textContent = 'Includes upcoming confirmed stays.';
    const t = r.totals;
    const narrowed = filters.property_id || filters.unit_id || filters.channel;
    if (!t.nights && !t.stays) {
      box.replaceChildren(h('div', { class: 'card' }, emptyState({ iconName: 'chart', title: narrowed ? 'No results found' : 'No stays in this period',
        text: narrowed ? 'Nothing matches these filters in this period. Try removing a filter or choosing another period.' : 'Choose another month, or add reservations.' })));
      return;
    }
    box.replaceChildren(
      h('div', { class: 'card' },
        h('div', { class: 'grid grid--4 stats' },
          stat('Revenue', peso(t.revenue), [`${t.stays} stay${t.stays === 1 ? '' : 's'} · ${t.nights} nights`, h('br'), `Rooms ${peso(t.accommodation)} · cleaning and extras ${peso(t.fees)}`, h('br'), 'Rooms counted by night; cleaning and extras by check-in.']),
          stat('Occupancy', pct(t.occupancy), 'booked nights ÷ open nights'),
          stat('Avg nightly rate', peso(t.adr), `RevPAR ${peso(t.revpar)}`),
          stat('Net (before refunds)', peso(t.net), r.expenses_excluded ? `${peso(t.channel_fees)} channel fees · expenses not split by channel` : `${peso(t.channel_fees)} channel fees · ${peso(t.expenses)} expenses`)),
        h('p', { class: 'muted small' }, `Average stay ${t.avg_stay} nights (whole stays, check-ins in this period)${t.cancelled ? ` · ${t.cancelled} cancelled` : ''}.`),
        h('p', { class: 'muted small' }, 'Refunds aren\'t deducted here. Profit and loss shows the net after refunds.')),
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
          h('p', { class: 'small' }, h('a', { href: '#/rent?tab=expenses' }, 'Record an expense')))),
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
          Number(r.building_expenses) > 0 && h('tr', null, h('td', { colspan: 7 }, 'Building-level expenses (dues etc.)'), h('td', { class: 'num' }, peso(r.building_expenses)), h('td', null, '')))))));
  }
  const bar = filterBar({
    key: 'stay-reports', values: filters, defaults, onChange: load,
    extra: periodBox,
    quick: scopeFields,
  });
  await load();
  el.replaceChildren(pageHead({ title: 'Reports', sub: 'Short-term rentals', actions: exportLink }), tabs, bar, status, notice, box);
}
