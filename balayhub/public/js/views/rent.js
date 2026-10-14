// Screen 6 — Rent & Expenses.

import { get, post, patch, qs, uploadFile, ApiError } from '../api.js';
import {
  h, icon, peso, fmtDate, fmtDateTime, fmtMonth, badge, label, options, field, formModal, confirmDialog, emptyState,
  pageHead, toast, todayManila, filesList, openModal, unitLabel } from '../ui.js';
import { state, navigate } from '../app.js';
import { initFilters, filterBar, rememberFilters, changed } from '../filters.js';

const METHODS = ['cash', 'bank_transfer', 'gcash', 'maya', 'check', 'other'];
// A tenant who is archived reads "(archived)"; one who has moved out reads "(former)".
const tenantTag = (x) => (x.tenant_status === 'archived' ? ' (archived)' : x.lease_status !== 'active' ? ' (former)' : '');
const CATEGORIES =['repairs', 'utilities', 'taxes', 'insurance', 'association_dues', 'supplies', 'salaries', 'cleaning', 'other'];

function receiptField() {
  return h('div', { class: 'field' },
    h('label', { for: 'receipt-input' }, 'Receipt or proof of payment (optional)'),
    h('input', { id: 'receipt-input', type: 'file', class: 'input', name: '__receipt', accept: 'application/pdf,image/jpeg,image/png,image/webp' }),
    h('div', { class: 'hint' }, 'Photo or PDF, up to 10 MB.'));
}

async function attachReceipt(form, type, id) {
  const file = form.querySelector('input[name="__receipt"]')?.files[0];
  if (!file) return;
  try { await uploadFile(type, id, file); } catch (err) { toast(`Saved, but the receipt didn't upload: ${err.message}`, 'error'); }
}

// ---------------------------------------------------------------- record payment
export async function recordPaymentModal({ leaseId, onSaved } = {}) {
  let leases;
  try { ({ leases } = await get('/rent/leases')); } catch (err) { toast(err.message, 'error'); return; }
  if (!leases.length) {
    openModal({ title: 'No active leases', body: h('div', { class: 'form' }, h('p', null, 'Payments are recorded against a tenant’s lease. Assign a tenant to a unit first.'), h('a', { class: 'btn btn--primary', href: '#/tenants' }, 'Go to Tenants')) });
    return;
  }
  const balanceInfo = h('div');
  const showBalance = (id) => {
    const l = leases.find((x) => x.lease_id === id);
    balanceInfo.replaceChildren(l ? h('div', { class: `alert ${Number(l.overdue) > 0 ? 'alert--warn' : 'alert--info'}` },
      `Current balance: ${peso(l.outstanding)}`, Number(l.overdue) > 0 ? ` · ${peso(l.overdue)} overdue` : '', Number(l.credit) > 0 ? ` · ${peso(l.credit)} advance credit` : '',
      ` · Monthly rent ${peso(l.monthly_rent)}`) : '');
  };
  const leaseField = field({
    name: 'lease_id', label: 'Tenant', type: 'select', required: true, value: leaseId,
    options: leases.map((l) => [l.lease_id, `${l.tenant_name} — ${l.property_name}, ${unitLabel(l.unit_name)}${tenantTag(l)}`]),
  });
  const amountField = field({ name: 'amount_paid', label: 'Amount paid', type: 'money', required: true, hint: 'Partial payments are fine — the remaining balance is kept.' });
  leaseField.querySelector('select').addEventListener('change', (e) => {
    showBalance(e.target.value);
    const l = leases.find((x) => x.lease_id === e.target.value);
    const amt = amountField.querySelector('input');
    if (l && !amt.value && Number(l.outstanding) > 0) amt.value = l.outstanding;
  });
  if (leaseId) {
    showBalance(leaseId);
    const l = leases.find((x) => x.lease_id === leaseId);
    if (l && Number(l.outstanding) > 0) amountField.querySelector('input').value = l.outstanding;
  }

  formModal({
    title: 'Record payment',
    submitText: 'Save payment',
    idempotent: true,
    draftKey: leaseId ? null : 'payment-new',
    fields: [
      leaseField, balanceInfo, amountField,
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'payment_date', label: 'Date received', type: 'date', required: true, value: todayManila(), max: todayManila() }),
        field({ name: 'payment_method', label: 'Method', type: 'select', required: true, value: 'cash', placeholderOption: false, options: options(METHODS) })),
      field({ name: 'reference_number', label: 'Reference no. (GCash, Maya, bank)', maxlength: 100 }),
      field({ name: 'notes', label: 'Notes', type: 'textarea', maxlength: 500 }),
      receiptField(),
      h('p', { class: 'hint muted small' }, 'Recording a payment does not verify it with the bank or e-wallet. Check the transfer before saving.'),
    ],
    onSubmit: async (data, { idempotencyKey, form }) => {
      delete data.__receipt;
      let res;
      try { res = await post('/payments', data, { idempotencyKey }); } catch (err) {
        if (err.code !== 'PAYMENT_OVER_BALANCE') throw err;
        // More than is owed becomes advance credit, but only if the host confirms it.
        if (!await confirmDialog({ title: 'Record more than is owed?', text: `Record ${peso(data.amount_paid)}? ${peso(err.data.credit_after)} becomes advance credit.`, confirmText: 'Record anyway' })) throw new ApiError('Payment not saved.', { status: 400 });
        res = await post('/payments', { ...data, confirm_over: true }, { idempotencyKey });
      }
      await attachReceipt(form, 'payment', res.payment.payment_id);
      toast(res.duplicate ? 'This payment was already saved.' : `Payment saved. New balance: ${peso(res.balance?.outstanding ?? 0)}`);
      if (onSaved) onSaved(res.payment); else navigate(`#/payments/${res.payment.payment_id}`);
    },
  });
}

// ---------------------------------------------------------------- add expense
export async function addExpenseModal({ onSaved, expense } = {}) {
  let properties; let units;
  try {
    [{ properties }, { units }] = await Promise.all([get('/properties'), get('/units')]);
  } catch (err) { toast(err.message, 'error'); return; }
  if (!properties.length) {
    openModal({ title: 'No properties', body: h('div', { class: 'form' }, h('p', null, 'Expenses are recorded against a property. Add a property first.'), h('a', { class: 'btn btn--primary', href: '#/properties' }, 'Go to Properties')) });
    return;
  }
  const e = expense || {};
  const unitField = field({ name: 'unit_id', label: 'Unit (optional)', type: 'select', value: e.unit_id, placeholderOption: 'Whole property', options: [] });
  const fillUnits = (pid) => {
    const sel = unitField.querySelector('select');
    const current = sel.value || e.unit_id || '';
    sel.replaceChildren(h('option', { value: '' }, 'Whole property'),
      units.filter((u) => u.property_id === pid).map((u) => h('option', { value: u.unit_id, selected: u.unit_id === current }, unitLabel(u.unit_name))));
  };
  const propField = field({ name: 'property_id', label: 'Property', type: 'select', required: true, value: e.property_id || (properties.length === 1 ? properties[0].property_id : ''), options: properties.map((p) => [p.property_id, p.property_name]) });
  propField.querySelector('select').addEventListener('change', (ev) => fillUnits(ev.target.value));
  fillUnits(propField.querySelector('select').value);

  formModal({
    title: expense ? 'Correct expense' : 'Add expense',
    submitText: expense ? 'Save correction' : 'Save expense',
    idempotent: !expense,
    draftKey: expense ? null : 'expense-new',
    fields: [
      propField, unitField,
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'category', label: 'Category', type: 'select', required: true, value: e.category, options: options(CATEGORIES) }),
        field({ name: 'amount', label: 'Amount', type: 'money', required: true, value: e.amount })),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'expense_date', label: 'Date', type: 'date', required: true, value: e.expense_date || todayManila(), max: todayManila() }),
        field({ name: 'vendor_name', label: 'Paid to (vendor)', value: e.vendor_name, maxlength: 120 })),
      field({ name: 'description', label: 'Description', value: e.description, maxlength: 300, placeholder: 'e.g. Meralco bill for common areas' }),
      !expense && receiptField(),
      expense && h('p', { class: 'hint muted small' }, 'Corrections are saved in the audit log with the previous values.'),
    ],
    onSubmit: async (data, { idempotencyKey, form }) => {
      delete data.__receipt;
      if (expense) {
        await patch(`/expenses/${expense.expense_id}`, data);
        toast('Expense corrected.');
        onSaved?.();
        return;
      }
      const res = await post('/expenses', data, { idempotencyKey });
      await attachReceipt(form, 'expense', res.expense.expense_id);
      toast(res.duplicate ? 'This expense was already saved.' : 'Expense saved.');
      onSaved?.(res.expense);
    },
  });
}

// ---------------------------------------------------------------- Screen 6
// Each tab (rent due, payments, expenses) has its own filters, remembered separately.
const TABS = {
  rent: { key: 'rent-roll', defaults: { status: 'outstanding', q: '', property_id: '', unit_id: '', month: '', lease: '', late: '', min_amount: '', sort: '' } },
  payments: { key: 'rent-payments', defaults: { q: '', from: '', to: '', method: '', property_id: '', unit_id: '', tenant_id: '', min_amount: '', max_amount: '', include_voided: '', receipt: '', sort: '' } },
  expenses: { key: 'rent-expenses', defaults: { q: '', category: '', property_id: '', unit_id: '', from: '', to: '', vendor: '', min_amount: '', max_amount: '', source: '', include_voided: '', receipt: '', sort: '' } },
};
// Filters that don't narrow the list (so an empty list isn't "no results").
const NOT_NARROWING = ['status', 'sort'];

// The last 24 months, newest first, for the rent roll's month filter.
function recentMonths(today) {
  const [y, m] = today.split('-').map(Number);
  return Array.from({ length: 24 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7);
    return [d, fmtMonth(`${d}-01`)];
  });
}

export async function rentView(el, { query }) {
  const stayOnly = state.user.business_type === 'short_term';
  const firstTab = stayOnly ? 'expenses' : (['payments', 'expenses'].includes(query.tab) ? query.tab : 'rent');
  let tab = firstTab;
  const [{ properties }, { units }] = await Promise.all([get('/properties'), get('/units')]);
  let tenants = null; // loaded the first time the payments filters are shown
  const values = {};
  // Only the tab named in the link reads filters from it; other tabs use what was remembered.
  const valuesFor = (t) => {
    if (!values[t]) {
      values[t] = initFilters(TABS[t].key, t === firstTab ? query : {}, TABS[t].defaults);
      if (t === 'rent' && !['outstanding', 'overdue', 'partial', 'unpaid', 'paid', 'all'].includes(values[t].status)) values[t].status = 'outstanding';
    }
    return values[t];
  };
  const body = h('div');
  const summary = h('div');
  const barBox = h('div');
  const statusTabs = h('div', { class: 'tabs', role: 'tablist' });
  const reload = () => load();

  const isFiltered = () => Object.keys(changed(valuesFor(tab), TABS[tab].defaults)).some((k) => !NOT_NARROWING.includes(k));
  const clearFilters = () => {
    const f = valuesFor(tab);
    Object.assign(f, TABS[tab].defaults, tab === 'rent' ? { status: f.status } : {});
    rememberFilters(TABS[tab].key, f);
    renderBar();
    load();
  };
  const noResults = () => emptyState({ title: 'No results found', text: 'Nothing matches these filters. Try removing a filter.', action: h('button', { class: 'btn btn--secondary', onclick: clearFilters }, 'Clear filters') });
  const apiQuery = () => qs(changed(valuesFor(tab), TABS[tab].defaults));

  async function load() {
    const f = valuesFor(tab);
    history.replaceState(null, '', `#/rent${qs({ tab: tab === 'rent' ? '' : tab, ...changed(f, TABS[tab].defaults) })}`);
    try {
      if (tab === 'rent') await loadRent(); else if (tab === 'payments') await loadPayments(); else await loadExpenses();
    } catch (err) { body.replaceChildren(h('div', { class: 'alert alert--error' }, err.message)); }
  }

  async function loadRent() {
    const f = valuesFor('rent');
    statusTabs.hidden = false;
    statusTabs.replaceChildren(...[['outstanding', 'All unpaid'], ['overdue', 'Overdue'], ['partial', 'Partial'], ['unpaid', 'Due'], ['paid', 'Paid'], ['all', 'All']].map(([s, t]) =>
      h('button', { role: 'tab', 'aria-selected': String(f.status === s), onclick: () => { f.status = s; rememberFilters(TABS.rent.key, f); load(); } }, t)));
    // "all" isn't a status the server knows, so it lists every charge.
    const { charges, totals } = await get(`/rent${apiQuery()}`);
    const filtered = isFiltered();
    summary.replaceChildren(h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Outstanding'), h('div', { class: 'stat__value' }, peso(totals.outstanding))),
      h('div', { class: `stat${Number(totals.overdue) > 0 ? ' stat--alert' : ''}` }, h('div', { class: 'stat__label' }, 'Overdue'), h('div', { class: 'stat__value' }, peso(totals.overdue)), h('div', { class: 'stat__sub' }, `${totals.overdue_count} month${totals.overdue_count === 1 ? '' : 's'}`)),
      h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Partially paid'), h('div', { class: 'stat__value' }, totals.partial_count)),
      h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Due, not yet paid'), h('div', { class: 'stat__value' }, totals.unpaid_count))));
    const due = charges.reduce((sum, c) => sum + Number(c.balance), 0);
    body.replaceChildren(h('div', { class: 'card' }, charges.length
      ? [filtered && h('p', { class: 'muted small' }, `Showing ${charges.length} charge${charges.length === 1 ? '' : 's'} · ${peso(due)} still to collect`),
        h('ul', { class: 'list' }, charges.map((c) => h('li', null, h('div', { class: 'row' },
          h('a', { class: 'row__main', href: `#/tenants/${c.tenant_id}`, style: { color: 'inherit', textDecoration: 'none' } },
            h('span', { class: 'row__title' }, c.tenant_name, tenantTag(c) && h('span', { class: 'muted small' }, tenantTag(c))),
            h('span', { class: 'row__sub' }, `${c.property_name} · ${unitLabel(c.unit_name)} · ${fmtMonth(c.period)} · due ${fmtDate(c.due_date)}`),
            Number(c.amount_applied) > 0 && c.status !== 'paid' && h('span', { class: 'row__sub' }, `Paid ${peso(c.amount_applied)} of ${peso(c.amount_due)}`)),
          h('div', { class: 'row__end' },
            h('span', { class: `amount${c.status === 'overdue' ? ' amount--neg' : ''}` }, peso(c.status === 'paid' ? c.amount_due : c.balance)),
            h('div', { class: 'chips' }, badge(c.status),
              c.status !== 'paid' && h('button', { class: 'btn btn--secondary btn--sm', onclick: () => recordPaymentModal({ leaseId: c.lease_id, onSaved: reload }) }, 'Record')))))))]
      : (filtered ? noResults() : emptyState({
        title: f.status === 'outstanding' || f.status === 'overdue' ? 'No unpaid rent' : 'No rent charges',
        text: 'Rent charges are created monthly from active leases. Assign tenants to units to start tracking.',
      }))));
  }

  async function loadPayments() {
    statusTabs.hidden = true;
    const { payments } = await get(`/payments${apiQuery()}`);
    const kept = payments.filter((p) => !p.voided_at);
    const total = kept.reduce((s, p) => s + Number(p.amount_paid), 0);
    summary.replaceChildren();
    body.replaceChildren(h('div', { class: 'card' }, payments.length
      ? [h('p', { class: 'muted small' }, `${kept.length} payment${kept.length === 1 ? '' : 's'} · ${peso(total)}${payments.length >= 500 ? ' (latest 500)' : ''}`),
        h('ul', { class: 'list' }, payments.map((p) => h('li', null, h('a', { class: 'row', href: `#/payments/${p.payment_id}` },
          h('div', { class: 'row__main' }, h('span', { class: `row__title${p.voided_at ? ' strike' : ''}` }, p.tenant_name), h('span', { class: 'row__sub' }, `${fmtDate(p.payment_date)} · ${label(p.payment_method)} · ${p.property_name}, ${unitLabel(p.unit_name)}${p.reference_number ? ` · Ref ${p.reference_number}` : ''}`)),
          h('div', { class: 'row__end' }, h('span', { class: `amount${p.voided_at ? ' strike muted' : ''}` }, peso(p.amount_paid)), p.voided_at && badge('voided', 'Voided'))))))]
      : (isFiltered() ? noResults() : emptyState({ title: 'No payments recorded yet', text: 'Record the first rent payment to see it here.', action: h('button', { class: 'btn btn--primary', onclick: () => recordPaymentModal({ onSaved: reload }) }, 'Record payment') }))));
  }

  async function loadExpenses() {
    statusTabs.hidden = true;
    const { expenses } = await get(`/expenses${apiQuery()}`);
    const kept = expenses.filter((x) => !x.voided_at);
    const total = kept.reduce((s, x) => s + Number(x.amount), 0);
    summary.replaceChildren();
    body.replaceChildren(h('div', { class: 'card' }, expenses.length
      ? [h('p', { class: 'muted small' }, `${kept.length} expense${kept.length === 1 ? '' : 's'} · ${peso(total)}${expenses.length >= 500 ? ' (latest 500)' : ''}`),
        h('ul', { class: 'list' }, expenses.map((x) => h('li', null, h('a', { class: 'row', href: `#/expenses/${x.expense_id}` },
          h('div', { class: 'row__main' }, h('span', { class: `row__title${x.voided_at ? ' strike' : ''}` }, x.description || label(x.category)), h('span', { class: 'row__sub' }, `${fmtDate(x.expense_date)} · ${label(x.category)} · ${x.property_name}${x.unit_name ? `, ${unitLabel(x.unit_name)}` : ''}${x.vendor_name ? ` · ${x.vendor_name}` : ''}`)),
          h('div', { class: 'row__end' }, h('span', { class: `amount${x.voided_at ? ' strike muted' : ''}` }, peso(x.amount)), x.voided_at && badge('voided', 'Voided'))))))]
      : (isFiltered() ? noResults() : emptyState({ title: 'No expenses recorded yet', text: 'Track repairs, utilities, dues and other operating costs per property.', action: h('button', { class: 'btn btn--primary', onclick: () => addExpenseModal({ onSaved: reload }) }, 'Add expense') }))));
  }

  // ---- filter bars
  const propertyField = () => properties.length > 1 && { name: 'property_id', label: 'Property', all: 'All properties', options: properties.map((p) => [p.property_id, p.property_name]) };
  const unitField = (f, extra = []) => ({
    name: 'unit_id', label: 'Unit', all: 'All units',
    options: [...extra, ...units.filter((u) => !f.property_id || u.property_id === f.property_id)
      .map((u) => [u.unit_id, `${unitLabel(u.unit_name)}${properties.length > 1 && !f.property_id ? ` · ${u.property_name}` : ''}`])],
  });
  const amountFields = [
    { name: 'min_amount', label: 'Amount from (₱)', type: 'number', min: 0, step: '0.01' },
    { name: 'max_amount', label: 'Amount up to (₱)', type: 'number', min: 0, step: '0.01' },
  ];
  const voidedField = { name: 'include_voided', label: 'Voided entries', all: 'Hide voided', options: [['1', 'Include voided'], ['only', 'Voided only']] };
  const receiptField = { name: 'receipt', label: 'Receipt / proof', all: 'Any', options: [['yes', 'Attached'], ['no', 'Not attached']] };

  function barConfig(f) {
    if (tab === 'rent') {
      return {
        search: { placeholder: 'Search tenant, unit or property' },
        quick: [
          { name: 'month', label: 'Month', all: 'All months', options: recentMonths(todayManila()) },
          propertyField(),
        ].filter(Boolean),
        more: [
          unitField(f),
          { name: 'late', label: 'Days late', all: 'Any', options: [['7', 'More than 7 days late'], ['30', 'More than 30 days late'], ['60', 'More than 60 days late'], ['90', 'More than 90 days late']] },
          { name: 'lease', label: 'Tenant', all: 'Current and former', options: [['current', 'Current tenants'], ['former', 'Moved out (still owing)']] },
          { name: 'min_amount', label: 'Amount due at least (₱)', type: 'number', min: 0, step: '0.01' },
          { name: 'sort', label: 'Sort by', all: 'Overdue first, newest due', options: [['due_asc', 'Oldest due date first'], ['amount', 'Biggest amount due'], ['rent', 'Highest monthly rent'], ['tenant', 'Tenant name'], ['unit', 'Property and unit']] },
        ],
      };
    }
    if (tab === 'payments') {
      return {
        search: { placeholder: 'Search tenant, unit, reference or notes' },
        quick: [
          { name: 'method', label: 'Method', all: 'All methods', options: METHODS.map((m) => [m, label(m)]) },
          propertyField(),
        ].filter(Boolean),
        more: [
          { name: 'from', label: 'Date received', type: 'daterange', keys: ['from', 'to'] },
          unitField(f),
          { name: 'tenant_id', label: 'Tenant', all: 'All tenants', options: (tenants || []).map((t) => [t.tenant_id, t.full_name]) },
          ...amountFields, voidedField, receiptField,
          { name: 'sort', label: 'Sort by', all: 'Newest first', options: [['date_asc', 'Oldest first'], ['amount', 'Biggest amount'], ['amount_asc', 'Smallest amount'], ['tenant', 'Tenant name']] },
        ],
      };
    }
    return {
      search: { placeholder: 'Search description, vendor or property' },
      quick: [
        { name: 'category', label: 'Category', all: 'All categories', options: CATEGORIES.map((c) => [c, label(c)]) },
        propertyField(),
      ].filter(Boolean),
      more: [
        { name: 'from', label: 'Expense date', type: 'daterange', keys: ['from', 'to'] },
        unitField(f, [['none', 'Whole property / common area']]),
        { name: 'vendor', label: 'Vendor', all: 'Any vendor', options: vendors.map((v) => [v, v]) },
        ...amountFields,
        { name: 'source', label: 'Recorded from', all: 'Anywhere', options: [['maintenance', 'Maintenance repairs'], ['direct', 'Added here']] },
        voidedField, receiptField,
        { name: 'sort', label: 'Sort by', all: 'Newest first', options: [['date_asc', 'Oldest first'], ['amount', 'Biggest amount'], ['amount_asc', 'Smallest amount'], ['category', 'Category']] },
      ],
    };
  }

  // Vendor names already used, for the expenses vendor filter.
  let vendors = [];
  async function renderBar() {
    const f = valuesFor(tab);
    if (tab === 'payments' && !tenants) tenants = (await get('/tenants').catch(() => ({ tenants: [] }))).tenants;
    if (tab === 'expenses' && !vendors.length) {
      const { expenses } = await get('/expenses?include_voided=1').catch(() => ({ expenses: [] }));
      vendors = [...new Map(expenses.filter((x) => x.vendor_name?.trim()).map((x) => [x.vendor_name.trim().toLowerCase(), x.vendor_name.trim()])).values()].sort((a, b) => a.localeCompare(b));
    }
    let lastProperty = f.property_id;
    barBox.replaceChildren(filterBar({
      key: TABS[tab].key, values: f, defaults: TABS[tab].defaults,
      ...barConfig(f),
      onChange: () => {
        // A new property changes the unit choices; drop a unit from another property.
        if (f.property_id !== lastProperty) {
          if (f.unit_id && f.unit_id !== 'none' && !units.some((u) => u.unit_id === f.unit_id && (!f.property_id || u.property_id === f.property_id))) f.unit_id = '';
          rememberFilters(TABS[tab].key, f);
          renderBar();
        }
        load();
      },
    }));
  }

  const mainTabs = h('div', { class: 'tabs', role: 'tablist' }, [['rent', 'Rent due'], ['payments', 'Payments'], ['expenses', 'Expenses']].map(([t, txt]) =>
    h('button', {
      role: 'tab', 'aria-selected': String(tab === t),
      onclick: async (e) => {
        tab = t;
        mainTabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b === e.currentTarget)));
        await renderBar();
        load();
      },
    }, txt)));

  await renderBar();
  await load();
  el.replaceChildren(
    pageHead({
      title: stayOnly ? 'Expenses' : 'Rent & Expenses',
      sub: stayOnly ? 'Cleaning, utilities, dues and other costs of running your listings' : 'What’s due, what’s been paid, and what it costs to run your rentals',
      actions: [
        !stayOnly && h('button', { class: 'btn btn--primary', onclick: () => recordPaymentModal({ onSaved: reload }) }, icon('cash'), 'Record payment'),
        h('button', { class: stayOnly ? 'btn btn--primary' : 'btn btn--secondary', onclick: () => addExpenseModal({ onSaved: reload }) }, icon('plus'), 'Add expense')],
    }),
    !stayOnly && mainTabs,
    barBox,
    statusTabs, summary, body);
}

// ---------------------------------------------------------------- details
export async function paymentDetailView(el, { params, rerender }) {
  const { payment: p, files } = await get(`/payments/${params.id}`);
  const canVoid = state.user.role !== 'staff' && !p.voided_at;
  const upload = h('input', { type: 'file', class: 'input', 'aria-label': 'Choose a receipt or proof file', accept: 'application/pdf,image/jpeg,image/png,image/webp' });
  el.replaceChildren(
    pageHead({
      title: `Payment · ${peso(p.amount_paid)}`, sub: `${p.tenant_name} · ${p.property_name}, ${unitLabel(p.unit_name)}`,
      back: { href: '#/rent?tab=payments', label: 'Payments' },
      actions: [
        h('a', { class: 'btn btn--secondary', href: `#/tenants/${p.tenant_id}` }, 'View tenant'),
        h('button', { class: 'btn btn--secondary', onclick: () => window.print() }, 'Print receipt'),
        canVoid && h('button', {
          class: 'btn btn--danger',
          onclick: async () => {
            const reason = await confirmDialog({ title: 'Void this payment?', text: 'Voiding keeps the record but removes it from balances and reports. Use this to correct a mistake, then record the correct payment.', confirmText: 'Void payment', danger: true, reason: true });
            if (!reason) return;
            try { await post(`/payments/${p.payment_id}/void`, { reason }); toast('Payment voided.'); rerender(); } catch (err) { toast(err.message, 'error'); }
          },
        }, 'Void'),
      ],
    }),
    p.voided_at && h('div', { class: 'alert alert--error', style: { marginBottom: '16px' } }, `Voided ${fmtDateTime(p.voided_at)} by ${p.voided_by_name}: ${p.void_reason}`),
    h('div', { class: 'grid grid--2' },
      h('div', { class: 'card' },
        h('h2', { style: { marginBottom: '12px' } }, 'Payment details'),
        h('dl', { class: 'dl' },
          h('dt', null, 'Amount'), h('dd', null, peso(p.amount_paid)),
          h('dt', null, 'Date received'), h('dd', null, fmtDate(p.payment_date)),
          h('dt', null, 'Method'), h('dd', null, label(p.payment_method)),
          h('dt', null, 'Reference no.'), h('dd', null, p.reference_number || '—'),
          h('dt', null, 'Tenant'), h('dd', null, p.tenant_name),
          h('dt', null, 'Unit'), h('dd', null, `${p.property_name}, ${unitLabel(p.unit_name)}`),
          h('dt', null, 'Recorded by'), h('dd', null, `${p.recorded_by_name}, ${fmtDateTime(p.created_at)}`),
          p.notes && [h('dt', null, 'Notes'), h('dd', null, p.notes)])),
      h('div', { class: 'card no-print' },
        h('h2', { style: { marginBottom: '12px' } }, 'Receipt / proof'),
        filesList(files),
        !p.voided_at && h('div', { class: 'form', style: { marginTop: '12px' } }, upload,
          h('button', {
            class: 'btn btn--secondary', onclick: async (e) => {
              if (!upload.files[0]) { toast('Choose a file first.', 'error'); return; }
              e.target.disabled = true;
              try { await uploadFile('payment', p.payment_id, upload.files[0]); toast('Uploaded.'); rerender(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
            },
          }, 'Upload attachment')))));
}

export async function expenseDetailView(el, { params, rerender }) {
  const { expense: x, files } = await get(`/expenses/${params.id}`);
  const canEdit = state.user.role !== 'staff' && !x.voided_at;
  const upload = h('input', { type: 'file', class: 'input', 'aria-label': 'Choose a receipt or proof file', accept: 'application/pdf,image/jpeg,image/png,image/webp' });
  el.replaceChildren(
    pageHead({
      title: `Expense · ${peso(x.amount)}`, sub: `${label(x.category)} · ${x.property_name}${x.unit_name ? `, ${unitLabel(x.unit_name)}` : ''}`,
      back: { href: '#/rent?tab=expenses', label: 'Expenses' },
      actions: canEdit && [
        h('button', { class: 'btn btn--secondary', onclick: () => addExpenseModal({ expense: x, onSaved: rerender }) }, 'Correct'),
        h('button', {
          class: 'btn btn--danger',
          onclick: async () => {
            const reason = await confirmDialog({ title: 'Void this expense?', text: 'The record is kept for your history but removed from totals and reports.', confirmText: 'Void expense', danger: true, reason: true });
            if (!reason) return;
            try { await post(`/expenses/${x.expense_id}/void`, { reason }); toast('Expense voided.'); rerender(); } catch (err) { toast(err.message, 'error'); }
          },
        }, 'Void')],
    }),
    x.voided_at && h('div', { class: 'alert alert--error', style: { marginBottom: '16px' } }, `Voided ${fmtDateTime(x.voided_at)}: ${x.void_reason}`),
    h('div', { class: 'grid grid--2' },
      h('div', { class: 'card' },
        h('dl', { class: 'dl' },
          h('dt', null, 'Amount'), h('dd', null, peso(x.amount)),
          h('dt', null, 'Date'), h('dd', null, fmtDate(x.expense_date)),
          h('dt', null, 'Category'), h('dd', null, label(x.category)),
          h('dt', null, 'Description'), h('dd', null, x.description || '—'),
          h('dt', null, 'Paid to'), h('dd', null, x.vendor_name || '—'),
          x.maintenance_request_id && [h('dt', null, 'Repair request'), h('dd', null, h('a', { href: `#/maintenance/${x.maintenance_request_id}` }, 'View request'))],
          h('dt', null, 'Recorded by'), h('dd', null, `${x.recorded_by_name}, ${fmtDateTime(x.created_at)}`))),
      h('div', { class: 'card' },
        h('h2', { style: { marginBottom: '12px' } }, 'Receipts'),
        filesList(files),
        !x.voided_at && h('div', { class: 'form', style: { marginTop: '12px' } }, upload,
          h('button', {
            class: 'btn btn--secondary', onclick: async (e) => {
              if (!upload.files[0]) { toast('Choose a file first.', 'error'); return; }
              e.target.disabled = true;
              try { await uploadFile('expense', x.expense_id, upload.files[0]); toast('Uploaded.'); rerender(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
            },
          }, 'Upload receipt')))));
}
