// Screen 7 — Reports. Figures are calculated from recorded payments, charges and expenses.

import { get, qs } from '../api.js';
import { h, icon, peso, fmtDate, fmtMonth, label, emptyState, pageHead, todayManila } from '../ui.js';
import { initFilters, filterBar, rememberFilters, changed, dateOutsideWindow } from '../filters.js';

// An archived tenant reads "(archived)"; one who has moved out reads "(former)".
const tenantTag = (x) => (x.tenant_status === 'archived' ? ' (archived)' : x.lease_status !== 'active' ? ' (former)' : '');

const PROPERTY_TYPES = ['apartment', 'boarding_house', 'condominium', 'house', 'commercial', 'dormitory', 'other'];

function presets(today) {
  const [y, m] = today.split('-').map(Number);
  const iso = (yy, mm, dd) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  return {
    this_month: ['This month', iso(y, m, 1), today],
    last_month: ['Last month', iso(y, m - 1, 1), iso(y, m, 0)],
    this_year: ['This year', iso(y, 1, 1), today],
    last_12: ['Last 12 months', iso(y, m - 11, 1), today],
    last_year: ['Last year', iso(y - 1, 1, 1), iso(y - 1, 12, 31)],
  };
}

export async function reportsView(el, { query }) {
  const today = todayManila();
  const P = presets(today);
  // The period is remembered by name ("This month" stays current); dates only for a custom range.
  const defaults = { period: 'this_month', from: '', to: '', property_id: '', property_type: '' };
  const filters = initFilters('reports', query, defaults);
  // The bar drops a from or to outside 2000 to 2100 before this page reads the link, so the note names that until the person changes the bar.
  let windowNote = dateOutsideWindow(query.from) || dateOutsideWindow(query.to);
  // Old links carry only from/to: match them to a preset, or treat them as a custom range.
  if ((query.from || query.to) && !query.period) {
    const match = Object.entries(P).find(([, [, f, t]]) => f === query.from && t === query.to);
    Object.assign(filters, match ? { period: match[0], from: '', to: '' } : { period: 'custom' });
  }
  if (!P[filters.period] && filters.period !== 'custom') filters.period = 'this_month';
  const { properties } = await get('/properties');
  const types = PROPERTY_TYPES.filter((t) => properties.some((p) => p.property_type === t));
  const body = h('div');
  const barBox = h('div', { class: 'no-print' });
  const exportLink = h('a', { class: 'btn btn--primary', download: '' }, 'Export (Excel / CSV)');
  const exportHint = h('span', { class: 'muted small' }, 'Pick both dates to export.');
  // Export has no address until the range is complete: say so to the eye and to a screen reader.
  const exportReady = (ready) => {
    exportLink.className = ready ? 'btn btn--primary' : 'btn btn--secondary';
    exportHint.hidden = ready;
    if (ready) exportLink.removeAttribute('aria-disabled'); else { exportLink.removeAttribute('href'); exportLink.setAttribute('aria-disabled', 'true'); }
  };

  // The dates the report runs for. A custom range runs only once both dates are set (see load()).
  const range = () => (filters.period === 'custom'
    ? { from: filters.from, to: filters.to }
    : { from: P[filters.period][1], to: P[filters.period][2] });
  const apiParams = () => ({ ...range(), property_id: filters.property_id, property_type: filters.property_type });

  let last = { ...filters };
  function renderBar() {
    barBox.replaceChildren(filterBar({
      key: 'reports', values: filters, defaults,
      onChange: () => {
        windowNote = false;
        // Picking dates makes the period "Custom"; picking a preset clears the dates.
        let rebuild = false;
        if (filters.from !== last.from || filters.to !== last.to) { if (filters.from || filters.to) filters.period = 'custom'; rebuild = filters.period !== last.period; }
        else if (filters.period !== last.period && filters.period !== 'custom') { filters.from = ''; filters.to = ''; rebuild = true; }
        if (filters.period === 'custom' && !filters.from && !filters.to && last.period !== 'custom') {
          Object.assign(filters, { from: P[last.period]?.[1] || P.this_month[1], to: P[last.period]?.[2] || today });
          rebuild = true;
        }
        last = { ...filters };
        if (rebuild) { rememberFilters('reports', filters); renderBar(); }
        load();
      },
      quick: [
        { name: 'period', label: 'Period', all: false, options: [...Object.entries(P).map(([k, [t]]) => [k, t]), ['custom', 'Custom range']] },
        properties.length > 1 && { name: 'property_id', label: 'Property', all: 'All properties', options: properties.map((p) => [p.property_id, p.property_name]) },
      ].filter(Boolean),
      more: [
        { name: 'from', label: 'Custom dates', type: 'daterange', keys: ['from', 'to'] },
        types.length > 1 && { name: 'property_type', label: 'Property type', all: 'All types', options: types.map((t) => [t, label(t)]) },
      ].filter(Boolean),
    }));
  }

  async function load() {
    history.replaceState(null, '', `#/reports${qs(changed(filters, defaults))}`);
    // A custom range needs both dates. With neither (filters.js clears both when the pair runs backwards) or only one
    // (a bad date in the link, or one side cleared), there is nothing to report on yet.
    const neither = filters.period === 'custom' && !filters.from && !filters.to;
    const one = filters.period === 'custom' && Boolean(filters.from) !== Boolean(filters.to);
    if (neither || one) {
      exportReady(false);
      body.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'muted' }, windowNote
        ? 'The dates in this link must be between 2000 and 2100. Pick both dates to see this range.'
        : 'Pick both dates to see this range.')));
      return;
    }
    exportReady(true);
    exportLink.href = `/api/reports/export${qs(apiParams())}`;
    body.replaceChildren(h('div', { class: 'skeleton' }));
    let r;
    try { r = await get(`/reports${qs(apiParams())}`); } catch (err) {
      body.replaceChildren(h('div', { class: 'alert alert--error' }, err.message));
      return;
    }
    // Links into Rent & Expenses carry the same period and property.
    const { from, to } = range();
    const scoped = (tab, extra = {}) => `#/rent${qs({ tab, from, to, property_id: filters.property_id, ...extra })}`;
    const t = r.totals;
    const hasActivity = Number(t.collected) || Number(t.expenses) || Number(t.billed) || Number(t.outstanding);
    if (!hasActivity) {
      body.replaceChildren(h('div', { class: 'card' }, emptyState({
        iconName: 'chart', title: 'No transactions in this period',
        text: filters.property_id || filters.property_type
          ? 'Nothing was recorded for these filters. Try another period, or remove the property filter.'
          : 'Reports are built from the payments and expenses you record. Choose another period, or record payments to see results here.',
        action: h('a', { class: 'btn btn--secondary', href: '#/rent' }, 'Go to Rent & Expenses'),
      })));
      return;
    }
    const metric = (lbl, value, href, tone, sub) => h('a', { class: `stat${tone ? ` stat--${tone}` : ''}`, href },
      h('div', { class: 'stat__label' }, lbl), h('div', { class: 'stat__value' }, peso(value)), sub && h('div', { class: 'stat__sub' }, sub));
    const maxMonthly = Math.max(1, ...r.monthly.map((m) => Math.max(Number(m.collected), Number(m.expenses))));

    body.replaceChildren(
      h('div', { class: 'stats' },
        metric('Rent collected', t.collected, scoped('payments'), 'good', `Billed ${peso(t.billed)}`),
        metric('Expenses', t.expenses, scoped('expenses')),
        metric('Net operating result', t.net, scoped('payments'), Number(t.net) < 0 ? 'alert' : null, 'Collected − expenses'),
        metric('Outstanding rent', t.outstanding, `#/rent${qs({ status: 'outstanding', property_id: filters.property_id })}`, Number(t.overdue) > 0 ? 'alert' : null, `As of today · ${peso(t.overdue)} overdue`)),
      h('div', { class: 'card' },
        h('div', { class: 'card__head' }, h('h2', null, 'By property')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'Property'), h('th', { class: 'num' }, 'Occupied'), h('th', { class: 'num' }, 'Collected'), h('th', { class: 'num' }, 'Expenses'), h('th', { class: 'num' }, 'Net'), h('th', { class: 'num' }, 'Outstanding'))),
          h('tbody', null, r.by_property.map((p) => h('tr', null,
            h('td', null, h('a', { href: `#/properties/${p.property_id}` }, p.property_name)),
            h('td', { class: 'num' }, `${p.occupied}/${p.units}`),
            h('td', { class: 'num' }, peso(p.collected)),
            h('td', { class: 'num' }, peso(p.expenses)),
            h('td', { class: `num${Number(p.net) < 0 ? ' amount--neg' : ''}` }, peso(p.net)),
            h('td', { class: 'num' }, peso(p.outstanding))))),
          h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td', { class: 'num' }, `${r.by_property.reduce((s, p) => s + Number(p.occupied), 0)}/${r.by_property.reduce((s, p) => s + Number(p.units), 0)}`), h('td', { class: 'num' }, peso(t.collected)), h('td', { class: 'num' }, peso(t.expenses)), h('td', { class: 'num' }, peso(t.net)), h('td', { class: 'num' }, peso(t.outstanding))))))),
      // The By month table has five columns, so it gets the full width (half of a two-column grid hid Net at 1280).
      h('div', { class: 'card', style: { marginTop: '16px' } },
          h('div', { class: 'card__head' }, h('h2', null, 'By month')),
          h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
            h('thead', null, h('tr', null, h('th', null, 'Month'), h('th', null, h('span', { class: 'sr-only' }, 'Collected and expenses')), h('th', { class: 'num' }, 'Collected'), h('th', { class: 'num' }, 'Expenses'), h('th', { class: 'num' }, 'Net'))),
            h('tbody', null, r.monthly.map((m) => h('tr', null,
              h('td', null, fmtMonth(m.month)),
              h('td', { style: { minWidth: '90px' } },
                h('div', { class: 'bar', title: `Collected ${peso(m.collected)}` }, h('span', { style: { width: `${(Number(m.collected) / maxMonthly) * 100}%` } })),
                h('div', { class: 'bar', title: `Expenses ${peso(m.expenses)}`, style: { marginTop: '4px' } }, h('span', { style: { width: `${(Number(m.expenses) / maxMonthly) * 100}%`, background: '#c2410c' } }))),
              h('td', { class: 'num' }, peso(m.collected)),
              h('td', { class: 'num' }, peso(m.expenses)),
              h('td', { class: `num${Number(m.net) < 0 ? ' amount--neg' : ''}` }, peso(m.net))))))),
          h('p', { class: 'muted small', style: { marginTop: '8px' } }, 'Bars: green = collected, orange = expenses.')),
      h('div', { class: 'card', style: { marginTop: '16px' } },
          h('div', { class: 'card__head' }, h('h2', null, 'Expenses by category')),
          r.by_category.length ? h('ul', { class: 'list' }, r.by_category.map((c) => h('li', null, h('a', { class: 'row', href: scoped('expenses', { category: c.category }) },
            h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, label(c.category)), h('span', { class: 'row__sub' }, `${c.count} entr${c.count === 1 ? 'y' : 'ies'}`)),
            h('div', { class: 'row__end' }, h('span', { class: 'amount' }, peso(c.amount)))))))
            : h('p', { class: 'muted' }, 'No expenses in this period.')),
      h('div', { class: 'card' },
        h('div', { class: 'card__head' }, h('h2', null, 'Outstanding balances (as of today)')),
        r.outstanding.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'Tenant'), h('th', null, 'Unit'), h('th', { class: 'num' }, 'Outstanding'), h('th', { class: 'num' }, 'Overdue'), h('th', null, 'Overdue since'))),
          h('tbody', null, r.outstanding.map((o) => h('tr', null,
            h('td', null, h('a', { href: `#/tenants/${o.tenant_id}` }, o.tenant_name), tenantTag(o) && h('span', { class: 'muted small' }, tenantTag(o))),
            h('td', null, `${o.property_name}, ${o.unit_name}`),
            h('td', { class: 'num' }, peso(o.outstanding)),
            h('td', { class: `num${Number(o.overdue) > 0 ? ' amount--neg' : ''}` }, peso(o.overdue)),
            h('td', null, o.oldest_overdue ? fmtDate(o.oldest_overdue) : '—'))))))
          : h('p', { class: 'muted' }, 'No outstanding rent. 🎉')),
      h('p', { class: 'muted small', style: { marginTop: '12px' } }, `Period ${fmtDate(r.from)} – ${fmtDate(r.to)}. Collected and expenses use the date money was received or spent. Voided entries are excluded. Amounts in PHP.`),
    );
  }

  renderBar();
  el.replaceChildren(
    pageHead({
      title: 'Reports', sub: 'Income, expenses and unpaid rent for any period',
      actions: [exportLink, exportHint, h('button', { class: 'btn btn--secondary', onclick: () => window.print() }, 'Print / PDF'), h('a', { class: 'btn btn--ghost', href: '#/dashboard' }, icon('home'), 'Dashboard')],
    }),
    barBox,
    body);
  await load();
}
