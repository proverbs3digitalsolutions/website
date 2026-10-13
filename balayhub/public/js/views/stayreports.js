// Reports for short-term rentals: performance by period, by channel and listing,
// the yearly income summary for your bookkeeper, and security deposits.
// Each tab has its own filters (property, listing, channel, period), remembered per person.

import { get, qs } from '../api.js';
import { h, peso, pageHead, todayManila, emptyState, toast } from '../ui.js';
import { navigate } from '../app.js';
import { initFilters, filterBar, rememberFilters, changed } from '../filters.js';
import { depositsPanel } from './deposits.js';
import { CHANNEL_LABEL } from './reservations.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CATEGORY = { repairs: 'Repairs', utilities: 'Utilities', taxes: 'Taxes', insurance: 'Insurance', association_dues: 'Association dues', supplies: 'Supplies', salaries: 'Salaries', cleaning: 'Cleaning', other: 'Other' };
const pct = (n) => (n === null || n === undefined ? '—' : `${n}%`);

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
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, tabBtn('performance', 'Performance'), tabBtn('tax', 'Income summary (for taxes)'), tabBtn('deposits', 'Deposits'));

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
        h('td', { class: 'num' }, peso(x.channel_fees)), h('td', { class: 'num' }, peso(x.expenses)), h('td', { class: 'num' }, peso(x.net)));
      box.replaceChildren(
        filters.channel ? h('p', { class: 'muted small' }, 'Expenses aren\'t split by channel, so they are left out while a channel is chosen.') : '',
        h('div', { class: 'card' },
          h('div', { class: 'grid grid--4 stats' },
            stat('Revenue earned', peso(t.totals.revenue)), stat('Payments received', peso(t.totals.received)),
            stat('Expenses', peso(t.totals.expenses)), stat('Net income', peso(t.totals.net), 'earned − channel fees − expenses'))),
        h('div', { class: 'card card--flush' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact' },
          h('thead', null, h('tr', null, ['Month', 'Revenue earned', 'Payments received', 'Channel fees', 'Expenses', 'Net'].map((x, i) => h('th', { class: i ? 'num' : null }, x)))),
          h('tbody', null,
            t.months.map((m) => row(`${MONTHS[Number(m.month.slice(5)) - 1]} ${year}`, m)),
            t.quarters.map((q) => row(`${q.quarter} total`, q, true)),
            row(`${year} total`, t.totals, true))))),
        h('div', { class: 'card' },
          h('h2', null, 'For your bookkeeper'),
          h('ul', { class: 'muted small' },
            h('li', null, h('strong', null, 'Revenue earned'), ' counts each night of a stay in the month it happens (cleaning and other fees on check-in).'),
            h('li', null, h('strong', null, 'Payments received'), ' is the money actually recorded as received that month (cash, GCash, bank…), after voids. Security deposits are not included.'),
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
  const periodBox = h('div', { class: 'chips' });
  const status = h('span', { class: 'muted small' });
  const setPeriod = (patch) => { Object.assign(filters, patch); rememberFilters('stay-reports', filters); load(); };

  function drawPeriod() {
    const sel = h('select', { class: 'input input--sm', 'aria-label': 'Period', onchange: (e) => setPeriod({ period: e.target.value }) },
      [['', 'Month'], ['year', 'Whole year'], ['range', 'Custom dates']].map(([v, t]) => h('option', { value: v, selected: filters.period === v }, t)));
    let inputs;
    if (filters.period === 'year') {
      inputs = h('select', { class: 'input input--sm', 'aria-label': 'Year', onchange: (e) => setPeriod({ year: e.target.value }) },
        [thisYear, thisYear - 1, thisYear - 2].map((y) => h('option', { value: y, selected: String(y) === (filters.year || String(thisYear)) }, String(y))));
    } else if (filters.period === 'range') {
      inputs = [
        h('input', { class: 'input input--sm', type: 'date', value: filters.from, 'aria-label': 'From', onchange: (e) => setPeriod({ from: e.target.value }) }),
        h('span', { 'aria-hidden': 'true' }, '–'),
        h('input', { class: 'input input--sm', type: 'date', value: filters.to, 'aria-label': 'To', onchange: (e) => setPeriod({ to: e.target.value }) })];
    } else {
      inputs = h('input', { class: 'input input--sm', type: 'month', value: filters.month || todayManila().slice(0, 7), 'aria-label': 'Month', onchange: (e) => e.target.value && setPeriod({ month: e.target.value }) });
    }
    periodBox.replaceChildren(sel, inputs);
  }

  async function load() {
    drawPeriod();
    setUrl(changed(filters, defaults));
    let periodQ;
    if (filters.period === 'year') periodQ = { year: filters.year || thisYear };
    else if (filters.period === 'range' && filters.from && filters.to) periodQ = { from: filters.from, to: filters.to };
    else periodQ = { month: filters.month || todayManila().slice(0, 7) };
    status.textContent = filters.period === 'range' && !(filters.from && filters.to) ? 'Choose both dates. Showing this month for now.' : '';
    const apiQ = qs({ ...periodQ, ...scopeOf(filters) });
    exportLink.href = `/api/stay-reports/export${apiQ}`;
    let r;
    try { r = await get(`/stay-reports${apiQ}`); } catch (err) { fail(err); return; }
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
          stat('Revenue', peso(t.revenue), `${t.stays} stay${t.stays === 1 ? '' : 's'} · ${t.nights} nights`),
          stat('Occupancy', pct(t.occupancy), 'booked nights ÷ open nights'),
          stat('Avg nightly rate', peso(t.adr), `RevPAR ${peso(t.revpar)}`),
          stat(r.expenses_excluded ? 'Net after channel fees' : 'Net after fees & expenses', peso(t.net), r.expenses_excluded ? `${peso(t.channel_fees)} fees · expenses not split by channel` : `${peso(t.channel_fees)} fees · ${peso(t.expenses)} expenses`)),
        h('p', { class: 'muted small' }, `Average stay ${t.avg_stay} nights${t.cancelled ? ` · ${t.cancelled} cancelled` : ''}.`)),
      h('div', { class: 'grid grid--2' },
        h('div', { class: 'card' }, h('h2', null, 'Revenue by channel'),
          shareBars(r.channels, (c) => c.revenue, (c) => c.label),
          h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact' },
            h('thead', null, h('tr', null, ['Channel', 'Stays', 'Nights', 'Avg rate', 'Fees'].map((x, i) => h('th', { class: i ? 'num' : null }, x)))),
            h('tbody', null, r.channels.map((c) => h('tr', null, h('td', null, c.label), h('td', { class: 'num' }, String(c.stays)), h('td', { class: 'num' }, String(c.nights)),
              h('td', { class: 'num' }, peso(c.adr)), h('td', { class: 'num' }, peso(c.channel_fees)))))))),
        h('div', { class: 'card' }, h('h2', null, 'Expenses'),
          r.expenses_excluded ? h('p', { class: 'muted' }, 'Expenses aren\'t split by channel, so they are left out while a channel is chosen.')
            : r.expenses_by_category.length ? h('dl', { class: 'dl' }, r.expenses_by_category.map((e) => [h('dt', null, CATEGORY[e.category] || e.category), h('dd', null, peso(e.amount))]))
              : h('p', { class: 'muted' }, 'No expenses recorded for this period.'),
          h('p', { class: 'small' }, h('a', { href: '#/rent?tab=expenses' }, 'Record an expense')))),
      h('div', { class: 'card card--flush' },
        h('div', { class: 'card__head', style: { padding: '16px 16px 0' } }, h('h2', null, 'By listing')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact' },
          h('thead', null, h('tr', null, ['Listing', 'Nights', 'Occupancy', 'Avg rate', 'Revenue', 'Fees', 'Expenses', 'Net'].map((x, i) => h('th', { class: i ? 'num' : null }, x)))),
          h('tbody', null, r.units.map((u) => h('tr', null,
            h('td', null, u.unit_name, h('div', { class: 'muted small' }, u.property_name)),
            h('td', { class: 'num' }, String(u.nights)), h('td', { class: 'num' }, pct(u.occupancy)), h('td', { class: 'num' }, peso(u.adr)),
            h('td', { class: 'num' }, peso(u.revenue)), h('td', { class: 'num' }, peso(u.channel_fees)), h('td', { class: 'num' }, peso(u.expenses)), h('td', { class: 'num' }, peso(u.net)))),
          Number(r.building_expenses) > 0 && h('tr', null, h('td', { colspan: 6 }, 'Building-level expenses (dues etc.)'), h('td', { class: 'num' }, peso(r.building_expenses)), h('td', null, '')))))));
  }
  const bar = filterBar({
    key: 'stay-reports', values: filters, defaults, onChange: load,
    extra: periodBox,
    quick: scopeFields,
  });
  await load();
  el.replaceChildren(pageHead({ title: 'Reports', sub: 'Short-term rentals', actions: exportLink }), tabs, bar, status, box);
}
