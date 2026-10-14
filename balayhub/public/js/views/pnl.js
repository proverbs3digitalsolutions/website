// Profit and loss per unit for one month. Owners and managers only (the server answers 403 to staff).

import { get, qs } from '../api.js';
import { h, peso, pageHead, todayManila, emptyState, toast, fmtMonth } from '../ui.js';
import { initFilters, filterBar, rememberFilters, changed } from '../filters.js';

const neg = (v) => Number(v) < 0;
const money = (v) => h('span', { class: neg(v) ? 'amount--neg' : null }, peso(v));
// A month is YYYY-MM with a month 01 to 12 and a year 2000 to 2100 (the window every date box uses).
export const MONTH_RE = /^(20\d\d|2100)-(0[1-9]|1[0-2])$/;
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function stat(label, value, sub) {
  return h('div', { class: 'stat stat--flat' }, h('div', { class: 'stat__value' }, value), h('div', { class: 'stat__label' }, label), sub && h('div', { class: 'muted small' }, sub));
}

export async function pnlView(el, { query = {} } = {}) {
  const defaults = { month: '', property_id: '' };
  const filters = initFilters('pnl', query, defaults);
  const thisMonth = todayManila().slice(0, 7);
  const exportLink = h('a', { class: 'btn btn--secondary', download: '' }, 'Download CSV');
  const box = h('div', { 'aria-live': 'polite' }, h('p', { class: 'muted' }, 'Loading…'));
  const notice = h('div');
  // Says which stays the month counts (the check-out rule), and where the check-in counts are.
  const basis = h('p', { class: 'muted small' });
  const monthInput = h('input', { class: 'input input--sm', type: 'month', value: filters.month || thisMonth, 'aria-label': 'Month', onchange: (e) => { if (e.target.value) { filters.month = e.target.value; rememberFilters('pnl', filters); load(); } } });

  let properties = [];
  try {
    const { listings } = await get('/listings');
    properties = [...new Map(listings.map((l) => [l.property_id, l.property_name])).entries()];
  } catch { /* the property filter just stays hidden */ }

  async function load() {
    // A month that isn't YYYY-MM is dropped and the page says so, instead of quietly showing this month.
    const bad = filters.month && !MONTH_RE.test(filters.month);
    if (bad) filters.month = thisMonth;
    const month = filters.month || thisMonth;
    basis.textContent = `Counts stays that checked out in ${fmtMonth(month)}. Upcoming stays are not in this total. Reports counts nights in the month, including upcoming stays.`;
    notice.replaceChildren(bad ? h('div', { class: 'alert alert--warn', role: 'alert' }, `That month isn't valid. Showing ${monthName(month)}.`) : '');
    monthInput.value = month;
    history.replaceState(null, '', `#/pnl${qs(changed(filters, defaults))}`);
    exportLink.href = `/api/reports/pnl.csv${qs({ month, property_id: filters.property_id })}`;
    let r;
    try { r = await get(`/reports/pnl${qs({ month, property_id: filters.property_id })}`); } catch (err) {
      toast(err.message, 'error');
      box.replaceChildren(h('div', { class: 'card' }, emptyState({ iconName: 'chart', title: 'Couldn\'t load profit and loss', text: err.message })));
      return;
    }
    const t = r.totals;
    // Empty means no activity. Every unit in scope gets a row, so the row count says nothing.
    if (!t.stays && !Number(t.expenses) && !Number(t.refunds)) {
      box.replaceChildren(h('div', { class: 'card' }, emptyState({ iconName: 'chart', title: 'Nothing for this month', text: 'No stays or expenses were recorded for this month. Choose another month.' })));
      return;
    }
    const cells = (x) => [x.stays, x.nights].map((n) => h('td', { class: 'num' }, String(n)))
      .concat([x.gross, x.channel_fees, x.refunds, x.expenses].map((n) => h('td', { class: 'num' }, peso(n))), h('td', { class: 'num' }, h('strong', null, money(x.net))));
    box.replaceChildren(
      h('div', { class: 'card' }, h('div', { class: 'grid grid--4 stats' },
        stat('Gross', peso(t.gross), `${t.stays} stay${t.stays === 1 ? '' : 's'} · ${t.nights} nights`),
        stat('Channel fees and refunds', peso(Number(t.channel_fees) + Number(t.refunds)), `${peso(t.channel_fees)} channel fees · ${peso(t.refunds)} refunds`),
        stat('Expenses', peso(t.expenses)),
        h('div', { class: `stat stat--flat${neg(t.net) ? ' stat--alert' : ''}` }, h('div', { class: 'stat__value' }, peso(t.net)), h('div', { class: 'stat__label' }, 'Net'), h('div', { class: 'muted small' }, 'gross − channel fees − refunds − expenses')))),
      h('div', { class: 'card card--flush' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact' },
        h('caption', { class: 'sr-only' }, `Profit and loss per unit for ${fmtMonth(month)}`),
        h('thead', null, h('tr', null, ['Unit', 'Stays', 'Nights', 'Gross', 'Channel fees', 'Refunds', 'Expenses', 'Net'].map((x, i) => h('th', { scope: 'col', class: i ? 'num' : null }, x)))),
        h('tbody', null, r.rows.map((x) => h('tr', null,
          h('td', null, x.unit_id ? x.unit_name : 'Not linked to a unit', x.unit_id && x.property_name && h('div', { class: 'muted small' }, x.property_name)),
          cells(x)))),
        h('tfoot', null, h('tr', { class: 'is-total' }, h('td', null, 'Total'), cells(t)))))),
      h('p', { class: 'muted small' }, 'Cancelled stays are left out, including money kept or refunded on them. The Income summary (for taxes) counts all money received and refunded.'));
  }

  const bar = filterBar({
    key: 'pnl', values: filters, defaults, onChange: load,
    extra: monthInput,
    quick: properties.length > 1 ? [{ name: 'property_id', label: 'Property', all: 'All properties', options: properties }] : [],
  });
  await load();
  el.replaceChildren(pageHead({ title: 'Profit and loss', sub: 'Per unit, by month', actions: exportLink }), basis, notice, bar, box);
}
