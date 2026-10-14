// Screen 3 — Dashboard. Every number comes from saved records via /api/dashboard.

import { get } from '../api.js';
import { h, icon, peso, fmtDate, fmtMonth, badge, emptyState, label, unitLabel } from '../ui.js';
import { state } from '../app.js';
import { recordPaymentModal } from './rent.js';
import { newMaintenanceModal } from './maintenance.js';
import { newTenantModal } from './tenants.js';
import { newPropertyModal } from './properties.js';

function stat({ label: l, value, sub, href, tone }) {
  return h(href ? 'a' : 'div', { class: `stat${tone ? ` stat--${tone}` : ''}`, href },
    h('div', { class: 'stat__label' }, l), h('div', { class: 'stat__value' }, value), sub && h('div', { class: 'stat__sub' }, sub));
}

export async function dashboardView(el, { rerender }) {
  const d = await get('/dashboard');
  const p = d.portfolio;
  const isOwner = state.user.role === 'owner';
  const canManage = state.user.role !== 'staff';

  const head = h('div', { class: 'page-head' },
    h('div', { class: 'page-head__title' }, h('h1', null, 'Dashboard'),
      h('p', null, `${state.user.organization_name} · ${fmtMonth(d.month_start)}`)));

  if (p.properties === 0) {
    el.replaceChildren(head, h('div', { class: 'card' }, emptyState({
      iconName: 'building',
      title: isOwner ? 'Add your first property' : 'No properties assigned yet',
      text: isOwner
        ? 'Start by adding a property (an apartment building, boarding house or house) and its rental units. Your occupancy, rent and expense summary will appear here.'
        : 'Ask the workspace owner to assign you to a property. Once assigned, its tenants, rent and repairs will show here.',
      action: isOwner && h('button', { class: 'btn btn--primary', onclick: () => newPropertyModal() }, icon('plus'), 'Add property'),
    })));
    return;
  }

  const occupancyPct = p.units ? Math.round((p.occupied / p.units) * 100) : 0;
  const stats = h('div', { class: 'stats' },
    stat({ label: 'Properties', value: p.properties, sub: `${p.units} unit${p.units === 1 ? '' : 's'}`, href: '#/properties' }),
    stat({ label: 'Occupied', value: `${p.occupied}/${p.units}`, sub: `${p.vacant} vacant${p.unavailable ? ` · ${p.unavailable} unavailable` : ''}`, href: '#/properties' }),
    stat({ label: 'Rent collected', value: peso(d.collected_this_month), sub: `This month · ${d.payments_this_month} payment${d.payments_this_month === 1 ? '' : 's'}`, href: '#/rent?tab=payments', tone: 'good' }),
    stat({ label: 'Outstanding', value: peso(d.outstanding), sub: Number(d.overdue) > 0 ? `${peso(d.overdue)} overdue` : 'Nothing overdue', href: '#/rent?status=outstanding', tone: Number(d.overdue) > 0 ? 'alert' : null }),
  );

  const quick = h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Quick actions')),
    h('div', { class: 'quick' },
      isOwner ? h('button', { onclick: () => newPropertyModal() }, icon('building'), 'Add property')
        : h('a', { href: '#/properties' }, icon('building'), 'Properties'),
      canManage ? h('button', { onclick: () => newTenantModal() }, icon('users'), 'Add tenant')
        : h('a', { href: '#/tenants' }, icon('users'), 'Tenants'),
      h('button', { onclick: () => recordPaymentModal({ onSaved: rerender }) }, icon('cash'), 'Record payment'),
      h('button', { onclick: () => newMaintenanceModal({ onSaved: rerender }) }, icon('wrench'), 'Maintenance')));

  const rentRows = d.rent_this_month.map((c) => h('li', null, h('a', { class: 'row', href: `#/tenants/${c.tenant_id}` },
    h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, c.tenant_name), h('span', { class: 'row__sub' }, `${c.property_name} · ${unitLabel(c.unit_name)} · due ${fmtDate(c.due_date)}`)),
    h('div', { class: 'row__end' }, h('span', { class: 'amount' }, peso(c.amount_due)), badge(c.status)))));
  const rentCard = h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, `Rent for ${fmtMonth(d.month_start)}`), h('a', { href: '#/rent' }, 'View all')),
    rentRows.length ? h('ul', { class: 'list' }, rentRows)
      : emptyState({ title: d.has_tenants ? 'No rent due this month' : 'No tenants yet', text: d.has_tenants ? 'Rent appears here once a lease is active this month.' : 'Add a tenant and assign them to a unit to start tracking rent.', action: canManage && !d.has_tenants && h('button', { class: 'btn btn--primary', onclick: () => newTenantModal() }, 'Add tenant') }));

  const recent = h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Recent payments'), h('a', { href: '#/rent?tab=payments' }, 'View all')),
    d.recent_payments.length ? h('ul', { class: 'list' }, d.recent_payments.map((pm) => h('li', null, h('a', { class: 'row', href: `#/payments/${pm.payment_id}` },
      h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, pm.tenant_name), h('span', { class: 'row__sub' }, `${unitLabel(pm.unit_name)} · ${fmtDate(pm.payment_date)} · ${label(pm.payment_method)}`)),
      h('div', { class: 'row__end' }, h('span', { class: 'amount' }, peso(pm.amount_paid)))))))
      : emptyState({ title: 'No payments recorded yet', text: 'When you record a rent payment it will show here.' }));

  const tasks = [];
  for (const t of d.overdue_tenants) {
    tasks.push(h('li', null, h('a', { class: 'row', href: `#/tenants/${t.tenant_id}` },
      h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, `Follow up: ${t.tenant_name}${t.tenant_status === 'archived' ? ' (archived)' : ''}`), h('span', { class: 'row__sub' }, `${t.property_name} · ${unitLabel(t.unit_name)} · overdue since ${fmtDate(t.oldest_overdue)}`)),
      h('div', { class: 'row__end' }, h('span', { class: 'amount amount--neg' }, peso(t.overdue)), badge('overdue')))));
  }
  for (const l of d.expiring_leases) {
    tasks.push(h('li', null, h('a', { class: 'row', href: `#/tenants/${l.tenant_id}` },
      h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, `Lease ending: ${l.tenant_name}`), h('span', { class: 'row__sub' }, `${l.property_name} · ${unitLabel(l.unit_name)}`)),
      h('div', { class: 'row__end' }, h('span', { class: 'small' }, fmtDate(l.end_date)), badge('expiring', 'Renewal')))));
  }
  for (const m of d.open_maintenance) {
    tasks.push(h('li', null, h('a', { class: 'row', href: `#/maintenance/${m.request_id}` },
      h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, m.title), h('span', { class: 'row__sub' }, `${m.property_name}${m.unit_name ? ` · ${unitLabel(m.unit_name)}` : ''} · ${label(m.status)}`)),
      h('div', { class: 'row__end' }, badge(m.priority)))));
  }
  const tasksCard = h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Needs attention'),
      d.overdue_tenant_count > 5 && h('a', { href: '#/rent?status=overdue' }, `${d.overdue_tenant_count} overdue`)),
    tasks.length ? h('ul', { class: 'list' }, tasks) : emptyState({ title: "You're all caught up", text: 'No overdue rent, upcoming lease endings or open repairs.' }));

  const occ = h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'This month at a glance')),
    h('dl', { class: 'dl' },
      h('dt', null, 'Occupancy'), h('dd', null, `${occupancyPct}%`),
      h('dt', null, 'Rent collected'), h('dd', null, peso(d.collected_this_month)),
      h('dt', null, 'Expenses'), h('dd', null, peso(d.expenses_this_month)),
      h('dt', null, 'Net (collected − expenses)'), h('dd', null, peso(Number(d.collected_this_month) - Number(d.expenses_this_month))),
      h('dt', null, 'Open repairs'), h('dd', null, h('a', { href: '#/maintenance' }, String(d.open_maintenance_count)))),
    h('div', { class: 'bar', role: 'img', 'aria-label': `${occupancyPct}% occupied` }, h('span', { style: { width: `${occupancyPct}%` } })),
    h('hr', { class: 'divider' }),
    h('a', { class: 'btn btn--secondary btn--block', href: '#/reports' }, icon('chart'), 'Open reports'));

  el.replaceChildren(head, stats, quick, h('div', { class: 'grid grid--2', style: { marginTop: '16px' } },
    h('div', { class: 'stack' }, tasksCard, rentCard),
    h('div', { class: 'stack' }, recent, occ)));
}
