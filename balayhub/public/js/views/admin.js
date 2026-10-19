// Platform admin: every workspace, its plan and trial; activate a plan after payment.

import { get, patch, post, qs } from '../api.js';
import { h, fmtDate, fmtDateTime, manilaDay, badge, field, makeForm, openModal, confirmDialog, todayManila, emptyState, toast } from '../ui.js';
import { state } from '../app.js';
import { initFilters, filterBar, changed, apiFilters } from '../filters.js';

const BUSINESS = { short_term: 'Short-term stays', long_term: 'Monthly rentals', both: 'Both' };

// The server stores a trial end as the start of the next Manila day (src/routes/admin.js), so the day the
// admin entered is the day before. Showing that day means a save with no change sends back the same date.
export function trialLastDay(endsAt) {
  return endsAt ? manilaDay(new Date(new Date(endsAt).getTime() - 1)) : '';
}

// ---- helpers (read out by test/qa-r17-cardcheck-admin-view.test.js)
// Card column: card_check is null (not needed), required (waiting), passed (brand and last 4) or waived (skipped).
export function cardText(w) {
  if (w.card_check === 'required') return 'Waiting';
  if (w.card_check === 'passed') {
    if (!w.card_brand && !w.card_last4) return 'Removed'; // the owner removed the card after it passed
    const brand = w.card_brand ? w.card_brand.charAt(0).toUpperCase() + w.card_brand.slice(1) : 'Card';
    return `${brand} ${w.card_last4 || ''}`.trim();
  }
  if (w.card_check === 'waived') return 'Skipped';
  return '—';
}
// Trimmed on both sides, as the server does (src/routes/admin.js), so a stray space never leaves the button disabled.
export const nameMatches = (typed, name) => typed.trim() === name.trim();
export const DELETE_LATER = 'The owner and team are locked out now. You can cancel this for 14 days, then everything is deleted.';
export const DELETE_NOW = 'Everything is deleted right away: bookings, guests, files, and their PayMongo card and plan. This cannot be undone.';
export const skipCardText = (name) => `Skip the card check for ${name}? Their 14-day trial starts now.`;
// ---- end helpers

function statusBadge(w) {
  const s = w.status;
  if (w.is_demo) return badge('archived', 'Demo');
  if (w.admin_status === 'card_pending' || s.reason === 'card_check') return badge('partial', 'Waiting for card');
  if (w.admin_status === 'deleting') return badge('overdue', 'Deleting');
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
  const first = await get(`/admin/workspaces${qs(apiFilters(filters))}`);
  // The stats always count every workspace, whatever the filters.
  const { plans, summary, mrr } = first;
  const counts = {
    trial: summary.trial,
    paying: summary.paying + summary.grace,
    lapsed: summary.trial_ended + summary.overdue + summary.deleting,
  };

  const edit = (w) => {
    const paidUntil = w.paid_until ? String(w.paid_until).slice(0, 10) : '';
    const trialDay = trialLastDay(w.trial_ends_at);
    let modal;
    const skipCard = async () => {
      const ok = await confirmDialog({ title: 'Skip card check', text: skipCardText(w.name), confirmText: 'Skip card check', cancelText: 'Cancel' });
      if (!ok) return;
      try {
        await post(`/admin/workspaces/${w.organization_id}/card-check`, { action: 'waive' });
      } catch (err) { toast(err.message, 'error'); return; }
      toast('Card check skipped. The trial has started.');
      modal.close();
      await rerender();
      const hd = document.querySelector('#main h1'); // the row is gone from the list, so focus the page heading
      if (hd) { hd.setAttribute('tabindex', '-1'); hd.focus(); }
    };
    const scheduled = w.admin_status === 'deleting' && w.deletion_scheduled_at;
    const canDelete = !w.is_demo && w.organization_id !== state.user.organization_id; // the server also refuses (409) and its message is shown
    const focusHeading = () => {
      const hd = document.querySelector('#main h1');
      if (hd) { hd.setAttribute('tabindex', '-1'); hd.focus(); }
    };
    // Redraw the list, then reopen this workspace's panel with its new state and focus its Delete workspace heading.
    const reopen = async () => {
      modal.close();
      await rerender();
      let fresh = null;
      try { fresh = (await get(`/admin/workspaces${qs(apiFilters(filters))}`)).workspaces.find((x) => x.organization_id === w.organization_id); } catch { /* the list is already redrawn */ }
      if (!fresh) return;
      edit(fresh);
      const hd = document.getElementById('delete-ws-title');
      if (hd) { hd.setAttribute('tabindex', '-1'); hd.focus(); }
    };
    const delErr = h('div', { class: 'alert alert--error', role: 'alert', tabindex: '-1', hidden: true });
    const nameErr = h('div', { class: 'error', id: 'delete-name-err', role: 'alert' });
    const nameBox = h('input', { class: 'input', id: 'delete-confirm-name', name: 'confirm_name', type: 'text', autocomplete: 'off', 'aria-describedby': 'delete-name-err' });
    const delBtns = [];
    const sync = () => { for (const b of delBtns) b.disabled = !nameMatches(nameBox.value, w.name); };
    nameBox.addEventListener('input', () => { nameErr.textContent = ''; nameBox.removeAttribute('aria-invalid'); sync(); });
    const runDelete = async (mode) => {
      delErr.hidden = true; nameErr.textContent = '';
      for (const b of delBtns) b.disabled = true;
      try {
        const r = await post(`/admin/workspaces/${w.organization_id}/delete`, { mode, confirm_name: nameBox.value });
        if (mode === 'now') {
          toast(`${w.name} was deleted.`);
          modal.close();
          await rerender();
          focusHeading();
        } else {
          toast(`Deletion scheduled for ${fmtDate(r.deletion_scheduled_at)}.`);
          await reopen();
        }
      } catch (err) {
        sync();
        if (err.fields?.confirm_name) { nameErr.textContent = err.fields.confirm_name; nameBox.setAttribute('aria-invalid', 'true'); }
        delErr.textContent = err.message; delErr.hidden = false; delErr.focus();
      }
    };
    const cancelDeletion = async () => {
      delErr.hidden = true;
      try { await post(`/admin/workspaces/${w.organization_id}/restore`, {}); } catch (err) { delErr.textContent = err.message; delErr.hidden = false; delErr.focus(); return; }
      toast('Deletion cancelled.');
      await reopen();
    };
    const delBtn = (mode, label, cls) => { const b = h('button', { type: 'button', class: `btn ${cls}`, disabled: true, onclick: () => runDelete(mode) }, label); delBtns.push(b); return b; };
    const dangerZone = canDelete ? h('section', { class: 'form admin-danger', 'aria-labelledby': 'delete-ws-title' },
      h('h3', { id: 'delete-ws-title' }, 'Delete workspace'),
      scheduled && h('p', { class: 'alert alert--warn' }, `Scheduled for deletion on ${fmtDate(w.deletion_scheduled_at)}.`),
      scheduled && h('button', { type: 'button', class: 'btn btn--secondary', id: 'cancel-deletion', onclick: cancelDeletion }, 'Cancel deletion'),
      h('div', { class: 'field', 'data-field': '' },
        h('label', { for: 'delete-confirm-name' }, `Type ${w.name} to confirm`), nameBox, nameErr),
      delErr,
      !scheduled && h('div', { class: 'field' }, h('p', { class: 'muted small' }, DELETE_LATER), delBtn('schedule', 'Delete in 14 days', 'btn--danger')),
      h('div', { class: 'field' }, h('p', { class: 'muted small' }, DELETE_NOW), delBtn('now', 'Delete now', 'btn--danger'))) : null;
    const form = makeForm({
      submitText: 'Save',
      cancel: () => modal.close(),
      fields: [
        h('p', { class: 'muted small' }, `${w.owner_name || '—'} · ${w.owner_email || '—'} · ${w.unit_count} units · ${w.member_count} members`),
        ...(w.card_check === 'required' ? [h('div', { class: 'field' },
          h('p', { class: 'muted small' }, 'Waiting for the owner to save a card. The trial has not started.'),
          h('button', { type: 'button', class: 'btn btn--secondary', id: 'skip-card-check', onclick: skipCard }, 'Skip card check'))] : []),
        field({ name: 'plan', label: 'Plan', type: 'select', required: true, value: w.plan, placeholderOption: false,
          options: plans.map((p) => [p.key, `${p.name}${p.price ? ` — ₱${p.price}/mo` : ''} (${p.listings >= 1000 ? 'unlimited' : `${p.listings} listings`})`]) }),
        field({ name: 'paid_until', label: 'Paid until (paid plans)', type: 'date', value: paidUntil,
          hint: 'Last day covered by the payment. The workspace becomes view-only 7 days after this date.' }),
        field({ name: 'trial_ends_at', label: 'Trial ends (trial plan)', type: 'date', value: trialDay }),
        field({ name: 'plan_note', label: 'Note', type: 'textarea', value: w.plan_note, maxlength: 1000, placeholder: 'e.g. GCash ref 1234567, paid Oct–Dec' }),
      ],
      onSubmit: async (d) => {
        // Warn only when this save sets a past date (Manila day); an unchanged old date is not asked about again.
        if (d.paid_until && d.paid_until !== paidUntil && d.paid_until < todayManila()) {
          const ok = await confirmDialog({ title: 'Paid until is in the past', text: 'This date is in the past; the workspace may become view-only. Save anyway?', confirmText: 'Save anyway' });
          if (!ok) return;
        }
        await patch(`/admin/workspaces/${w.organization_id}`, {
          plan: d.plan, paid_until: d.paid_until || null, plan_note: d.plan_note || null, ...(d.trial_ends_at && d.trial_ends_at !== trialDay ? { trial_ends_at: d.trial_ends_at } : {}),
        });
        toast('Workspace updated.');
        rerender();
        modal.close();
      },
    });
    modal = openModal({ title: `${w.name}`, body: dangerZone ? h('div', null, form, dangerZone) : form });
  };

  const tbody = h('tbody');
  const count = h('p', { class: 'muted small' });
  const draw = ({ workspaces, total }) => {
    const filtered = Object.keys(changed(filters, defaults)).some((k) => k !== 'sort');
    count.textContent = filtered ? `Showing ${workspaces.length} of ${total} workspaces` : `${total} workspace${total === 1 ? '' : 's'}`;
    if (!workspaces.length) {
      tbody.replaceChildren(h('tr', null, h('td', { colspan: 8 }, emptyState({ title: 'No results found', text: 'No workspace matches these filters. Try removing a filter.' }))));
      return;
    }
    tbody.replaceChildren(...workspaces.map((w) => h('tr', { class: w.is_demo ? '' : 'row-link', onclick: () => { if (!w.is_demo) edit(w); } },
      h('td', null,
        // A real button, so Enter and Space work too: the key press sends the same click up to the row.
        w.is_demo ? h('strong', null, w.name) : h('button', { type: 'button', class: 'link-btn', 'aria-haspopup': 'dialog' }, w.name),
        h('div', { class: 'muted small' }, w.owner_email || '—')),
      h('td', null, statusBadge(w), h('div', { class: 'muted small' }, BUSINESS[w.business_type] || '')),
      h('td', null, cardText(w)),
      h('td', null, w.paid_until ? fmtDate(w.paid_until) : '—'),
      h('td', { class: 'num' }, String(w.unit_count)),
      h('td', null, fmtDate(w.created_at)),
      h('td', null, w.last_active_at ? fmtDateTime(w.last_active_at) : '—'),
      h('td', { class: 'small muted' }, w.plan_note || ''))));
  };
  draw(first);
  async function load() {
    history.replaceState(null, '', `#/admin${qs(changed(filters, defaults))}`);
    try { draw(await get(`/admin/workspaces${qs(apiFilters(filters))}`)); } catch (err) { toast(err.message, 'error'); }
  }
  const bar = filterBar({
    key: 'admin-workspaces', values: filters, defaults, onChange: load,
    search: { placeholder: 'Search workspace, owner name or email' },
    quick: [
      { name: 'status', label: 'Status', all: 'All statuses', options: [['trial', 'On trial'], ['card_pending', 'Waiting for card'], ['paying', 'Paying'], ['grace', 'Grace period'], ['trial_ended', 'Trial ended'], ['overdue', 'Payment overdue'], ['comped', 'Complimentary'], ['deleting', 'Scheduled for deletion'], ['demo', 'Demo']] },
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
      h('div', { class: 'page-head__actions' }, h('a', { class: 'btn btn--secondary', href: '#/admin/coupons' }, 'Plan coupons'), h('a', { class: 'btn btn--primary', href: '#/admin/support' }, 'Support queue'))),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'On trial'), h('div', { class: 'stat__value' }, String(counts.trial))),
      h('div', { class: 'stat stat--good' }, h('div', { class: 'stat__label' }, 'Paying'), h('div', { class: 'stat__value' }, String(counts.paying))),
      h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, 'Monthly revenue'), h('div', { class: 'stat__value' }, `₱${mrr.toLocaleString('en-PH')}`)),
      h('div', { class: 'stat stat--alert' }, h('div', { class: 'stat__label' }, 'Ended / overdue'), h('div', { class: 'stat__value' }, String(counts.lapsed)))),
    h('div', { style: { marginTop: '16px' } }, bar), count,
    h('div', { class: 'card card--flush' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, ['Workspace', 'Plan', 'Card', 'Paid until', 'Units', 'Created', 'Last active', 'Note'].map((t, i) => h('th', { class: i === 4 ? 'num' : null }, t)))),
      tbody))));
}
