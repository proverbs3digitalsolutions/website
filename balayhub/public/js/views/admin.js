// Platform admin: every workspace, its plan and trial; activate a plan after payment.

import { get, patch, qs } from '../api.js';
import { h, fmtDate, fmtDateTime, badge, field, formModal, emptyState, toast } from '../ui.js';
import { state } from '../app.js';
import { initFilters, filterBar, changed } from '../filters.js';

const BUSINESS = { short_term: 'Short-term stays', long_term: 'Monthly rentals', both: 'Both' };

function statusBadge(w) {
  const s = w.status;
  if (w.is_demo) return badge('archived', 'Demo');
  if (s.read_only) return badge('overdue', s.reason === 'trial_ended' ? 'Trial ended' : s.reason === 'deleting' ? 'Deleting' : 'Payment due');
  if (s.plan === 'trial') return badge('unpaid', `Trial · ${s.trial_days_left}d left`);
  if (s.reason === 'grace') return badge('partial', 'Grace period');
  return badge('paid', s.name);
}

export async function adminView(el, { rerender, query = {} }) {
  if (!state.user.is_platform_admin) {
    el.replaceChildren(h('div', { class: 'card' }, emptyState({ title: 'Not found', text: "This page doesn't exist." })));
    return;
  }
  const defaults = { q: '', status: '', plan: '', business_type: '', created_from: '', created_to: '', sort: '' };
  const filters = initFilters('admin-workspaces', query, defaults);
  const first = await get(`/admin/workspaces${qs(changed(filters, defaults))}`);
  // The stats always count every workspace, whatever the filters.
  const { plans, summary, mrr } = first;
  const counts = {
    trial: summary.trial,
    paying: summary.paying + summary.grace,
    lapsed: summary.trial_ended + summary.overdue + summary.deleting,
  };

  const edit = (w) => formModal({
    title: `${w.name}`,
    submitText: 'Save',
    fields: [
      h('p', { class: 'muted small' }, `${w.owner_name || '—'} · ${w.owner_email || '—'} · ${w.unit_count} units · ${w.member_count} members`),
      field({ name: 'plan', label: 'Plan', type: 'select', required: true, value: w.plan, placeholderOption: false,
        options: plans.map((p) => [p.key, `${p.name}${p.price ? ` — ₱${p.price}/mo` : ''} (${p.listings >= 1000 ? 'unlimited' : `${p.listings} listings`})`]) }),
      field({ name: 'paid_until', label: 'Paid until (paid plans)', type: 'date', value: w.paid_until ? String(w.paid_until).slice(0, 10) : '',
        hint: 'Last day covered by the payment. The workspace becomes view-only 7 days after this date.' }),
      field({ name: 'trial_ends_at', label: 'Trial ends (trial plan)', type: 'date', value: w.trial_ends_at ? new Date(w.trial_ends_at).toISOString().slice(0, 10) : '' }),
      field({ name: 'plan_note', label: 'Note', type: 'textarea', value: w.plan_note, maxlength: 1000, placeholder: 'e.g. GCash ref 1234567, paid Oct–Dec' }),
    ],
    onSubmit: async (d) => {
      await patch(`/admin/workspaces/${w.organization_id}`, {
        plan: d.plan, paid_until: d.paid_until || null, plan_note: d.plan_note || null, ...(d.trial_ends_at ? { trial_ends_at: d.trial_ends_at } : {}),
      });
      toast('Workspace updated.');
      rerender();
    },
  });

  const tbody = h('tbody');
  const count = h('p', { class: 'muted small' });
  const draw = ({ workspaces, total }) => {
    const filtered = Object.keys(changed(filters, defaults)).some((k) => k !== 'sort');
    count.textContent = filtered ? `Showing ${workspaces.length} of ${total} workspaces` : `${total} workspace${total === 1 ? '' : 's'}`;
    if (!workspaces.length) {
      tbody.replaceChildren(h('tr', null, h('td', { colspan: 7 }, emptyState({ title: 'No results found', text: 'No workspace matches these filters. Try removing a filter.' }))));
      return;
    }
    tbody.replaceChildren(...workspaces.map((w) => h('tr', { class: w.is_demo ? '' : 'row-link', tabindex: w.is_demo ? null : 0, onclick: () => { if (!w.is_demo) edit(w); } },
      h('td', null, h('strong', null, w.name), h('div', { class: 'muted small' }, w.owner_email || '—')),
      h('td', null, statusBadge(w), h('div', { class: 'muted small' }, BUSINESS[w.business_type] || '')),
      h('td', null, w.paid_until ? fmtDate(w.paid_until) : '—'),
      h('td', { class: 'num' }, String(w.unit_count)),
      h('td', null, fmtDate(w.created_at)),
      h('td', null, w.last_active_at ? fmtDateTime(w.last_active_at) : '—'),
      h('td', { class: 'small muted' }, w.plan_note || ''))));
  };
  draw(first);
  async function load() {
    history.replaceState(null, '', `#/admin${qs(changed(filters, defaults))}`);
    try { draw(await get(`/admin/workspaces${qs(changed(filters, defaults))}`)); } catch (err) { toast(err.message, 'error'); }
  }
  const bar = filterBar({
    key: 'admin-workspaces', values: filters, defaults, onChange: load,
    search: { placeholder: 'Search workspace, owner name or email' },
    quick: [
      { name: 'status', label: 'Status', all: 'All statuses', options: [['trial', 'On trial'], ['paying', 'Paying'], ['grace', 'Grace period'], ['trial_ended', 'Trial ended'], ['overdue', 'Payment overdue'], ['comped', 'Complimentary'], ['deleting', 'Scheduled for deletion'], ['demo', 'Demo']] },
      { name: 'business_type', label: 'Business type', all: 'All types', options: Object.entries(BUSINESS) },
    ],
    more: [
      { name: 'plan', label: 'Plan', all: 'Any plan', options: plans.map((p) => [p.key, p.name]) },
      { name: 'created', keys: ['created_from', 'created_to'], label: 'Signed up between', type: 'daterange' },
      { name: 'sort', label: 'Sort by', all: 'Newest first', options: [['oldest', 'Oldest first'], ['name', 'Name (A–Z)'], ['active', 'Recently active'], ['units', 'Most units'], ['trial_ends', 'Trial ending soonest'], ['paid_until', 'Paid until (soonest)']] },
    ],
  });

  el.replaceChildren(
    h('div', { class: 'page-head' }, h('div', { class: 'page-head__title' }, h('h1', null, 'Platform admin'),
      h('p', null, 'All BalayHub workspaces. Click one to set its plan after the customer pays.')),
      h('div', { class: 'page-head__actions' }, h('a', { class: 'btn btn--primary', href: '#/admin/support' }, 'Support queue'))),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'On trial'), h('div', { class: 'stat__value' }, String(counts.trial))),
      h('div', { class: 'stat stat--good' }, h('div', { class: 'stat__label' }, 'Paying'), h('div', { class: 'stat__value' }, String(counts.paying))),
      h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Monthly revenue'), h('div', { class: 'stat__value' }, `₱${mrr.toLocaleString('en-PH')}`)),
      h('div', { class: 'stat stat--alert' }, h('div', { class: 'stat__label' }, 'Ended / overdue'), h('div', { class: 'stat__value' }, String(counts.lapsed)))),
    h('div', { style: { marginTop: '16px' } }, bar), count,
    h('div', { class: 'card card--flush' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, ['Workspace', 'Plan', 'Paid until', 'Units', 'Created', 'Last active', 'Note'].map((t, i) => h('th', { class: i === 3 ? 'num' : null }, t)))),
      tbody))));
}
