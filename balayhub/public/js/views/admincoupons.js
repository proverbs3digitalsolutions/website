// Platform admin: "Plan coupons", the coupons BalayHub gives its own customers (docs/contracts/platform-coupons.md).
// Not the hosts' guest discount codes.

import { get, post, patch, qs } from '../api.js';
import { h, fmtDateTime, badge, field, makeForm, openModal, emptyState, toast, parseAmount, confirmDialog } from '../ui.js';
import { state } from '../app.js';
import { initFilters, filterBar, changed, apiFilters } from '../filters.js';

// ---- helpers (pure; test/qa-r15-admincoupons-view.test.js reads this block)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PLAN_NAMES = { starter: 'Starter', growth: 'Growth', pro: 'Pro' };
// 32 characters, so one random byte masked to 5 bits picks one with no bias.
const genCode = (c = crypto) => Array.from(c.getRandomValues(new Uint8Array(8)), (n) => CODE_CHARS[n & 31]).join('');
const discountText = (c) => (c.kind === 'free' ? 'Free' : c.kind === 'fixed' ? `${pesoText(toCentavos(c.amount_off)).replace(/\.00$/, '')} off` : `${c.percent_off}% off`);
const appliesText = (c) => (c.duration === 'once' ? 'First month' : c.duration === 'months' ? `First ${c.duration_months} months` : 'Every month');
const plansText = (plans) => (plans?.length ? plans.map((p) => PLAN_NAMES[p] || p).join(', ') : 'All plans');
const STATE_BADGE = { active: ['paid', 'Active'], scheduled: ['unpaid', 'Scheduled'], ended: ['archived', 'Ended'], off: ['archived', 'Switched off'], full: ['partial', 'Limit reached'] };
const usedText = (c) => (c.max_redemptions ? `${c.used} of ${c.max_redemptions}` : String(c.used));
const REDEMPTION_STATUS = { released: 'Not completed (slot freed)', used_up: 'Used up', active: 'Active', pending: 'Checkout open' };
const monthsText = (r) => (r.months_total == null ? `${r.months_used} · every month` : `${r.months_used} of ${r.months_total}`);
// Money text ("1234.50") to integer centavos without floats.
const toCentavos = (s) => { const [w, f = ''] = String(s || '0').split('.'); return Number(w) * 100 + Number(`${f}00`.slice(0, 2)); };
// Integer centavos to "₱598.90" (integer maths, never floors the centavos).
const pesoText = (c) => `₱${Math.floor(c / 100).toLocaleString('en-PH')}.${String(c % 100).padStart(2, '0')}`;
// The Manila date and time of a stored moment, for the date and time boxes.
function manilaParts(ts) {
  if (!ts) return { date: '', time: '' };
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
// Once a coupon has been used these inputs are disabled. A save still sends them unchanged: the server accepts a same-value edit
// and answers 409 COUPON_LOCKED for a real change, so a slipped change shows the server's message, never a fake "saved".
const LOCKED = ['code', 'kind', 'percent_off', 'amount_off', 'duration', 'duration_months', 'plans', 'starts_on', 'starts_time'];
// A free coupon with no once-per-workspace rule and no total limit can be used again and again: asked about before saving.
const unlimitedFree = (v) => v.kind === 'free' && !v.once_per_workspace && !v.limit_on;
// 3 to 32 characters is allowed, but a short code is easy to guess: a hint, never a block.
const shortCode = (code) => { const n = String(code ?? '').trim().length; return n >= 3 && n <= 7; };
const num = (s) => { const t = String(s ?? '').trim(); if (t === '') return null; const n = Number(t); return Number.isNaN(n) ? t : n; };
function couponBody(v) {
  const body = {
    name: v.name, code: v.code, kind: v.kind,
    percent_off: v.kind === 'percent' ? num(v.percent_off) : null,
    amount_off: v.kind === 'fixed' ? num(v.amount_off) : null,
    duration: v.duration,
    duration_months: v.duration === 'months' ? num(v.duration_months) : null,
    plans: v.plans || [],
    max_redemptions: v.limit_on ? num(v.max_redemptions) : null,
    once_per_workspace: v.once_per_workspace, require_card: v.require_card,
    starts_on: v.starts_on, starts_time: v.starts_time || undefined,
    ends_on: v.ends_on || null, ends_time: v.ends_on ? (v.ends_time || undefined) : null,
    note: v.note,
  };
  if (v.active !== undefined) body.active = v.active;
  return body;
}
// ---- end helpers

const KINDS = [['percent', 'Percentage'], ['fixed', 'Fixed amount'], ['free', 'Free access (100%)']];
const DURATIONS = [['once', 'First month only'], ['months', 'A number of months'], ['forever', 'Every month']];

// A group of radio buttons. readForm() keeps only the last radio of a name, so the form reads the checked one itself.
function radioGroup({ name, label, options, value, disabled, onChange }) {
  const id = `rg-${name}`;
  return h('div', { class: 'field', dataset: { field: name } },
    h('div', { id, class: 'label' }, label),
    h('div', { class: 'stack', role: 'radiogroup', 'aria-labelledby': id },
      options.map(([v, t]) => h('label', { class: 'check' },
        h('input', { type: 'radio', name, value: v, checked: v === value, disabled, onchange: () => onChange?.(v) }), h('span', null, t)))),
    h('div', { class: 'error', role: 'alert' }));
}
const checked = (form, name) => form.querySelector(`input[name="${name}"]:checked`)?.value;

export async function adminCouponsView(el, { query = {} }) {
  if (!state.user.is_platform_admin) {
    el.replaceChildren(h('div', { class: 'card' }, emptyState({ title: 'Not found', text: "This page doesn't exist." })));
    return;
  }
  const defaults = { q: '', state: '', kind: '', plan: '', sort: '' };
  const filters = initFilters('admin-coupons', query, defaults);
  const first = await get(`/admin/coupons${qs(apiFilters(filters))}`);

  const stat = (label, cls) => { const v = h('div', { class: 'stat__value' }); return { v, el: h('div', { class: `stat ${cls}`.trim() }, h('div', { class: 'stat__label' }, label), v) }; };
  const sActive = stat('Active', 'stat--good'); const sScheduled = stat('Scheduled', ''); const sEnded = stat('Ended or off', ''); const sGiven = stat('Total discount given', '');

  const couponForm = (c) => {
    const locked = Boolean(c && c.used > 0);
    const starts = manilaParts(c?.starts_at); const ends = manilaParts(c?.ends_at);
    let kind = c?.kind || 'percent'; let duration = c?.duration || 'once';
    const percentField = field({ name: 'percent_off', label: 'Percent off', type: 'number', min: 1, max: 99, step: 1, value: c?.percent_off ?? '' });
    const amountField = field({ name: 'amount_off', label: 'Amount off each month (₱)', type: 'money', value: c?.amount_off ?? '' });
    const monthsField = field({ name: 'duration_months', label: 'Months', type: 'number', min: 2, max: 36, step: 1, value: c?.duration_months ?? '' });
    const totalField = field({ name: 'max_redemptions', label: 'Total uses', type: 'number', min: 1, step: 1, value: c?.max_redemptions ?? '' });
    const limitBox = field({ name: 'limit_on', label: 'Limit total uses', type: 'checkbox', value: Boolean(c?.max_redemptions) });
    const setReq = (f, on) => {
      f.querySelector('input').required = on;
      const label = f.querySelector('label');
      label.querySelector('.req')?.remove();
      if (on) label.append(h('span', { class: 'req', 'aria-hidden': 'true' }, ' *'));
    };
    const sync = () => {
      percentField.hidden = kind !== 'percent'; amountField.hidden = kind !== 'fixed'; monthsField.hidden = duration !== 'months';
      totalField.hidden = !limitBox.querySelector('input').checked;
      // Only the box that shows is required, so one pass of the form lists it with the others.
      setReq(percentField, kind === 'percent'); setReq(amountField, kind === 'fixed');
    };
    limitBox.querySelector('input').addEventListener('change', sync);
    // Keeps the star but not the generic "Starts is required." sentence: the form's check below words it.
    const starOnly = (f) => { f.querySelector('input').required = false; return f; };
    const codeField = field({ name: 'code', label: 'Coupon code', required: true, value: c?.code ?? '', maxlength: 32, hint: 'Not case-sensitive. Letters, numbers and dashes.' });
    const codeInput = codeField.querySelector('input');
    const nudge = h('div', { class: 'hint', hidden: true }, 'Short codes are easy to guess. Use 8 or more characters, or press Generate.');
    codeField.querySelector('.hint').after(nudge);
    const syncNudge = () => { nudge.hidden = locked || !shortCode(codeInput.value); };
    codeInput.addEventListener('input', syncNudge);
    syncNudge();
    const generate = h('button', { type: 'button', class: 'btn btn--secondary btn--sm', disabled: locked, onclick: () => { codeInput.value = genCode(); codeInput.dispatchEvent(new Event('input', { bubbles: true })); } }, 'Generate');
    codeInput.after(generate);
    const planChecks = h('div', { class: 'field', dataset: { field: 'plans' } },
      h('div', { class: 'label', id: 'cp-plans' }, 'Plans'),
      h('div', { class: 'stack', role: 'group', 'aria-labelledby': 'cp-plans' },
        Object.entries(PLAN_NAMES).map(([k, t]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'plans', value: k, dataset: { multi: '1' }, checked: (c?.plans || []).includes(k), disabled: locked }), h('span', null, t)))),
      h('div', { class: 'hint' }, 'Leave all unticked for every plan.'),
      h('div', { class: 'error', role: 'alert' }));
    const fields = [
      locked && h('p', { class: 'hint' }, 'Locked because this coupon has been used. Make a new coupon to change the discount.'),
      field({ name: 'name', label: 'Coupon name', required: true, value: c?.name ?? '', maxlength: 100 }),
      codeField,
      radioGroup({ name: 'kind', label: 'Coupon type', options: KINDS, value: kind, onChange: (v) => { kind = v; sync(); } }),
      percentField, amountField,
      radioGroup({ name: 'duration', label: 'How long it applies after it is used', options: DURATIONS, value: duration, onChange: (v) => { duration = v; sync(); } }),
      monthsField,
      planChecks,
      h('div', { class: 'form-row form-row--2' },
        starOnly(field({ name: 'starts_on', label: 'Starts', type: 'date', required: true, value: starts.date })),
        field({ name: 'starts_time', label: 'Start time', type: 'time', value: starts.time || '00:00', hint: 'Manila time.' })),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'ends_on', label: 'Ends', type: 'date', value: ends.date }),
        field({ name: 'ends_time', label: 'End time', type: 'time', value: ends.time || '23:59', hint: 'Manila time.' })),
      limitBox, totalField,
      field({ name: 'once_per_workspace', label: 'Once per workspace', type: 'checkbox', value: c ? c.once_per_workspace : true }),
      field({ name: 'require_card', label: 'Require a card payment', type: 'checkbox', value: Boolean(c?.require_card),
        hint: "The workspace must pay by card. A free coupon then charges ₱20 by card once (BalayHub can't keep cards or charge automatically yet)." }),
      field({ name: 'note', label: 'Note', type: 'textarea', value: c?.note ?? '', maxlength: 1000 }),
      c && field({ name: 'active', label: 'Switched on', type: 'checkbox', value: c.active }),
    ];
    if (locked) fields.forEach((f) => f?.querySelectorAll?.('input').forEach((i) => { if (LOCKED.includes(i.name)) i.disabled = true; }));
    sync();
    return { fields, getKind: () => kind, locked };
  };

  const editor = (c) => {
    const { fields } = couponForm(c);
    let modal;
    const form = makeForm({
      submitText: c ? 'Save' : 'Create coupon',
      cancel: () => modal.close(),
      fields,
      check: (d) => (d.starts_on ? null : { starts_on: 'Choose the day the coupon starts.' }),
      onSubmit: async (d, { form: f }) => {
        const body = couponBody({ ...d, kind: checked(f, 'kind'), duration: checked(f, 'duration') });
        // "Change it" keeps the form open with focus on the box the question is about.
        if (unlimitedFree({ ...d, kind: body.kind }) && !await confirmDialog({ title: 'Unlimited free months?', text: 'Once per workspace is off and there is no total limit, so this free coupon could be used again and again. Save anyway?', confirmText: 'Save anyway', cancelText: 'Change it' })) { f.elements.once_per_workspace.focus(); return false; }
        const save = (b) => (c ? patch(`/admin/coupons/${c.coupon_id}`, b) : post('/admin/coupons', b));
        try { await save(body); } catch (err) {
          if (err.code !== 'AMOUNT_ABOVE_PLAN') throw err;
          // The server holds the plan prices; it asks, and a yes resends with the flag (never stored).
          const text = `${pesoText(toCentavos(body.amount_off))} off is more than the highest plan price (${pesoText(toCentavos(err.data?.max_plan_price))}), so the plan would be free. Save anyway?`;
          if (!await confirmDialog({ title: 'Check the amount off', text, confirmText: 'Save anyway', cancelText: 'Change it' })) { f.elements.amount_off.focus(); return false; }
          await save({ ...body, confirm_high_amount: true });
        }
        toast(c ? 'Coupon saved.' : 'Coupon created.');
        modal.close();
        load();
      },
    });
    modal = openModal({ title: c ? `Edit ${c.code}` : 'New coupon', body: form });
  };

  const redemptions = async (c) => {
    let data;
    try { data = await get(`/admin/coupons/${c.coupon_id}/redemptions`); } catch (err) { toast(err.message, 'error'); return; }
    const rows = data.redemptions;
    openModal({
      title: `Redemptions of ${c.code}`, wide: true,
      body: rows.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, ['Workspace', 'Status', 'Months used', 'Discount given', 'Started'].map((t) => h('th', null, t)))),
          h('tbody', null, rows.map((r) => h('tr', null,
            h('td', null, h('strong', null, r.workspace_name), h('div', { class: 'muted small' }, r.owner_email || '—')),
            h('td', null, REDEMPTION_STATUS[r.status] || r.status),
            h('td', null, monthsText(r)),
            h('td', null, `₱${r.discount_total}`),
            h('td', null, fmtDateTime(r.activated_at || r.created_at)))))))
        : h('p', { class: 'muted' }, 'No workspace has used this coupon yet.'),
    });
  };

  const tbody = h('tbody');
  const count = h('p', { class: 'muted small' });
  const draw = ({ coupons, total, summary }) => {
    sActive.v.textContent = String(summary.active); sScheduled.v.textContent = String(summary.scheduled);
    sEnded.v.textContent = String(summary.ended + summary.off); sGiven.v.textContent = pesoText(toCentavos(summary.discount_total));
    const filtered = Object.keys(changed(filters, defaults)).some((k) => k !== 'sort');
    count.textContent = filtered ? `Showing ${coupons.length} of ${total} coupons` : `${total} coupon${total === 1 ? '' : 's'}`;
    if (!coupons.length) {
      tbody.replaceChildren(h('tr', null, h('td', { colspan: 9 }, filtered
        ? emptyState({ title: 'No results found', text: 'No coupon matches these filters. Try removing a filter.' })
        : emptyState({ title: 'No coupons yet', text: 'Make a coupon to give your customers a discount on a BalayHub plan.', action: h('button', { type: 'button', class: 'btn btn--primary', onclick: () => editor() }, 'New coupon') }))));
      return;
    }
    tbody.replaceChildren(...coupons.map((c) => {
      const [bs, bt] = STATE_BADGE[c.state] || STATE_BADGE.off;
      return h('tr', null,
        h('td', null, h('button', { type: 'button', class: 'link-btn', 'aria-haspopup': 'dialog', onclick: () => editor(c) }, h('strong', null, c.code))),
        h('td', null, c.name),
        h('td', null, discountText(c)),
        h('td', null, appliesText(c), h('div', { class: 'muted small' }, plansText(c.plans))),
        h('td', null, `${c.starts_at ? fmtDateTime(c.starts_at) : '—'} to ${c.ends_at ? fmtDateTime(c.ends_at) : 'No end'}`),
        h('td', null, usedText(c)),
        h('td', null, badge(bs, bt)),
        h('td', null, c.require_card ? 'Yes' : '—'),
        h('td', null, h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': `Redemptions of ${c.code}`, onclick: () => redemptions(c) }, 'Redemptions')));
    }));
  };
  draw(first);
  async function load() {
    history.replaceState(null, '', `#/admin/coupons${qs(changed(filters, defaults))}`);
    try { draw(await get(`/admin/coupons${qs(apiFilters(filters))}`)); } catch (err) { toast(err.message, 'error'); }
  }
  const bar = filterBar({
    key: 'admin-coupons', values: filters, defaults, onChange: load,
    search: { placeholder: 'Search code or name' },
    quick: [
      { name: 'state', label: 'Status', all: 'All statuses', options: [['active', 'Active'], ['scheduled', 'Scheduled'], ['ended', 'Ended'], ['full', 'Limit reached'], ['off', 'Switched off']] },
      { name: 'kind', label: 'Type', all: 'All types', options: [['percent', 'Percentage'], ['fixed', 'Fixed amount'], ['free', 'Free access']] },
    ],
    more: [
      { name: 'plan', label: 'Plan', all: 'Any plan', options: Object.entries(PLAN_NAMES) },
      { name: 'sort', label: 'Sort by', all: 'Newest first', options: [['oldest', 'Oldest first'], ['code', 'Code (A–Z)'], ['ending', 'Ending soonest'], ['most_used', 'Most used']] },
    ],
  });

  el.replaceChildren(
    h('a', { class: 'back', href: '#/admin' }, '‹ ', 'Platform admin'),
    h('div', { class: 'page-head' }, h('div', { class: 'page-head__title' }, h('h1', null, 'Plan coupons'),
      h('p', null, "Coupons for BalayHub plans. These are not your hosts' guest discount codes.")),
      h('div', { class: 'page-head__actions' }, h('button', { type: 'button', class: 'btn btn--primary', onclick: () => editor() }, 'New coupon'))),
    h('div', { class: 'stats' }, sActive.el, sScheduled.el, sEnded.el, sGiven.el),
    h('div', { style: { marginTop: '16px' } }, bar), count,
    h('div', { class: 'card card--flush' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, ['Code', 'Name', 'Discount', 'Applies to', 'Runs', 'Used', 'Status', 'Card required', h('span', { class: 'sr-only' }, 'Actions')].map((t) => h('th', null, t)))),
      tbody))));
}
