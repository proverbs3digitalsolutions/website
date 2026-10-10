// Screen 7 — Reports. Figures are calculated from recorded payments, charges and expenses.

import { get, qs } from '../api.js';
import { h, icon, peso, fmtDate, fmtMonth, label, emptyState, pageHead, todayManila } from '../ui.js';

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
  const filters = {
    from: query.from || P.this_month[1],
    to: query.to || P.this_month[2],
    property_id: query.property_id || '',
  };
  const { properties } = await get('/properties');
  const body = h('div');
  const fromInput = h('input', { class: 'input', type: 'date', value: filters.from, 'aria-label': 'From' });
  const toInput = h('input', { class: 'input', type: 'date', value: filters.to, 'aria-label': 'To' });
  const propertySelect = h('select', { class: 'input', 'aria-label': 'Property' },
    h('option', { value: '' }, 'All properties'),
    properties.map((p) => h('option', { value: p.property_id, selected: p.property_id === filters.property_id }, p.property_name)));
  const exportLink = h('a', { class: 'btn btn--primary', download: '' }, 'Export (Excel / CSV)');
  const presetSelect = h('select', { class: 'input', 'aria-label': 'Period' },
    Object.entries(P).map(([k, [t, f, to]]) => h('option', { value: k, selected: f === filters.from && to === filters.to }, t)),
    h('option', { value: 'custom', selected: !Object.values(P).some(([, f, to]) => f === filters.from && to === filters.to) }, 'Custom range'));
  presetSelect.addEventListener('change', () => {
    const p = P[presetSelect.value];
    if (!p) return;
    fromInput.value = p[1]; toInput.value = p[2];
    apply();
  });
  [fromInput, toInput].forEach((i) => i.addEventListener('change', () => { presetSelect.value = 'custom'; apply(); }));
  propertySelect.addEventListener('change', apply);

  function apply() {
    filters.from = fromInput.value; filters.to = toInput.value; filters.property_id = propertySelect.value;
    load();
  }

  async function load() {
    history.replaceState(null, '', `#/reports${qs(filters)}`);
    exportLink.href = `/api/reports/export${qs(filters)}`;
    body.replaceChildren(h('div', { class: 'skeleton' }));
    let r;
    try { r = await get(`/reports${qs(filters)}`); } catch (err) {
      body.replaceChildren(h('div', { class: 'alert alert--error' }, err.message));
      return;
    }
    const t = r.totals;
    const hasActivity = Number(t.collected) || Number(t.expenses) || Number(t.billed) || Number(t.outstanding);
    if (!hasActivity) {
      body.replaceChildren(h('div', { class: 'card' }, emptyState({
        iconName: 'chart', title: 'No transactions in this period',
        text: 'Reports are built from the payments and expenses you record. Choose another period, or record payments to see results here.',
        action: h('a', { class: 'btn btn--secondary', href: '#/rent' }, 'Go to Rent & Expenses'),
      })));
      return;
    }
    const metric = (lbl, value, href, tone, sub) => h('a', { class: `stat${tone ? ` stat--${tone}` : ''}`, href },
      h('div', { class: 'stat__label' }, lbl), h('div', { class: 'stat__value' }, peso(value)), sub && h('div', { class: 'stat__sub' }, sub));
    const maxMonthly = Math.max(1, ...r.monthly.map((m) => Math.max(Number(m.collected), Number(m.expenses))));

    body.replaceChildren(
      h('div', { class: 'stats' },
        metric('Rent collected', t.collected, '#/rent?tab=payments', 'good', `Billed ${peso(t.billed)}`),
        metric('Expenses', t.expenses, '#/rent?tab=expenses'),
        metric('Net operating result', t.net, '#/rent?tab=payments', Number(t.net) < 0 ? 'alert' : null, 'Collected − expenses'),
        metric('Outstanding rent', t.outstanding, '#/rent?status=outstanding', Number(t.overdue) > 0 ? 'alert' : null, `As of today · ${peso(t.overdue)} overdue`)),
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
          h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td'), h('td', { class: 'num' }, peso(t.collected)), h('td', { class: 'num' }, peso(t.expenses)), h('td', { class: 'num' }, peso(t.net)), h('td', { class: 'num' }, peso(t.outstanding))))))),
      h('div', { class: 'grid grid--2', style: { marginTop: '16px' } },
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'By month')),
          h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
            h('thead', null, h('tr', null, h('th', null, 'Month'), h('th', null, ''), h('th', { class: 'num' }, 'Collected'), h('th', { class: 'num' }, 'Expenses'), h('th', { class: 'num' }, 'Net'))),
            h('tbody', null, r.monthly.map((m) => h('tr', null,
              h('td', null, fmtMonth(m.month)),
              h('td', { style: { minWidth: '90px' } },
                h('div', { class: 'bar', title: `Collected ${peso(m.collected)}` }, h('span', { style: { width: `${(Number(m.collected) / maxMonthly) * 100}%` } })),
                h('div', { class: 'bar', title: `Expenses ${peso(m.expenses)}`, style: { marginTop: '4px' } }, h('span', { style: { width: `${(Number(m.expenses) / maxMonthly) * 100}%`, background: '#c2410c' } }))),
              h('td', { class: 'num' }, peso(m.collected)),
              h('td', { class: 'num' }, peso(m.expenses)),
              h('td', { class: `num${Number(m.net) < 0 ? ' amount--neg' : ''}` }, peso(m.net))))))),
          h('p', { class: 'muted small', style: { marginTop: '8px' } }, 'Bars: green = collected, orange = expenses.')),
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Expenses by category')),
          r.by_category.length ? h('ul', { class: 'list' }, r.by_category.map((c) => h('li', null, h('a', { class: 'row', href: `#/rent?tab=expenses` },
            h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, label(c.category)), h('span', { class: 'row__sub' }, `${c.count} entr${c.count === 1 ? 'y' : 'ies'}`)),
            h('div', { class: 'row__end' }, h('span', { class: 'amount' }, peso(c.amount)))))))
            : h('p', { class: 'muted' }, 'No expenses in this period.'))),
      h('div', { class: 'card' },
        h('div', { class: 'card__head' }, h('h2', null, 'Outstanding balances (as of today)')),
        r.outstanding.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'Tenant'), h('th', null, 'Unit'), h('th', { class: 'num' }, 'Outstanding'), h('th', { class: 'num' }, 'Overdue'), h('th', null, 'Overdue since'))),
          h('tbody', null, r.outstanding.map((o) => h('tr', null,
            h('td', null, h('a', { href: `#/tenants/${o.tenant_id}` }, o.tenant_name), o.lease_status !== 'active' ? h('span', { class: 'muted small' }, ' (former)') : ''),
            h('td', null, `${o.property_name}, ${o.unit_name}`),
            h('td', { class: 'num' }, peso(o.outstanding)),
            h('td', { class: `num${Number(o.overdue) > 0 ? ' amount--neg' : ''}` }, peso(o.overdue)),
            h('td', null, o.oldest_overdue ? fmtDate(o.oldest_overdue) : '—'))))))
          : h('p', { class: 'muted' }, 'No outstanding rent. 🎉')),
      h('p', { class: 'muted small', style: { marginTop: '12px' } }, `Period ${fmtDate(r.from)} – ${fmtDate(r.to)}. Collected and expenses use the date money was received or spent. Voided entries are excluded. Amounts in PHP.`),
    );
  }

  el.replaceChildren(
    pageHead({
      title: 'Reports', sub: 'Income, expenses and unpaid rent for any period',
      actions: [exportLink, h('button', { class: 'btn btn--secondary', onclick: () => window.print() }, 'Print / PDF'), h('a', { class: 'btn btn--ghost', href: '#/dashboard' }, icon('home'), 'Dashboard')],
    }),
    h('div', { class: 'card no-print', style: { marginBottom: '16px' } },
      h('div', { class: 'form-row form-row--2' },
        h('div', { class: 'field' }, h('label', null, 'Period'), presetSelect),
        h('div', { class: 'field' }, h('label', null, 'Property'), propertySelect)),
      h('div', { class: 'form-row form-row--2', style: { marginTop: '12px' } },
        h('div', { class: 'field' }, h('label', null, 'From'), fromInput),
        h('div', { class: 'field' }, h('label', null, 'To'), toInput))),
    body);
  await load();
}
