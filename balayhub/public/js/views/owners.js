// Unit owners (people whose units you manage) and their monthly statements.

import { get, post, patch, qs } from '../api.js';
import { h, peso, fmtDate, field, formModal, confirmDialog, emptyState, pageHead, toast, todayManila } from '../ui.js';
import { navigate } from '../app.js';
import { CHANNEL_LABEL } from './reservations.js';
import { initFilters, filterBar, changed } from '../filters.js';

const short = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const num = (v) => h('td', { class: 'num' }, v);

const lastMonth = () => {
  const [y, m] = todayManila().split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

function unitChecks(units, owner) {
  return h('fieldset', { class: 'field', dataset: { field: 'unit_ids' }, style: { border: 0, padding: 0, margin: 0 } },
    h('legend', null, 'Their units'),
    units.length ? h('div', { class: 'checks' }, units.map((u) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', name: 'unit_ids', value: u.unit_id, dataset: { multi: '1' }, checked: owner ? u.owner_id === owner.owner_id : false }),
      h('span', null, `${u.unit_name} · ${u.property_name}${u.owner_id && (!owner || u.owner_id !== owner.owner_id) ? ' (has another owner)' : ''}`))))
      : h('p', { class: 'muted small' }, 'Add listings first.'),
    h('div', { class: 'error', role: 'alert' }));
}

function ownerForm(units, o = {}) {
  return [
    field({ name: 'full_name', label: 'Owner name', required: true, value: o.full_name, maxlength: 120 }),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'email', label: 'Email (for sending statements)', type: 'email', value: o.email }),
      field({ name: 'phone', label: 'Mobile number', type: 'tel', value: o.phone })),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'management_fee_pct', label: 'Management fee %', type: 'money', value: o.management_fee_pct ?? '20', hint: 'Of net rental income (after channel and cleaning fees).' }),
      field({ name: 'cleaning_to_manager', label: 'Cleaning fees go to me / the cleaner, not the owner', type: 'checkbox', value: o.cleaning_to_manager ?? true })),
    unitChecks(units, o.owner_id ? o : null),
    field({ name: 'notes', label: 'Notes', type: 'textarea', value: o.notes, maxlength: 1000, placeholder: 'e.g. Payout by BDO transfer on the 5th' }),
  ];
}

export async function ownersView(el, { rerender, query = {} }) {
  const defaults = { q: '', has_units: '', unit_id: '', sort: '' };
  const filters = initFilters('owners', query, defaults);
  let { owners, units, total } = await get(`/unit-owners${qs(changed(filters, defaults))}`);
  const unitName = (id) => units.find((u) => u.unit_id === id)?.unit_name;
  const add = () => formModal({
    title: 'Add a unit owner', submitText: 'Save owner', fields: ownerForm(units),
    onSubmit: async (d) => { await post('/unit-owners', { ...d, unit_ids: d.unit_ids || [] }); toast('Owner saved.'); rerender(); },
  });
  const edit = (o) => formModal({
    title: `Edit ${o.full_name}`, submitText: 'Save', fields: ownerForm(units, o),
    onSubmit: async (d) => { await patch(`/unit-owners/${o.owner_id}`, { ...d, unit_ids: d.unit_ids || [] }); toast('Saved.'); rerender(); },
  });
  const archive = async (o) => {
    if (!await confirmDialog({ title: `Remove ${o.full_name}?`, text: 'Their units will no longer have an owner. Past reservations and expenses are not changed.', confirmText: 'Remove owner' })) return;
    try { await post(`/unit-owners/${o.owner_id}/archive`); toast('Owner removed.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };

  const listBox = h('div');
  function draw() {
    const filtered = Object.keys(changed(filters, defaults)).some((k) => k !== 'sort');
    if (!owners.length) {
      listBox.replaceChildren(h('div', { class: 'card' }, filtered
        ? emptyState({ iconName: 'file', title: 'No results found', text: 'No owner matches these filters. Try removing a filter.' })
        : emptyState({
          iconName: 'file', title: 'No unit owners yet',
          text: 'If you manage units for other owners, add them here and assign their units. BalayHub then prepares a monthly statement: bookings, channel fees, your management fee, expenses and their payout.',
          action: h('button', { class: 'btn btn--primary', type: 'button', onclick: add }, '+ Add owner'),
        })));
      return;
    }
    listBox.replaceChildren(
      filtered ? h('p', { class: 'muted small' }, `Showing ${owners.length} of ${total} owner${total === 1 ? '' : 's'}`) : '',
      h('div', { class: 'grid grid--2' }, owners.map((o) => h('div', { class: 'card' },
        h('div', { class: 'card__head' }, h('h2', null, o.full_name),
          h('div', { class: 'chips' },
            h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => edit(o) }, 'Edit'),
            h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => archive(o) }, 'Remove'))),
        h('dl', { class: 'dl' },
          h('dt', null, 'Units'), h('dd', null, o.unit_ids.map(unitName).filter(Boolean).join(', ') || 'None yet'),
          h('dt', null, 'Management fee'), h('dd', null, `${Number(o.management_fee_pct)}%${o.cleaning_to_manager ? ' · cleaning fees kept for cleaning' : ''}`),
          o.email && [h('dt', null, 'Email'), h('dd', null, o.email)],
          o.phone && [h('dt', null, 'Mobile'), h('dd', null, o.phone)]),
        h('div', { class: 'chips', style: { marginTop: '12px' } },
          h('a', { class: 'btn btn--primary btn--sm', href: `#/owners/${o.owner_id}/statement?month=${lastMonth()}` }, 'Statement for last month'),
          h('a', { class: 'btn btn--secondary btn--sm', href: `#/owners/${o.owner_id}/statement?month=${todayManila().slice(0, 7)}` }, 'This month so far'))))));
  }
  async function load() {
    history.replaceState(null, '', `#/owners${qs(changed(filters, defaults))}`);
    ({ owners, units, total } = await get(`/unit-owners${qs(changed(filters, defaults))}`));
    draw();
  }
  draw();
  // No filter bar for a single owner (unless a filter is still on from before).
  const showBar = total > 1 || Object.keys(changed(filters, defaults)).length > 0;
  const bar = showBar && filterBar({
    key: 'owners', values: filters, defaults, onChange: load,
    search: { placeholder: 'Search name, email or mobile' },
    quick: [{ name: 'has_units', label: 'Units', all: 'Any', options: [['yes', 'Has units'], ['no', 'No units yet']] }],
    more: [
      units.length > 0 && { name: 'unit_id', label: 'Owns listing', all: 'Any listing', options: units.map((u) => [u.unit_id, `${u.unit_name} · ${u.property_name}`]) },
      { name: 'sort', label: 'Sort by', all: 'Name (A–Z)', options: [['units', 'Most units'], ['fee', 'Highest management fee'], ['newest', 'Newest first']] },
    ].filter(Boolean),
  });

  el.replaceChildren(
    pageHead({
      title: 'Unit owners', sub: 'Monthly statements for owners whose units you manage',
      actions: h('button', { class: 'btn btn--primary', type: 'button', onclick: add }, '+ Add owner'),
    }),
    bar || '', listBox);
}

export async function ownerStatementView(el, { params, query = {} }) {
  const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : lastMonth();
  const { statement: s } = await get(`/unit-owners/${params.id}/statement?month=${month}`);
  const t = s.totals;
  const monthInput = h('input', { class: 'input input--sm', type: 'month', value: month, 'aria-label': 'Month',
    onchange: (e) => { if (e.target.value) navigate(`#/owners/${params.id}/statement?month=${e.target.value}`); } });
  const send = async () => {
    if (!await confirmDialog({ title: 'Email this statement?', text: `Send the ${s.month_label} statement to ${s.owner.email}?`, confirmText: 'Send' })) return;
    try { await post(`/unit-owners/${params.id}/statement/send`, { month }); toast(`Statement sent to ${s.owner.email}.`); } catch (err) { toast(err.message, 'error'); }
  };
  const row = (label, value, opts = {}) => [h('dt', null, label), h('dd', { class: opts.cls || null }, opts.strong ? h('strong', null, value) : value)];

  el.replaceChildren(
    h('a', { class: 'back no-print', href: '#/owners' }, '‹ Unit owners'),
    h('div', { class: 'page-head no-print' },
      h('div', { class: 'page-head__title' }, h('h1', null, `Statement · ${s.owner.full_name}`)),
      h('div', { class: 'page-head__actions' },
        monthInput,
        s.owner.email && h('button', { class: 'btn btn--secondary', type: 'button', onclick: send }, 'Email to owner'),
        h('button', { class: 'btn btn--primary', type: 'button', onclick: () => window.print() }, 'Print / save as PDF'))),
    s.missing_amounts > 0 && h('div', { class: 'alert alert--warn no-print' },
      `${s.missing_amounts} stay${s.missing_amounts > 1 ? 's have' : ' has'} no amount yet (usually stays synced from a channel calendar). Open each reservation and enter what the guest paid and the channel fee, so the statement is complete.`),
    h('div', { class: 'card receipt statement' },
      h('div', { class: 'receipt__head' },
        h('div', null, h('h2', null, s.workspace), h('div', { class: 'muted small' }, `Prepared for ${s.owner.full_name}`)),
        h('div', { class: 'receipt__no' }, h('div', { class: 'subhead' }, 'Owner statement'), h('strong', null, s.month_label))),
      h('p', { class: 'muted small' }, `Units: ${s.units.map((u) => u.unit_name).join(', ') || 'none'} · ${t.stays} stay${t.stays === 1 ? '' : 's'}, ${t.nights} night${t.nights === 1 ? '' : 's'} (${t.occupancy_pct}% occupancy) · stays are counted in the month they check out`),
      h('h3', { class: 'subhead' }, 'Stays'),
      s.stays.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact' },
        h('thead', null, h('tr', null, ['Dates', 'Unit', 'Guest', 'Channel', 'Total', 'Channel fee', s.owner.cleaning_to_manager ? 'Cleaning' : null, 'Net'].filter(Boolean).map((x) => h('th', null, x)))),
        h('tbody', null, s.stays.map((x) => h('tr', null,
          h('td', { class: 'num' }, `${short(x.check_in)} – ${short(x.check_out)}`),
          h('td', null, x.unit_name),
          h('td', null, x.guest_first_name),
          h('td', null, CHANNEL_LABEL[x.channel] || x.channel),
          num(x.missing_amount ? h('span', { class: 'amount--neg' }, 'not entered') : peso(x.total_amount)),
          num(Number(x.channel_fee) ? `− ${peso(x.channel_fee)}` : '—'),
          s.owner.cleaning_to_manager && num(Number(x.cleaning_fee) ? `− ${peso(x.cleaning_fee)}` : '—'),
          num(peso(x.net)))))))
        : h('p', { class: 'muted' }, 'No stays have checked out this month yet.'),
      s.expenses.length > 0 && [
        h('h3', { class: 'subhead', style: { marginTop: '16px' } }, 'Expenses'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact' },
          h('thead', null, h('tr', null, ['Date', 'Unit', 'For', 'Amount'].map((x) => h('th', null, x)))),
          h('tbody', null, s.expenses.map((e) => h('tr', null,
            h('td', { class: 'num' }, short(e.expense_date)), h('td', null, e.unit_name),
            h('td', null, [e.description || e.category.replace('_', ' '), e.vendor_name].filter(Boolean).join(' · ')),
            num(peso(e.amount)))))))],
      h('h3', { class: 'subhead', style: { marginTop: '16px' } }, 'Summary'),
      h('dl', { class: 'dl statement__sum' },
        row('Gross bookings', peso(t.gross)),
        row('Less channel fees', `− ${peso(t.channel_fees)}`),
        s.owner.cleaning_to_manager && row('Less cleaning fees', `− ${peso(t.cleaning_fees)}`),
        row('Net rental income', peso(t.net_rental), { strong: true }),
        row(`Management fee (${Number(s.owner.management_fee_pct)}%)`, `− ${peso(t.management_fee)}`),
        row('Expenses', `− ${peso(t.expenses)}`),
        row('Payout to owner', peso(t.payout), { strong: true, cls: Number(t.payout) < 0 ? 'amount--neg' : 'statement__payout' })),
      Number(t.payout) < 0 && h('p', { class: 'muted small' }, 'Expenses were more than this month\'s income, so the owner owes this amount (or it carries over).'),
      h('p', { class: 'muted small', style: { marginTop: '18px' } }, `Generated by BalayHub on ${fmtDate(todayManila())}.`)));
}
