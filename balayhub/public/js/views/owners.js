// Unit owners (people whose units you manage) and their monthly statements.

import { get, post, patch, qs } from '../api.js';
import { h, peso, fmtDate, fmtDateTime, field, formModal, confirmDialog, emptyState, pageHead, badge, toast, todayManila } from '../ui.js';
import { navigate } from '../app.js';
import { CHANNEL_LABEL } from './reservations.js';
import { initFilters, filterBar, changed, apiFilters } from '../filters.js';

// Calendar day of a timestamp in Manila time (fmtDate alone would slice the UTC date).
const manilaDay = (ts) => fmtDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(ts)));
const short = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const num = (v) => h('td', { class: 'num' }, v);

// 2000 to 2100, the same years the server accepts.
const MONTH_RE = /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/;
// A month in the URL: valid, or '' when absent (use last month). Anything else is bad and gets a message.
const badMonth = (q) => q.month != null && q.month !== '' && !MONTH_RE.test(q.month);
const badMonthAlert = (q) => h('div', { class: 'alert alert--warn', role: 'alert' }, `"${q.month}" is not a valid month. Choose a month above.`);

const lastMonth = () => {
  const [y, m] = todayManila().split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

// A statement can be published only once its month has ended (the server applies the same rule).
const monthHasEnded = (month, today) => month < today.slice(0, 7);
// The last day of a month (YYYY-MM to YYYY-MM-DD). A statement can be published from the day after it.
const lastDayOf = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
// Drafts that can be published now. The list is for one month, so its drafts are all ready or none are.
const readyCount = (rows, month, today) => (monthHasEnded(month, today) ? rows.filter((r) => r.status !== 'published').length : 0);

// The Publish dialog's text. The owner sees a statement in the portal only when the portal is on; otherwise it goes by email.
export function publishText(monthLabel, portalOn) {
  const later = "Later changes won't show until you unpublish and publish again.";
  return portalOn
    ? `The ${monthLabel} numbers are frozen and the owner can see them in their portal. ${later}`
    : `The ${monthLabel} numbers are frozen. The owner's portal is off, so send the statement by email. ${later}`;
}

// The Unpublish dialog's text. `emailedOn` is the send date of a statement that was emailed, or null.
export function unpublishText(emailedOn) {
  return `The owner can no longer see this statement.${emailedOn ? ` It was emailed on ${emailedOn}. The owner keeps that copy.` : ''} Make your corrections, then publish it again.`;
}

function unitChecks(units, owner) {
  return h('fieldset', { class: 'field', dataset: { field: 'unit_ids' }, style: { border: 0, padding: 0, margin: 0 } },
    h('legend', null, 'Their units'),
    units.length ? h('div', { class: 'checks' }, units.map((u) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', name: 'unit_ids', value: u.unit_id, dataset: { multi: '1' }, checked: owner ? u.owner_id === owner.owner_id : false }),
      h('span', null, `${u.unit_name} · ${u.property_name}${u.owner_id && (!owner || u.owner_id !== owner.owner_id) ? ' (has another owner)' : ''}`))))
      : h('p', { class: 'muted small' }, 'Add listings first.'),
    h('div', { class: 'error', role: 'alert' }));
}

const FEE_MODELS = [['net_pct', 'Percent of net income'], ['gross_pct', 'Percent of gross income'], ['flat', 'Flat monthly fee']];
const PAYOUT_METHODS = [['gcash', 'GCash'], ['maya', 'Maya'], ['bank_transfer', 'Bank transfer'], ['cash', 'Cash'], ['other', 'Other']];
const METHOD_LABEL = Object.fromEntries(PAYOUT_METHODS);
const FEE_SHORT = { net_pct: (o) => `${Number(o.management_fee_pct)}% of net`, gross_pct: (o) => `${Number(o.management_fee_pct)}% of gross`, flat: (o) => `${peso(o.flat_monthly_fee)} a month` };
const feeText = (o) => (FEE_SHORT[o.fee_model || 'net_pct'] || FEE_SHORT.net_pct)(o);

function ownerForm(units, o = {}) {
  const model = field({ name: 'fee_model', label: 'How the management fee is worked out', type: 'select', required: true, value: o.fee_model || 'net_pct', placeholderOption: false, options: FEE_MODELS,
    hint: 'Percent of net is after channel fees, cleaning fees and refunds. Percent of gross is the booking total minus refunds. A flat fee is charged every month, even with no stays.' });
  // A new owner's percentage starts empty: the host types it (the server refuses a blank one on a percentage model).
  const pct = h('div', null, field({ name: 'management_fee_pct', label: 'Management fee (%)', type: 'number', inputmode: 'decimal', step: 0.01, min: 0, max: 100, required: true, value: o.management_fee_pct ?? '' }));
  const flat = h('div', null, field({ name: 'flat_monthly_fee', label: 'Flat fee per month', type: 'money', value: o.flat_monthly_fee ?? '0', hint: 'Charged in any month this owner has a unit, even with no stays.' }));
  const sync = () => {
    const v = model.querySelector('select').value;
    pct.hidden = v === 'flat';
    flat.hidden = v !== 'flat';
    // A blank percentage is refused on a percentage model; a flat fee has no percentage to fill in.
    pct.querySelector('input').required = v !== 'flat';
  };
  model.querySelector('select').addEventListener('change', sync);
  sync();
  return [
    field({ name: 'full_name', label: 'Owner name', required: true, value: o.full_name, maxlength: 120 }),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'email', label: 'Email (for statements and portal sign-in)', type: 'email', value: o.email }),
      field({ name: 'phone', label: 'Mobile number', type: 'tel', value: o.phone })),
    model, pct, flat,
    field({ name: 'cleaning_to_manager', label: 'Cleaning fees go to me / the cleaner, not the owner', type: 'checkbox', value: o.cleaning_to_manager ?? true }),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'reserve_target', label: 'Repairs reserve target', type: 'money', value: o.reserve_target ?? '0', hint: 'Set to 0 to turn the reserve off.' }),
      field({ name: 'reserve_monthly', label: 'Top-up each month', type: 'money', value: o.reserve_monthly ?? '0', hint: 'Taken from the payout until the target is reached.' })),
    unitChecks(units, o.owner_id ? o : null),
    field({ name: 'notes', label: 'Notes', type: 'textarea', value: o.notes, maxlength: 1000, placeholder: 'e.g. Payout by BDO transfer on the 5th' }),
  ];
}

function portalChip(o) {
  if (!o.portal_enabled) return h('span', { class: 'badge badge--own-off' }, 'Portal off');
  if (!o.portal_last_seen_at) return badge('unpaid', 'Portal invited');
  return badge('paid', `Portal active · seen ${manilaDay(o.portal_last_seen_at)}`);
}

// A unit that belongs to another owner moves only when the host agrees: the server refuses the save (409 UNIT_HAS_OWNER) and
// writes nothing until it is sent again with move_units. Cancel returns false, so the form stays open with nothing posted.
const moveConfirmed = (err, owner) => {
  if (err.code !== 'UNIT_HAS_OWNER') throw err;
  const moving = err.data.units.map((u) => `${u.unit_name} from ${u.owner_name}`).join(', ');
  const one = err.data.units.length === 1;
  return confirmDialog({
    title: one ? 'Move this unit?' : 'Move these units?',
    text: `Move ${moving} to ${owner}? ${one ? 'Its' : 'Their'} stays and expenses show on ${owner}'s statements from now on.`,
    confirmText: 'Move',
  });
};

// An email another active owner already uses asks first (409 EMAIL_IN_USE). Change it returns false: the form stays open and
// the email box takes focus.
const emailConfirmed = async (err) => {
  if (err.code !== 'EMAIL_IN_USE') throw err;
  if (await confirmDialog({ title: 'Email already used', text: `This email already belongs to ${err.data.owner_name}. Save anyway?`, confirmText: 'Save anyway', cancelText: 'Change it' })) return true;
  document.querySelector('dialog.modal [name="email"]')?.focus();
  return false;
};

// An email that is a teammate's login asks too (409 EMAIL_IS_LOGIN), the same way.
const loginConfirmed = async (err) => {
  if (await confirmDialog({ title: 'Email is a login', text: `This email is a login for ${err.data.login_name}. Save anyway?`, confirmText: 'Save anyway', cancelText: 'Change it' })) return true;
  document.querySelector('dialog.modal [name="email"]')?.focus();
  return false;
};

// A percentage fee over 50 asks first (0 is allowed, a flat fee has no percentage). Change it puts focus in the fee box and
// returns false, so the form stays open and nothing is posted.
export const feeNeedsAsk = (model, fee) => model !== 'flat' && Number(fee) > 50;
// On edit (o = the stored owner) it asks only when the model or the fee changed.
export const feeChanged = (d, o) => !o || (d.fee_model || 'net_pct') !== (o.fee_model || 'net_pct') || Number(d.management_fee_pct) !== Number(o.management_fee_pct);
const feeConfirmed = async (d, o) => {
  if (!feeNeedsAsk(d.fee_model, d.management_fee_pct) || !feeChanged(d, o)) return true;
  if (await confirmDialog({ title: 'Check the management fee', text: `This is a ${Number(d.management_fee_pct)}% management fee. Save anyway?`, confirmText: 'Save anyway', cancelText: 'Change it' })) return true;
  document.querySelector('dialog.modal [name="management_fee_pct"]')?.focus();
  return false;
};

// A name another active owner already uses asks first (409 NAME_IN_USE), the same way as the email.
const nameConfirmed = async (err) => {
  if (await confirmDialog({ title: 'Name already used', text: `An owner named ${err.data.owner_name} already exists. Save anyway?`, confirmText: 'Save anyway', cancelText: 'Change it' })) return true;
  document.querySelector('dialog.modal [name="full_name"]')?.focus();
  return false;
};

export async function ownersView(el, { rerender, query = {} }) {
  const defaults = { q: '', has_units: '', unit_id: '', sort: '' };
  const filters = initFilters('owners', query, defaults);
  let { owners, units, total } = await get(`/unit-owners${qs(apiFilters(filters))}`);
  const unitName = (id) => units.find((u) => u.unit_id === id)?.unit_name;
  const add = () => formModal({
    title: 'Add a unit owner', submitText: 'Save owner', fields: ownerForm(units),
    onSubmit: async (d) => {
      if (!await feeConfirmed(d)) return false;
      const body = { ...d, unit_ids: d.unit_ids || [] };
      // Each 409 is asked in turn; a yes adds its flag and the save is sent again.
      let extra = {};
      for (;;) {
        try { await post('/unit-owners', { ...body, ...extra }); break; } catch (err) {
          if (err.code === 'NAME_IN_USE') { if (!await nameConfirmed(err)) return false; extra = { ...extra, confirm_duplicate_name: true }; continue; }
          if (err.code === 'EMAIL_IN_USE') { if (!await emailConfirmed(err)) return false; extra = { ...extra, confirm_duplicate_email: true }; continue; }
          if (err.code === 'EMAIL_IS_LOGIN') { if (!await loginConfirmed(err)) return false; extra = { ...extra, confirm_login_email: true }; continue; }
          if (!await moveConfirmed(err, d.full_name)) return false;
          extra = { ...extra, move_units: true };
        }
      }
      toast('Owner saved.'); rerender();
    },
  });
  const edit = (o) => formModal({
    title: `Edit ${o.full_name}`, submitText: 'Save', fields: ownerForm(units, o),
    onSubmit: async (d) => {
      if (!await feeConfirmed(d, o)) return false;
      const body = { ...d, unit_ids: d.unit_ids || [] };
      let extra = {};
      for (;;) {
        try { await patch(`/unit-owners/${o.owner_id}`, { ...body, ...extra }); break; } catch (err) {
          if (err.code === 'NAME_IN_USE') { if (!await nameConfirmed(err)) return false; extra = { ...extra, confirm_duplicate_name: true }; continue; }
          if (err.code === 'EMAIL_IN_USE') { if (!await emailConfirmed(err)) return false; extra = { ...extra, confirm_duplicate_email: true }; continue; }
          if (err.code === 'EMAIL_IS_LOGIN') { if (!await loginConfirmed(err)) return false; extra = { ...extra, confirm_login_email: true }; continue; }
          if (!await moveConfirmed(err, d.full_name)) return false;
          extra = { ...extra, move_units: true };
        }
      }
      toast('Saved.'); rerender();
    },
  });
  const archive = async (o) => {
    if (!await confirmDialog({ title: `Remove ${o.full_name}?`, text: 'Their units will no longer have an owner. Past reservations and expenses are not changed.', confirmText: 'Remove owner' })) return;
    try { await post(`/unit-owners/${o.owner_id}/archive`); toast('Owner removed.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };

  const invite = async (o) => {
    if (!o.email) { toast('Add an email for this owner first.', 'error'); return; }
    if (!await confirmDialog({ title: 'Invite to owner portal?', text: `${o.full_name} will get an email at ${o.email} with a sign-in link. They can see their published statements, bookings and payouts, and block their own dates.`, confirmText: 'Send invite' })) return;
    try {
      const r = await post(`/unit-owners/${o.owner_id}/portal-invite`);
      // The server turns portal access on even when the email is refused, so the toast and the card say which it was.
      if (r.sent) toast(`Invite sent to ${o.email}.`);
      else toast(`The invite email to ${o.email} couldn't be sent. Portal access is on. Check the email address, then use Send the invite again.`, 'error');
      rerender();
    } catch (err) { toast(err.code === 'NO_EMAIL' ? 'Add an email for this owner first.' : err.message, 'error'); }
  };
  const disablePortal = async (o) => {
    if (!await confirmDialog({ title: 'Turn off portal access?', text: `${o.full_name} will be signed out and can't sign in again until you invite them.`, confirmText: 'Turn off access', danger: true })) return;
    try { await post(`/unit-owners/${o.owner_id}/portal-disable`); toast('Portal access turned off.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };

  const listBox = h('div');
  function draw() {
    const filtered = Object.keys(changed(filters, defaults)).some((k) => k !== 'sort');
    if (!owners.length) {
      listBox.replaceChildren(h('div', { class: 'card' }, filtered
        ? emptyState({ iconName: 'file', title: 'No results found', text: 'No owner matches these filters. Try removing a filter.' })
        : emptyState({
          iconName: 'file', title: 'No unit owners yet',
          text: 'If you manage units for other owners, add them here and assign their units. BalayHub then prepares a monthly statement: bookings, channel fees, your management fee, expenses and their payout. Own these units yourself? You don\'t need this page. Profit and loss shows each unit.',
          action: h('button', { class: 'btn btn--primary', type: 'button', onclick: add }, '+ Add owner'),
        })));
      return;
    }
    listBox.replaceChildren(
      filtered ? h('p', { class: 'muted small' }, `Showing ${owners.length} of ${total} owner${total === 1 ? '' : 's'}`) : '',
      h('div', { class: 'grid grid--2' }, owners.map((o) => h('div', { class: 'card' },
        h('div', { class: 'card__head' }, h('h2', null, o.full_name),
          h('div', { class: 'chips' },
            h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Edit ${o.full_name}`, onclick: () => edit(o) }, 'Edit'),
            h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Remove ${o.full_name}`, onclick: () => archive(o) }, 'Remove'))),
        h('dl', { class: 'dl' },
          h('dt', null, 'Units'), h('dd', null, o.unit_ids.map(unitName).filter(Boolean).join(', ') || 'None yet'),
          h('dt', null, 'Management fee'), h('dd', null, `${feeText(o)}${o.cleaning_to_manager ? ' · cleaning fees kept for cleaning' : ''}`),
          Number(o.reserve_target) > 0 && [h('dt', null, 'Repairs reserve'), h('dd', null, `${peso(o.reserve_monthly)} a month up to ${peso(o.reserve_target)}`)],
          h('dt', null, 'Owner portal'), h('dd', null, portalChip(o)),
          o.email && [h('dt', null, 'Email'), h('dd', null, o.email)],
          o.phone && [h('dt', null, 'Mobile'), h('dd', null, o.phone)]),
        h('div', { class: 'chips', style: { marginTop: '12px' } },
          h('a', { class: 'btn btn--primary btn--sm', href: `#/owners/${o.owner_id}/statement?month=${lastMonth()}`, 'aria-label': `Statement for last month, ${o.full_name}` }, 'Statement for last month'),
          h('a', { class: 'btn btn--secondary btn--sm', href: `#/owners/${o.owner_id}/statement?month=${todayManila().slice(0, 7)}`, 'aria-label': `This month so far, ${o.full_name}` }, 'This month so far'),
          o.portal_enabled
            ? [h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Turn off portal access, ${o.full_name}`, onclick: () => disablePortal(o) }, 'Turn off portal access'),
              h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'aria-label': `Send the invite again, ${o.full_name}`, onclick: () => invite(o), 'data-focus-key': `owner-invite-${o.owner_id}` }, 'Send the invite again')]
            : h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `${o.portal_invited_at ? 'Invite again' : 'Invite to owner portal'}, ${o.full_name}`, onclick: () => invite(o), 'data-focus-key': `owner-invite-${o.owner_id}` }, o.portal_invited_at ? 'Invite again' : 'Invite to owner portal'))))));
  }
  async function load() {
    history.replaceState(null, '', `#/owners${qs(changed(filters, defaults))}`);
    ({ owners, units, total } = await get(`/unit-owners${qs(apiFilters(filters))}`));
    draw();
  }
  // Built first: the bar drops a filter value that is not an option, so the page decides whether to show it after that.
  const bar = filterBar({
    key: 'owners', values: filters, defaults, onChange: load,
    search: { placeholder: 'Search name, email or mobile' },
    quick: [{ name: 'has_units', label: 'Units', all: 'Any number of units', options: [['yes', 'Has units'], ['no', 'No units yet']] }],
    more: [
      units.length > 0 && { name: 'unit_id', label: 'Owns listing', all: 'Any listing', options: units.map((u) => [u.unit_id, `${u.unit_name} · ${u.property_name}`]) },
      { name: 'sort', label: 'Sort by', all: 'Name (A–Z)', options: [['units', 'Most units'], ['fee', 'Highest management fee'], ['newest', 'Newest first']] },
    ].filter(Boolean),
  });
  // No filter bar for a single owner (unless a filter is still on from before).
  const showBar = total > 1 || Object.keys(changed(filters, defaults)).length > 0;
  // Drawn after the bar: the bar drops a filter value that is not an option, and the count line must not count it.
  draw();

  el.replaceChildren(
    pageHead({
      title: 'Unit owners', sub: 'Monthly statements for owners whose units you manage',
      actions: [h('a', { class: 'btn btn--secondary', href: `#/owners/statements?month=${lastMonth()}` }, 'Review statements'), h('button', { class: 'btn btn--primary', type: 'button', onclick: add }, '+ Add owner')],
    }),
    showBar ? bar : '', listBox);
  // Once per visit: rerender() reuses this query, so the flag is dropped before the dialog opens.
  query.new && (delete query.new, history.replaceState(null, '', '#/owners'), add());
}

export async function ownerStatementsView(el, { query = {} }) {
  const invalid = badMonth(query);
  const month = MONTH_RE.test(query.month || '') ? query.month : lastMonth();
  const data = invalid ? { owners: [] } : await get(`/owner-statements${qs({ month })}`);
  const list = data.owners;
  const monthInput = h('input', { class: 'input input--sm', type: 'month', value: month, 'aria-label': 'Month',
    onchange: (e) => { if (e.target.value) navigate(`#/owners/statements?month=${e.target.value}`); } });
  const status = (r) => (r.status === 'published'
    ? (r.sent_at ? badge('unpaid', 'Sent') : badge('paid', 'Published'))
    : badge('partial', 'Draft'));
  const drafts = list.filter((r) => r.status !== 'published').length;
  const ready = readyCount(list, month, todayManila());
  el.replaceChildren(
    pageHead({
      title: 'Owner statements', sub: 'Review each owner\'s statement, publish it, then send it.',
      back: { href: '#/owners', label: 'Unit owners' },
      actions: monthInput,
    }),
    invalid ? badMonthAlert(query) : list.length
      ? [ready > 0 && h('div', { class: 'alert alert--info' }, `${ready} statement${ready === 1 ? ' is' : 's are'} ready to publish. Open each one, check the numbers, then publish.`),
        !ready && drafts > 0 && h('div', { class: 'alert alert--info' }, `${drafts} ${drafts === 1 ? 'draft' : 'drafts'} can be published once the month ends.`),
        h('div', { class: 'card card--flush' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table own-list' },
          h('thead', null, h('tr', null, ['Owner', 'Units', 'Status', 'Payout', 'Sent', h('span', { class: 'sr-only' }, 'Actions')].map((x, i) => h('th', { class: i === 3 ? 'num' : null }, x)))),
          h('tbody', null, list.map((r) => h('tr', null,
            h('td', null, h('strong', null, r.full_name)),
            h('td', null, String(r.unit_count)),
            h('td', null, status(r)),
            h('td', { class: `num${Number(r.payout) < 0 ? ' amount--neg' : ''}` }, Number(r.payout) < 0 ? `Owes you ${peso(-Number(r.payout))}` : peso(r.payout)),
            h('td', null, r.sent_at ? manilaDay(r.sent_at) : '—'),
            h('td', { class: 'num' }, h('a', { class: 'btn btn--secondary btn--sm', href: `#/owners/${r.owner_id}/statement?month=${month}`, 'aria-label': `${r.status === 'published' ? 'Open' : 'Review'} statement, ${r.full_name}` }, r.status === 'published' ? 'Open' : 'Review'))))))))]
      : h('div', { class: 'card' }, emptyState({ iconName: 'file', title: 'No owners with units yet', text: 'Add a unit owner and assign their units to get statements here.', action: h('a', { class: 'btn btn--primary', href: '#/owners' }, 'Go to unit owners') })));
}

export async function ownerStatementView(el, { params, query = {}, rerender }) {
  const month = MONTH_RE.test(query.month || '') ? query.month : lastMonth();
  const id = params.id;
  const base = `/unit-owners/${id}`;
  if (badMonth(query)) {
    el.replaceChildren(
      h('a', { class: 'back no-print', href: '#/owners' }, '‹ Unit owners'),
      h('div', { class: 'page-head' }, h('div', { class: 'page-head__title' }, h('h1', null, 'Owner statement')),
        h('div', { class: 'page-head__actions' }, h('input', { class: 'input input--sm', type: 'month', value: month, 'aria-label': 'Month',
          onchange: (e) => { if (e.target.value) navigate(`#/owners/${id}/statement?month=${e.target.value}`); } }))),
      badMonthAlert(query));
    return;
  }
  const detail = await get(`${base}/statement?month=${month}`);
  const live = detail.statement;
  const record = detail.record;
  const published = record?.status === 'published' ? detail.published : null;
  const s = published || live; // published = the frozen copy (snapshot) the owner sees
  const t = s.totals;
  const [payoutsRes, reserveRes, ownersRes] = await Promise.all([
    get(`${base}/payouts${qs({ month })}`).catch(() => null),
    get(`${base}/reserve`).catch(() => null),
    detail.portal_enabled === undefined ? get('/unit-owners').catch(() => null) : null, // older payload: read the flag from the owner list
  ]);
  const payouts = payoutsRes?.payouts || null;
  const reserve = reserveRes;
  const portalOn = detail.portal_enabled ?? Boolean(ownersRes?.owners?.find((o) => o.owner_id === id)?.portal_enabled);
  const paid = (payouts || []).filter((p) => !p.voided).reduce((a, p) => a + Math.round(Number(p.amount) * 100), 0) / 100;
  const payoutDue = Number(t.payout);
  const owes = payoutDue < 0; // flat fee with no stays: the owner owes the host
  const overpaid = owes ? 0 : Math.max(0, Math.round((paid - payoutDue) * 100) / 100);
  const remaining = owes ? 0 : Math.max(0, Math.round((payoutDue - paid) * 100) / 100);
  const topup = Number(s.reserve?.topup) || 0;
  const monthEnded = monthHasEnded(month, todayManila());

  const act = async (path, body, okText) => {
    try { await post(`${base}/statement/${path}`, body); toast(okText); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  const publish = async () => {
    if (!await confirmDialog({ title: 'Publish this statement?', text: publishText(s.month_label, portalOn), confirmText: 'Publish' })) return;
    act('publish', { month }, 'Statement published.');
  };
  const unpublish = async () => {
    if (!await confirmDialog({ title: 'Unpublish to correct?', text: unpublishText(record.sent_at ? fmtDate(manilaDay(record.sent_at)) : null), confirmText: 'Unpublish', danger: true })) return;
    act('unpublish', { month }, 'Statement is a draft again.');
  };
  // The server emails the owner's current address (live), so the button and the message use that, not the frozen copy.
  const send = async () => {
    if (!await confirmDialog({ title: 'Email this statement?', text: `Send the ${s.month_label} statement to ${live.owner.email}?`, confirmText: 'Send' })) return;
    act('send', { month }, `Statement sent to ${live.owner.email}.`);
  };
  const monthInput = h('input', { class: 'input input--sm', type: 'month', value: month, 'aria-label': 'Month',
    onchange: (e) => { if (e.target.value) navigate(`#/owners/${id}/statement?month=${e.target.value}`); } });
  const row = (label, value, opts = {}) => [h('dt', null, label), h('dd', { class: opts.cls || null }, opts.strong ? h('strong', null, value) : value)];

  // Status bar.
  const statusText = published
    ? `Published ${fmtDateTime(record.published_at)}${record.sent_at ? ` · Sent to ${record.sent_to || 'owner'} on ${fmtDateTime(record.sent_at)}` : ' · Not sent yet'}`
    : 'Draft. The owner can\'t see it until you publish.';
  const drift = published && Number(live.totals.payout) !== Number(published.totals.payout);
  const statusBar = h('div', { class: 'own-status no-print' },
    h('div', { class: 'own-status__text' }, published ? badge(record.sent_at ? 'unpaid' : 'paid', record.sent_at ? 'Sent' : 'Published') : badge('partial', 'Draft'), h('span', null, statusText),
      published && !live.owner.email && h('span', { class: 'muted small' }, 'Add an email for this owner first.')),
    h('div', { class: 'chips' },
      !published && h('button', { class: 'btn btn--primary btn--sm', type: 'button', disabled: !monthEnded, title: monthEnded ? null : 'You can publish once the month has ended.', onclick: publish, 'data-focus-key': 'stmt-publish' }, 'Publish'),
      published && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: unpublish, 'data-focus-key': 'stmt-publish' }, 'Unpublish to correct'),
      published && h('button', { class: 'btn btn--secondary btn--sm', type: 'button', disabled: !live.owner.email, title: live.owner.email ? null : 'Add an email for this owner first.', onclick: send, 'data-focus-key': 'stmt-send' }, record.sent_at ? 'Send again' : 'Send to owner'),
      h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => window.print() }, 'Print / save as PDF')));

  // Payouts card.
  const recordPayout = () => formModal({
    title: 'Record payout', submitText: 'Save payout', idempotent: true,
    fields: [
      field({ name: 'amount', label: 'Amount paid', type: 'money', required: true, value: remaining > 0 ? remaining.toFixed(2) : '', hint: owes ? 'This month the owner owes you, so there is nothing to pay out.' : `${peso(remaining)} of the ${s.month_label} payout is still unpaid.` }),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'paid_on', label: 'Date paid', type: 'date', required: true, value: todayManila(), max: todayManila() }),
        field({ name: 'method', label: 'Method', type: 'select', placeholderOption: 'Choose…', options: PAYOUT_METHODS })),
      field({ name: 'reference_number', label: 'Reference number (optional)', maxlength: 100 }),
      field({ name: 'note', label: 'Note (optional)', type: 'textarea', maxlength: 500 }),
    ],
    check: (d) => (!d.method ? { method: 'Choose how you paid the owner.' } : null),
    onSubmit: async (d, { idempotencyKey }) => {
      try { await post(`${base}/payouts`, { ...d, month }, { idempotencyKey }); } catch (err) {
        if (err.code !== 'PAYOUT_OVER_DUE') throw err;
        // Paying more than the statement says is allowed, but only if the host confirms it. Cancel returns false: nothing is posted and the form stays open with no message.
        if (!await confirmDialog({ title: 'Pay more than the statement?', text: err.message, confirmText: 'Record anyway' })) return false;
        await post(`${base}/payouts`, { ...d, month, confirm_over: true }, { idempotencyKey });
      }
      toast('Payout recorded.'); rerender();
    },
  });
  const voidPayout = async (p) => {
    const reason = await confirmDialog({ title: 'Void this payout?', text: `${peso(p.amount)} paid on ${fmtDate(p.paid_on)}. The record is kept for history.`, confirmText: 'Void payout', danger: true, reason: true });
    if (!reason) return;
    try { await post(`/owner-payouts/${p.payout_id}/void`, { reason }); toast('Payout voided.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  const payoutsCard = h('section', { class: 'card no-print' },
    h('div', { class: 'card__head' }, h('h2', null, 'Payouts'),
      h('button', { class: 'btn btn--primary btn--sm', type: 'button', disabled: !payouts, onclick: recordPayout }, 'Record payout')),
    payouts
      ? [h('p', { class: 'own-paid' }, h('strong', null, owes ? `Paid ${peso(paid)}. The owner owes you ${peso(-payoutDue)} this month.` : `Paid ${peso(paid)} of ${peso(payoutDue)}`), remaining > 0 ? ` · ${peso(remaining)} left to pay` : ''),
        overpaid > 0 && h('p', { class: 'own-paid amount--neg' }, `Overpaid by ${peso(overpaid)}`),
        payouts.length
          ? h('ul', { class: 'list' }, payouts.map((p) => h('li', null, h('div', { class: 'row' },
            h('div', { class: 'row__main' },
              h('span', { class: `row__title${p.voided ? ' strike' : ''}` }, `${peso(p.amount)} · ${METHOD_LABEL[p.method] || p.method}`),
              h('span', { class: 'row__sub' }, `${fmtDate(p.paid_on)}${p.reference_number ? ` · Ref ${p.reference_number}` : ''}${p.note ? ` · ${p.note}` : ''}`),
              p.voided && h('span', { class: 'row__sub' }, `Voided: ${p.void_reason}`)),
            h('div', { class: 'row__end' }, p.voided ? badge('voided', 'Voided') : h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Void payout of ${peso(p.amount)} on ${fmtDate(p.paid_on)}`, onclick: () => voidPayout(p) }, 'Void'))))))
          : h('p', { class: 'muted small' }, 'No payouts recorded for this month yet.')]
      : h('p', { class: 'muted small' }, 'Payouts could not be loaded. Refresh the page to try again.'));

  // Repairs reserve card.
  const withdraw = () => formModal({
    title: 'Record reserve withdrawal', submitText: 'Save withdrawal',
    fields: [
      field({ name: 'amount', label: 'Amount used', type: 'money', required: true, hint: `Reserve balance: ${peso(reserve.balance)}.` }),
      field({ name: 'entry_date', label: 'Date', type: 'date', required: true, value: todayManila(), max: todayManila() }),
      field({ name: 'note', label: 'What it paid for', type: 'textarea', required: true, maxlength: 300, hint: 'For example: aircon repair in Unit 2.' }),
    ],
    onSubmit: async (d) => { await post(`${base}/reserve/withdrawals`, d); toast('Withdrawal recorded.'); rerender(); },
  });
  const voidEntry = async (e) => {
    const reason = await confirmDialog({ title: 'Void this withdrawal?', text: `${peso(e.amount)} on ${fmtDate(e.entry_date)} goes back into the reserve.`, confirmText: 'Void withdrawal', danger: true, reason: true });
    if (!reason) return;
    try { await post(`/reserve-entries/${e.entry_id}/void`, { reason }); toast('Withdrawal voided.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  const entries = reserve?.entries || [];
  const showReserve = reserve && (Number(reserve.target) > 0 || Number(reserve.monthly) > 0 || entries.length > 0);
  const reserveCard = showReserve && h('section', { class: 'card no-print' },
    h('div', { class: 'card__head' }, h('h2', null, 'Repairs reserve'),
      h('button', { class: 'btn btn--secondary btn--sm', type: 'button', disabled: Number(reserve.balance) <= 0, onclick: withdraw }, 'Record withdrawal')),
    h('dl', { class: 'dl' },
      h('dt', null, 'Balance'), h('dd', null, h('strong', null, peso(reserve.balance))),
      h('dt', null, 'Target'), h('dd', null, peso(reserve.target)),
      h('dt', null, 'Top-up each month'), h('dd', null, peso(reserve.monthly))),
    entries.length
      ? h('ul', { class: 'list' }, entries.map((e) => h('li', null, h('div', { class: 'row' },
        h('div', { class: 'row__main' },
          h('span', { class: `row__title${e.voided ? ' strike' : ''}` }, `${e.kind === 'deposit' ? 'Top-up' : 'Withdrawal'} · ${peso(e.amount)}`),
          h('span', { class: 'row__sub' }, `${fmtDate(e.entry_date)}${e.note ? ` · ${e.note}` : ''}`),
          e.voided && h('span', { class: 'row__sub' }, `Voided${e.void_reason ? `: ${e.void_reason}` : ''}`)),
        h('div', { class: 'row__end' }, e.voided ? badge('voided', 'Voided') : (e.kind === 'withdrawal' && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Void withdrawal of ${peso(e.amount)} on ${fmtDate(e.entry_date)}`, onclick: () => voidEntry(e) }, 'Void')))))))
      : h('p', { class: 'muted small' }, 'No reserve activity yet.'));

  el.replaceChildren(
    h('a', { class: 'back no-print', href: '#/owners' }, '‹ Unit owners'),
    h('div', { class: 'page-head no-print' },
      h('div', { class: 'page-head__title' }, h('h1', null, `Statement · ${s.owner.full_name}`)),
      h('div', { class: 'page-head__actions' }, monthInput)),
    statusBar,
    // The Publish reason is printed here too, not only in the button's tooltip.
    !published && !monthEnded && h('p', { class: 'muted small no-print' }, `You can publish this statement after ${fmtDate(lastDayOf(month))}.`),
    drift && h('div', { class: 'alert alert--warn no-print' }, `Numbers have changed since you published. The owner still sees the published copy (payout ${peso(published.totals.payout)}); today's live payout is ${peso(live.totals.payout)}. Unpublish to correct, then publish again.`),
    s.missing_amounts > 0 && h('div', { class: 'alert alert--warn no-print' },
      `${s.missing_amounts} stay${s.missing_amounts > 1 ? 's have' : ' has'} no amount yet (usually stays synced from a channel calendar). Open each reservation and enter what the guest paid and the channel fee, so the statement is complete.`),
    h('div', { class: 'card receipt statement' },
      h('div', { class: 'receipt__head' },
        h('div', null, h('h2', null, s.workspace), h('div', { class: 'muted small' }, `Prepared for ${s.owner.full_name}`)),
        h('div', { class: 'receipt__no' }, h('div', { class: 'subhead' }, 'Owner statement'), h('strong', null, s.month_label))),
      h('p', { class: 'muted small' }, `Units: ${s.units.map((u) => u.unit_name).join(', ') || 'none'} · ${t.stays} stay${t.stays === 1 ? '' : 's'}, ${t.nights} night${t.nights === 1 ? '' : 's'} (${t.occupancy_pct}% occupancy) · stays are counted in the month they check out, refunds in the month they were paid back`),
      h('h3', { class: 'subhead' }, 'Stays'),
      s.stays.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact' },
        h('thead', null, h('tr', null, ['Dates', 'Unit', 'Guest', 'Total', 'Channel fee', s.owner.cleaning_to_manager ? 'Cleaning' : null, 'Net'].filter(Boolean).map((x) => h('th', null, x)))),
        h('tbody', null, s.stays.map((x) => h('tr', null,
          h('td', { class: 'num' }, `${short(x.check_in)} – ${short(x.check_out)}`),
          h('td', null, x.unit_name, h('div', { class: 'muted small' }, CHANNEL_LABEL[x.channel] || x.channel)),
          h('td', null, x.guest_first_name),
          num(x.missing_amount ? h('span', { class: 'amount--neg' }, 'not entered') : peso(x.total_amount)),
          num(Number(x.channel_fee) ? `− ${peso(x.channel_fee)}` : '—'),
          s.owner.cleaning_to_manager && num(Number(x.cleaning_fee) ? `− ${peso(x.cleaning_fee)}` : '—'),
          num(peso(x.net)))))))
        : h('p', { class: 'muted' }, 'No stays have checked out this month yet.'),
      s.expenses.length > 0 && [
        h('h3', { class: 'subhead', style: { marginTop: '16px' } }, 'Expenses'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact' },
          h('thead', null, h('tr', null, ['Date', 'Unit', 'For', 'Amount', 'Receipt'].map((x) => h('th', null, x)))),
          h('tbody', null, s.expenses.map((e) => h('tr', null,
            h('td', { class: 'num' }, short(e.expense_date)), h('td', null, e.unit_name),
            h('td', null, [e.description || e.category.replace('_', ' '), e.vendor_name].filter(Boolean).join(' · ')),
            num(peso(e.amount)),
            h('td', null, e.has_receipt && e.receipt_file_id
              ? h('a', { class: 'link-tap', href: `/api/files/${e.receipt_file_id}`, target: '_blank', rel: 'noopener', 'aria-label': `Open receipt for ${e.description || 'expense'}` }, 'Receipt')
              : '—'))))))],
      h('h3', { class: 'subhead', style: { marginTop: '16px' } }, 'Summary'),
      h('dl', { class: 'dl statement__sum' },
        row('Gross bookings', peso(t.gross)),
        row('Less channel fees', `− ${peso(t.channel_fees)}`),
        s.owner.cleaning_to_manager && row('Less cleaning fees', `− ${peso(t.cleaning_fees)}`),
        row('Less refunds', `− ${peso(s.refunded)}`),
        row('Net rental income', peso(t.net_rental), { strong: true }),
        row(s.fee_label, `− ${peso(t.management_fee)}`),
        row('Expenses', `− ${peso(t.expenses)}`),
        topup > 0 && row('Repairs reserve top-up', `− ${peso(topup)}`),
        owes
          ? row('Owner owes you', peso(-payoutDue), { strong: true, cls: 'amount--neg' })
          : row('Payout to owner', peso(t.payout), { strong: true, cls: 'statement__payout' }),
        payouts && !owes && row('Paid so far', `${peso(paid)} of ${peso(payoutDue)}`),
        overpaid > 0 && row('Overpaid by', peso(overpaid), { cls: 'amount--neg' })),
      owes && h('p', { class: 'muted small' }, 'Your fee and expenses were more than this month\'s income, so the owner owes you this amount. Nothing to pay out.'),
      h('p', { class: 'muted small', style: { marginTop: '18px' } }, `Generated by BalayHub on ${fmtDate(todayManila())}.`)),
    payoutsCard, reserveCard || '');
}
