// Reports for short-term rentals: performance by period, by channel and listing,
// and the yearly income summary for your bookkeeper.

import { get } from '../api.js';
import { h, peso, pageHead, todayManila, emptyState } from '../ui.js';
import { navigate } from '../app.js';

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
  const tab = query.tab === 'tax' ? 'tax' : 'performance';
  const thisYear = Number(todayManila().slice(0, 4));
  const go = (q) => navigate(`#/stay-reports?${new URLSearchParams({ tab, ...q })}`);
  const tabs = h('div', { class: 'tabs', role: 'tablist' },
    h('button', { role: 'tab', 'aria-selected': String(tab === 'performance'), class: tab === 'performance' ? 'is-active' : '', onclick: () => navigate('#/stay-reports') }, 'Performance'),
    h('button', { role: 'tab', 'aria-selected': String(tab === 'tax'), class: tab === 'tax' ? 'is-active' : '', onclick: () => navigate('#/stay-reports?tab=tax') }, 'Income summary (for taxes)'));

  if (tab === 'tax') {
    const year = /^\d{4}$/.test(query.year || '') ? Number(query.year) : thisYear;
    const t = await get(`/stay-reports/tax?year=${year}`);
    const yearSel = h('select', { class: 'input input--sm', 'aria-label': 'Year', onchange: (e) => go({ year: e.target.value }) },
      [thisYear, thisYear - 1, thisYear - 2].map((y) => h('option', { value: y, selected: y === year }, String(y))));
    const row = (label, x, strong) => h('tr', { class: strong ? 'is-total' : null },
      h('td', null, label), h('td', { class: 'num' }, peso(x.revenue)), h('td', { class: 'num' }, peso(x.received)),
      h('td', { class: 'num' }, peso(x.channel_fees)), h('td', { class: 'num' }, peso(x.expenses)), h('td', { class: 'num' }, peso(x.net)));
    el.replaceChildren(
      pageHead({ title: 'Reports', sub: 'Short-term rentals', actions: h('a', { class: 'btn btn--secondary', href: `/api/stay-reports/export?kind=tax&year=${year}` }, 'Download CSV') }),
      tabs,
      h('div', { class: 'toolbar' }, yearSel),
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
    return;
  }

  // Performance
  const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : null;
  const year = !month && /^\d{4}$/.test(query.year || '') ? query.year : null;
  const qs = month ? `month=${month}` : year ? `year=${year}` : `month=${todayManila().slice(0, 7)}`;
  const r = await get(`/stay-reports?${qs}`);
  const t = r.totals;
  const monthInput = h('input', { class: 'input input--sm', type: 'month', value: month || (year ? '' : todayManila().slice(0, 7)), 'aria-label': 'Month', onchange: (e) => e.target.value && go({ month: e.target.value }) });
  const yearSel = h('select', { class: 'input input--sm', 'aria-label': 'Whole year', onchange: (e) => (e.target.value ? go({ year: e.target.value }) : go({})) },
    h('option', { value: '' }, 'Whole year…'), [thisYear, thisYear - 1].map((y) => h('option', { value: y, selected: String(y) === year }, String(y))));
  el.replaceChildren(
    pageHead({ title: 'Reports', sub: 'Short-term rentals', actions: h('a', { class: 'btn btn--secondary', href: `/api/stay-reports/export?${qs}` }, 'Download CSV') }),
    tabs,
    h('div', { class: 'toolbar' }, monthInput, yearSel, r.partial && h('span', { class: 'muted small' }, 'Includes upcoming confirmed stays.')),
    !t.nights && !t.stays ? h('div', { class: 'card' }, emptyState({ iconName: 'chart', title: 'No stays in this period', text: 'Choose another month, or add reservations.' })) : [
      h('div', { class: 'card' },
        h('div', { class: 'grid grid--4 stats' },
          stat('Revenue', peso(t.revenue), `${t.stays} stay${t.stays === 1 ? '' : 's'} · ${t.nights} nights`),
          stat('Occupancy', pct(t.occupancy), 'booked nights ÷ open nights'),
          stat('Avg nightly rate', peso(t.adr), `RevPAR ${peso(t.revpar)}`),
          stat('Net after fees & expenses', peso(t.net), `${peso(t.channel_fees)} fees · ${peso(t.expenses)} expenses`)),
        h('p', { class: 'muted small' }, `Average stay ${t.avg_stay} nights${t.cancelled ? ` · ${t.cancelled} cancelled` : ''}.`)),
      h('div', { class: 'grid grid--2' },
        h('div', { class: 'card' }, h('h2', null, 'Revenue by channel'),
          shareBars(r.channels, (c) => c.revenue, (c) => c.label),
          h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact' },
            h('thead', null, h('tr', null, ['Channel', 'Stays', 'Nights', 'Avg rate', 'Fees'].map((x, i) => h('th', { class: i ? 'num' : null }, x)))),
            h('tbody', null, r.channels.map((c) => h('tr', null, h('td', null, c.label), h('td', { class: 'num' }, String(c.stays)), h('td', { class: 'num' }, String(c.nights)),
              h('td', { class: 'num' }, peso(c.adr)), h('td', { class: 'num' }, peso(c.channel_fees)))))))),
        h('div', { class: 'card' }, h('h2', null, 'Expenses'),
          r.expenses_by_category.length ? h('dl', { class: 'dl' }, r.expenses_by_category.map((e) => [h('dt', null, CATEGORY[e.category] || e.category), h('dd', null, peso(e.amount))]))
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
          Number(r.building_expenses) > 0 && h('tr', null, h('td', { colspan: 6 }, 'Building-level expenses (dues etc.)'), h('td', { class: 'num' }, peso(r.building_expenses)), h('td', null, '')))))),
    ]);
}
