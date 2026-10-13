// Settings: account, team access (owner), audit history and privacy.

import { get, post, patch, ApiError } from '../api.js';
import { h, icon, label, field, formModal, confirmDialog, emptyState, pageHead, toast, fmtDateTime, openModal } from '../ui.js';
import { state, refreshUser } from '../app.js';
import { notificationsCard } from '../notifications.js';
import { themeSwitch } from '../themeswitch.js';

function propertyChecks(properties, selected = []) {
  return h('fieldset', { class: 'field', dataset: { field: 'property_ids' }, style: { border: 0, padding: 0, margin: 0 } },
    h('legend', null, 'Properties they can access'),
    properties.length ? h('div', { class: 'checks' }, properties.map((p) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', name: 'property_ids', value: p.property_id, checked: selected.includes(p.property_id), dataset: { multi: '1' } }),
      h('span', null, p.property_name))))
      : h('p', { class: 'muted small' }, 'Add properties first, then assign them here.'),
    h('div', { class: 'error', role: 'alert' }));
}

// What each role can do, worded for the kind of rentals the workspace has.
export const ROLE_TEXT = {
  short_term: {
    manager: 'Co-host for assigned buildings: reservations, guests, inbox, calendar and prices, cleaning, payments and deposits.',
    staff: 'Cleaners and front desk: see stays and cleaning tasks for assigned buildings, check guests in and out, record payments and deposits. No guest phone numbers or emails, no inbox or reports.',
  },
  long_term: {
    manager: 'Manages assigned properties: tenants, leases, rent, expenses, repairs and reports.',
    staff: 'Records payments, expenses and repair requests for assigned properties. No access to tenant contact details or lease documents.',
  },
};
let ROLE_HELP = ROLE_TEXT.short_term;
const CLEANER_HINT = 'Cleaner: sees cleaning jobs only, no money or guest details. Needs at least one property.';
const roleOptions = (u) => [['manager', 'Property manager'], ['staff', 'Staff (cleaner, front desk, accountant)'], ...(u.business_type === 'long_term' ? [] : [['cleaner', 'Cleaner — sees cleaning jobs only, no money or guest details']])];
const roleName = (r) => (r === 'cleaner' ? 'Cleaner' : label(r));
const needProperty = (data) => { if (data.role === 'cleaner' && !(data.property_ids || []).length) throw new ApiError('Pick at least one property for a cleaner.', { status: 400 }); };

export async function settingsView(el, { rerender, query = {} }) {
  // Back from PayMongo checkout: confirm the payment with the server.
  if (query.billing) {
    history.replaceState(null, '', '#/settings');
    try {
      const r = await post(`/billing/${encodeURIComponent(query.billing)}/refresh`);
      if (r.status === 'paid') { await refreshUser(); toast('Payment received. Thank you! Your plan is active.'); }
      else toast('We are still waiting for the payment confirmation. This page updates within a few minutes.');
    } catch (err) { toast(err.message, 'error'); }
  } else if (query.billing_cancelled) {
    history.replaceState(null, '', '#/settings');
    toast('Payment cancelled. Nothing was charged.');
  }
  const u = state.user;
  ROLE_HELP = u.business_type === 'long_term' ? ROLE_TEXT.long_term : u.business_type === 'both'
    ? { manager: `${ROLE_TEXT.short_term.manager} For long-term rentals: tenants, leases and rent.`, staff: ROLE_TEXT.short_term.staff } : ROLE_TEXT.short_term;
  const sections = [];

  sections.push(h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Your account')),
    h('dl', { class: 'dl' },
      h('dt', null, 'Name'), h('dd', null, u.full_name),
      h('dt', null, 'Email'), h('dd', null, u.email),
      h('dt', null, 'Workspace'), h('dd', null, u.organization_name),
      h('dt', null, 'Role'), h('dd', null, roleName(u.role))),
    h('div', { class: 'chips', style: { marginTop: '12px' } }, h('a', { class: 'btn btn--secondary btn--sm', href: '#/account' }, 'My account'), h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: changePassword }, 'Change password')),
    u.role === 'owner' && h('div', { class: 'form', style: { marginTop: '14px' } },
      field({ name: 'business_type', label: 'Modules for this workspace', type: 'select', value: u.business_type, placeholderOption: false, options: [
        ['short_term', 'Short-term stays (Airbnb, staycations)'], ['long_term', 'Long-term rentals (leases, monthly rent)'], ['both', 'Both'],
      ] }),
      h('div', null, h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: async (e) => {
        const v = e.target.closest('.form').querySelector('select').value;
        await patch('/workspace', { business_type: v });
        await refreshUser();
        toast('Workspace updated.');
        rerender();
      } }, 'Save')))));

  if (u.role === 'owner' && u.business_type !== 'long_term') sections.push(guestLanguageCard(u, rerender));
  sections.push(h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Appearance')),
    h('p', { class: 'muted small' }, 'Light, dark, or match your phone or computer. Saved on this device.'),
    themeSwitch()));
  if (!u.plan?.is_demo) sections.push(await notificationsCard(rerender).catch(() => null));
  if (u.role === 'owner' && u.plan && !u.plan.is_demo) sections.push(await planCard(u));
  if (u.role === 'owner' && u.plan && !u.plan.is_demo && u.business_type !== 'long_term') sections.push(await bookingCard(rerender));
  if (u.role === 'owner' && u.plan && !u.plan.is_demo && u.business_type !== 'long_term') sections.push(await guestExperienceCard());
  if (u.role === 'owner' && u.plan && !u.plan.is_demo && u.business_type !== 'long_term') sections.push(await manualPaymentsCard(rerender));
  if (u.role === 'owner' && u.plan && !u.plan.is_demo) sections.push(dataCard(u, rerender));

  if (u.role === 'owner') {
    const [{ members, invitations }, { properties }] = await Promise.all([get('/team'), get('/properties')]);
    const propName = (id) => properties.find((p) => p.property_id === id)?.property_name || 'Archived property';

    const invite = () => formModal({
      title: 'Invite a team member',
      submitText: 'Create invitation',
      fields: [
        field({ name: 'email', label: 'Their email', type: 'email', required: true }),
        field({ name: 'role', label: 'Role', type: 'select', required: true, value: 'manager', placeholderOption: false, options: roleOptions(u), hint: `Property manager: ${ROLE_HELP.manager} Staff: ${ROLE_HELP.staff}${u.business_type === 'long_term' ? '' : ` ${CLEANER_HINT}`}` }),
        propertyChecks(properties),
      ],
      onSubmit: async (data) => {
        needProperty(data);
        const res = await post('/team/invitations', { ...data, property_ids: data.property_ids || [] });
        // Re-render first (it clears open dialogs), then show the link so it stays open.
        await rerender();
        showInviteLink(res);
      },
    });

    const showInviteLink = (res) => {
      const input = h('input', { class: 'input', readonly: true, value: res.inviteLink });
      openModal({
        title: 'Invitation created',
        body: h('div', { class: 'form' },
          h('p', null, res.emailed ? `We emailed the invitation to ${res.invitation.email}. You can also share this link directly:` : `Send this link to ${res.invitation.email} (for example by email or Messenger). It works once and expires in 7 days.`),
          input,
          h('button', { class: 'btn btn--primary', type: 'button', onclick: async () => { input.select(); try { await navigator.clipboard.writeText(res.inviteLink); toast('Link copied.'); } catch { toast('Select the link and copy it.'); } } }, 'Copy link')),
      });
    };

    const editMember = (m) => formModal({
      title: `Access for ${m.full_name}`,
      submitText: 'Save access',
      fields: [
        field({ name: 'role', label: 'Role', type: 'select', value: m.role, placeholderOption: false, options: roleOptions(u), hint: u.business_type === 'long_term' ? null : CLEANER_HINT }),
        propertyChecks(properties, m.property_ids),
      ],
      onSubmit: async (data) => { needProperty(data); await patch(`/team/members/${m.user_id}`, { role: data.role, property_ids: data.property_ids || [] }); toast('Access updated.'); rerender(); },
    });

    const removeMember = async (m) => {
      if (!await confirmDialog({ title: `Remove ${m.full_name}?`, text: 'They are signed out immediately and can no longer open this workspace. Records they created are kept.', confirmText: 'Remove access', danger: true })) return;
      try { await post(`/team/members/${m.user_id}/remove`); toast('Access removed.'); rerender(); } catch (err) { toast(err.message, 'error'); }
    };

    sections.push(h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Team & permissions'), h('button', { class: 'btn btn--primary btn--sm', onclick: invite }, icon('plus'), 'Invite')),
      h('ul', { class: 'list' }, members.map((m) => h('li', null, h('div', { class: 'row' },
        h('div', { class: 'row__main' },
          h('span', { class: 'row__title' }, m.full_name, m.user_id === u.user_id ? ' (you)' : ''),
          h('span', { class: 'row__sub' }, `${m.email} · ${roleName(m.role)}`),
          m.role !== 'owner' && h('span', { class: 'row__sub' }, m.property_ids.length ? `Access: ${m.property_ids.map(propName).join(', ')}` : 'No properties assigned yet')),
        m.role !== 'owner' && h('div', { class: 'row__end' }, h('div', { class: 'chips' },
          h('button', { class: 'btn btn--secondary btn--sm', onclick: () => editMember(m) }, 'Edit access'),
          h('button', { class: 'btn btn--ghost btn--sm', onclick: () => removeMember(m) }, 'Remove'))))))),
      invitations.length > 0 && [h('h3', { style: { margin: '16px 0 6px' } }, 'Pending invitations'),
        h('ul', { class: 'list' }, invitations.map((i) => h('li', null, h('div', { class: 'row' },
          h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, i.email), h('span', { class: 'row__sub' }, `${roleName(i.role)} · expires ${fmtDateTime(i.expires_at)}`)),
          h('button', { class: 'btn btn--secondary btn--sm', onclick: async () => {
            // Links are stored hashed, so "copy" means issuing a fresh one (the old one stops working).
            try { const res = await post('/team/invitations', { email: i.email, role: i.role, property_ids: i.property_ids || [] }); await rerender(); showInviteLink(res); } catch (err) { toast(err.message, 'error'); }
          } }, 'New link'),
          h('button', { class: 'btn btn--ghost btn--sm', onclick: async () => { await post(`/team/invitations/${i.invitation_id}/revoke`); toast('Invitation revoked.'); rerender(); } }, 'Revoke')))))],
      h('p', { class: 'muted small', style: { marginTop: '12px' } }, `Property managers: ${ROLE_HELP.manager} Staff: ${ROLE_HELP.staff}`)));
  }

  if (u.role !== 'staff') {
    const { entries } = await get('/audit');
    sections.push(h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, u.role === 'owner' ? 'Audit history' : 'Your recent actions')),
      entries.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'Who'), h('th', null, 'Action'), h('th', null, 'Details'))),
        h('tbody', null, entries.slice(0, 100).map((a) => h('tr', null,
          h('td', null, fmtDateTime(a.created_at)),
          h('td', null, a.actor_name || '—'),
          h('td', null, a.action.replace(/[._]/g, ' ')),
          h('td', { class: 'small muted' }, summarize(a.details)))))))
        : emptyState({ title: 'No activity yet', text: 'Important changes to records and access are logged here.' })));
  }

  sections.push(h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Privacy')),
    h('p', null, u.business_type === 'long_term'
      ? 'BalayHub stores tenant and property records to help you manage your rentals. Collect only what you need. Owners can export a tenant’s data from their profile to answer access requests under the Data Privacy Act.'
      : 'BalayHub stores guest, booking and property records to help you run your stays. Collect only what you need: guest ID photos are deleted automatically after the stay, and the owner can export or delete the workspace data under the Data Privacy Act.'),
    h('p', { style: { marginTop: '10px' } }, h('a', { href: '#/privacy' }, 'Read the Privacy Notice'))));

  el.replaceChildren(pageHead({ title: 'Settings', sub: u.organization_name }), h('div', { class: 'stack' }, sections));
}

function summarize(details) {
  if (!details) return '';
  const parts = [];
  for (const [k, v] of Object.entries(details)) {
    if (v === null || typeof v === 'object') continue;
    parts.push(`${k.replace(/_/g, ' ')}: ${v}`);
  }
  if (details.reason) parts.push(`reason: ${details.reason}`);
  return [...new Set(parts)].join(' · ').slice(0, 160);
}

// ---------------------------------------------------------------- plan
async function planCard(u) {
  const p = u.plan;
  let pub = { plans: [], contact_email: '' };
  try { pub = await get('/public/plans'); } catch { /* ignore */ }
  let listings = [];
  try { ({ listings } = await get('/listings')); } catch { /* ignore */ }
  let bill = { online: false, options: [], history: [] };
  try { bill = await get('/billing'); } catch { /* ignore */ }
  const status = p.read_only
    ? h('div', { class: 'alert alert--error' }, p.reason === 'trial_ended' ? 'Your free trial has ended. Your workspace is view-only until you choose a plan.' : 'Your payment is overdue. Your workspace is view-only until you renew.')
    : p.plan === 'trial' ? h('div', { class: 'alert alert--info' }, `Free trial: ${p.trial_days_left} day${p.trial_days_left === 1 ? '' : 's'} left. All features are included.`)
      : p.reason === 'grace' ? h('div', { class: 'alert alert--warn' }, `Your plan was paid until ${p.paid_until}. Please renew within 7 days to avoid interruption.`) : null;
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Plan & billing'), h('span', { class: 'badge badge--paid' }, p.name)),
    status,
    h('dl', { class: 'dl', style: { marginTop: '12px' } },
      h('dt', null, 'Current plan'), h('dd', null, p.price ? `${p.name} — ₱${p.price.toLocaleString('en-PH')} / month` : p.name),
      h('dt', null, 'Listings'), h('dd', null, `${listings.length} of ${p.listing_limit >= 1000 ? 'unlimited' : p.listing_limit}`),
      p.paid_until && [h('dt', null, 'Paid until'), h('dd', null, p.paid_until)]),
    bill.online ? payOnline(p, bill) : [
      pub.plans.length > 0 && h('div', { class: 'plan-mini' }, pub.plans.map((x) => h('div', { class: `plan-mini__item${x.key === p.plan ? ' is-current' : ''}` },
        h('strong', null, x.name), h('span', null, `₱${x.price.toLocaleString('en-PH')}/mo`), h('span', { class: 'muted small' }, `Up to ${x.listings} listings${x.ai ? ' · AI drafts' : ''}`)))),
      h('p', { class: 'small', style: { marginTop: '12px' } },
        'To choose or renew a plan, pay by GCash, Maya or bank transfer and ',
        pub.contact_email ? h('a', { href: `mailto:${pub.contact_email}?subject=${encodeURIComponent(`BalayHub plan for ${u.organization_name}`)}` }, `email us at ${pub.contact_email}`) : 'contact us',
        ' with your workspace name. We activate it the same day.')],
    bill.history.length > 0 && [
      h('h3', { class: 'subhead', style: { marginTop: '18px' } }, 'Payments'),
      h('ul', { class: 'list' }, bill.history.map((b) => h('li', null, h('div', { class: 'row' },
        h('div', { class: 'row__main' },
          h('span', { class: 'row__title' }, `${b.plan[0].toUpperCase()}${b.plan.slice(1)} · ${b.months} month${b.months > 1 ? 's' : ''}`),
          h('span', { class: 'row__sub' }, b.status === 'paid' ? `Paid ${fmtDateTime(b.paid_at)}${b.payment_method ? ` · ${b.payment_method}` : ''} · covers ${b.period_start} to ${b.period_end}` : `Started ${fmtDateTime(b.created_at)}, waiting for payment`)),
        h('div', { class: 'row__end' }, h('strong', null, `₱${Number(b.amount).toLocaleString('en-PH')}`),
          h('span', { class: `badge badge--${b.status === 'paid' ? 'paid' : 'unpaid'}` }, b.status === 'paid' ? 'Paid' : 'Pending'))))))]);
}

// Choose a plan and length, then pay on PayMongo's secure page.
function payOnline(p, bill) {
  const current = bill.options.some((o) => o.key === p.plan) ? p.plan : 'growth';
  let plan = current;
  let months = 1;
  const amountEl = h('strong');
  const btn = h('button', { class: 'btn btn--primary', type: 'button' }, 'Pay now');
  const cards = h('div', { class: 'plan-mini' });
  const drawCards = () => cards.replaceChildren(...bill.options.map((o) => h('button', {
    type: 'button', class: `plan-mini__item plan-mini__pick${o.key === plan ? ' is-current' : ''}`, 'aria-pressed': String(o.key === plan),
    onclick: () => { plan = o.key; drawCards(); update(); },
  }, h('strong', null, o.name), h('span', null, `₱${o.prices[0].amount.toLocaleString('en-PH')}/mo`),
  h('span', { class: 'muted small' }, `Up to ${o.listings} listings${o.ai ? ' · AI drafts' : ''}`))));
  const monthSel = h('select', { class: 'input input--sm', 'aria-label': 'Months', onchange: (e) => { months = Number(e.target.value); update(); } },
    [[1, '1 month'], [3, '3 months'], [12, '12 months (2 months free)']].map(([m, t]) => h('option', { value: m }, t)));
  const update = () => {
    const o = bill.options.find((x) => x.key === plan);
    amountEl.textContent = `₱${o.prices.find((x) => x.months === months).amount.toLocaleString('en-PH')}`;
  };
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Opening secure checkout…';
    try {
      const r = await post('/billing/checkout', { plan, months: String(months) });
      location.href = r.checkout_url;
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Pay now';
    }
  });
  drawCards();
  update();
  return h('div', { class: 'payonline' },
    h('h3', { class: 'subhead', style: { marginTop: '16px' } }, p.plan === 'trial' || p.read_only ? 'Choose your plan' : 'Renew or change plan'),
    cards,
    h('div', { class: 'payonline__row' }, monthSel, h('span', null, 'Total: ', amountEl), btn),
    h('p', { class: 'muted small' }, 'Pay securely with GCash, Maya, card or GrabPay through PayMongo. Your plan activates as soon as the payment goes through. Renewing the same plan early adds the time on top; switching plans converts your unused days to the new plan; paying during the free trial keeps your remaining trial days.'));
}


// ---------------------------------------------------------------- password
// ---------------------------------------------------------------- guest language
function guestLanguageCard(u, rerender) {
  const lang = h('select', { class: 'input', 'aria-label': 'Language for guests' },
    h('option', { value: 'en', selected: u.guest_language !== 'tl' }, 'English'),
    h('option', { value: 'tl', selected: u.guest_language === 'tl' }, 'Taglish (Tagalog + English)'));
  const alsoMessages = h('input', { type: 'checkbox', checked: true });
  const save = async () => {
    try {
      await patch('/workspace', { guest_language: lang.value });
      let note = '';
      if (alsoMessages.checked) {
        const r = await post('/message-templates/language', { language: lang.value });
        if (r.copied) note = ` Your own wording was kept as ${r.copied} extra template${r.copied > 1 ? 's' : ''} ("my version").`;
      }
      await refreshUser();
      toast(`Guest language saved.${note}`);
      rerender();
    } catch (err) { toast(err.message, 'error'); }
  };
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Language for guests')),
    h('p', { class: 'muted small' }, 'Used on your booking page, payment page, guest check-in form and review page. Guests can switch between English and Tagalog themselves.'),
    h('div', { class: 'form' },
      h('div', { class: 'field' }, h('label', null, 'Default language'), lang),
      h('label', { class: 'check' }, alsoMessages, h('span', null, 'Also switch my booking confirmation, check-in, thank-you and payment reminder messages')),
      h('div', null, h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: save }, 'Save'))));
}

export function changePassword() {
  formModal({
    title: 'Change password',
    submitText: 'Change password',
    fields: [
      field({ name: 'current_password', label: 'Current password', type: 'password', required: true, autocomplete: 'current-password' }),
      field({ name: 'new_password', label: 'New password', type: 'password', required: true, autocomplete: 'new-password', hint: 'At least 8 characters.' }),
      field({ name: 'confirm_password', label: 'Confirm new password', type: 'password', required: true, autocomplete: 'new-password' }),
    ],
    onSubmit: async (d) => {
      await post('/auth/change-password', d);
      toast('Password changed. Other devices were signed out.');
    },
  });
}

// ---------------------------------------------------------------- your data
function dataCard(u, rerender) {
  const del = () => formModal({
    title: 'Delete this workspace?',
    submitText: 'Delete workspace',
    fields: [
      h('div', { class: 'alert alert--error' },
        'This permanently deletes all listings, reservations, guests, messages, payments, files and team accounts in ',
        h('strong', null, u.organization_name), '. You have 14 days to change your mind; after that it cannot be undone. Download an export first if you want a copy.'),
      field({ name: 'confirm_name', label: `Type the workspace name to confirm: ${u.organization_name}`, required: true, autocomplete: 'off' }),
    ],
    onSubmit: async (d) => {
      await post('/workspace/delete', d);
      await refreshUser();
      toast('Deletion scheduled. You can cancel it within 14 days.');
      location.hash = '#/settings';
      rerender();
    },
  });
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Your data')),
    h('p', { class: 'small' }, 'Download everything in this workspace (listings, reservations, guests, messages, payments, expenses and more) as a file you can keep or move to another system. ID photos and uploaded files are listed but not included.'),
    h('div', { class: 'chips', style: { marginTop: '10px' } },
      h('a', { class: 'btn btn--secondary btn--sm', href: '/api/workspace/export', download: '' }, 'Download all data'),
      !u.plan?.deletion_scheduled_at && h('button', { class: 'btn btn--danger btn--sm', type: 'button', onclick: del }, 'Delete workspace')));
}

// ---------------------------------------------------------------- direct booking page
// Owners let guests pay by GCash, Maya or bank transfer and write the details they pay to.
async function manualPaymentsCard(rerender) {
  let m;
  try { m = await get('/workspace/manual-payments'); } catch { return null; }
  const enabled = h('input', { type: 'checkbox', checked: m.enabled });
  const details = h('textarea', {
    class: 'input', rows: 4, maxlength: 1000, value: m.instructions || '', 'aria-label': 'Payment details for guests',
    placeholder: 'e.g. GCash 0917 123 4567 (Maria Santos)\nBDO savings 0012 3456 7890 (Maria Santos)',
  });
  const save = async () => {
    try {
      await patch('/workspace/manual-payments', { enabled: enabled.checked, instructions: details.value });
      toast('Manual payments saved.');
      rerender();
    } catch (err) { toast(err.message, 'error'); }
  };
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Manual payments')),
    h('p', { class: 'muted small' }, 'Let guests pay by GCash, Maya or bank transfer. They send you a screenshot from their payment page; you check it and confirm it, which records the payment on the reservation. BalayHub does not check the money for you.'),
    h('div', { class: 'form' },
      h('label', { class: 'check' }, enabled, h('span', null, 'Accept manual payments on the payment page')),
      h('div', { class: 'field' }, h('label', null, 'Payment details guests should use'), details,
        h('div', { class: 'hint' }, 'Shown on the payment page, up to 1,000 characters. Add the GCash number, bank name and account name.')),
      h('div', null, h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: save }, 'Save'))));
}

async function bookingCard(rerender) {
  let b;
  try { b = await get('/direct-booking'); } catch { return null; }
  const listed = b.listings.filter((l) => l.bookable_online);
  const save = async (payload, msg) => {
    try { await patch('/direct-booking', payload); toast(msg); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  const connect = () => formModal({
    title: 'Connect your PayMongo account',
    submitText: 'Save key',
    fields: [
      h('p', { class: 'small' }, 'Guests pay you directly through your own PayMongo account (GCash, Maya, cards). In your PayMongo dashboard go to ',
        h('strong', null, 'Developers → API keys'), ' and copy the ', h('strong', null, 'Secret key'), '. Start with the test key (sk_test_…) to try it, then switch to the live key.'),
      field({ name: 'paymongo_secret_key', label: 'PayMongo secret key', type: 'password', required: true, autocomplete: 'off', placeholder: 'sk_live_…' }),
      h('p', { class: 'muted small' }, 'Stored encrypted and never shown again. Only used to create checkouts and check payments for your bookings.'),
    ],
    onSubmit: async (d) => { await patch('/direct-booking', { paymongo_secret_key: d.paymongo_secret_key }); toast('PayMongo connected.'); rerender(); },
  });
  const edit = () => formModal({
    title: 'Booking page settings',
    submitText: 'Save',
    fields: [
      field({ name: 'slug', label: 'Page address', value: b.slug, required: true, maxlength: 40, hint: `Your page: ${location.origin}/#/book/<this>. Letters, numbers and dashes.` }),
      field({ name: 'intro', label: 'Welcome text', type: 'textarea', value: b.intro, maxlength: 1500, placeholder: 'e.g. Book directly with us for the best rate!' }),
    ],
    onSubmit: async (d) => { await patch('/direct-booking', d); toast('Saved.'); rerender(); },
  });
  const copy = async () => { try { await navigator.clipboard.writeText(b.url); toast('Link copied. Share it on Facebook, Instagram or Messenger.'); } catch { window.prompt('Copy your booking link:', b.url); } };
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Direct booking page'),
      b.enabled ? h('span', { class: 'badge badge--paid' }, 'Live') : h('span', { class: 'badge badge--archived' }, 'Off')),
    h('p', { class: 'small' }, 'Let guests book and pay you directly, with no channel fees. Guests choose dates on your page and pay through your PayMongo account; the booking, confirmation, receipt and check-in form are created automatically, and your Airbnb and Booking.com calendars are updated through calendar sync.'),
    h('dl', { class: 'dl', style: { marginTop: '12px' } },
      h('dt', null, 'PayMongo'), h('dd', null, b.paymongo_connected ? `Connected (${b.paymongo_key_hint})` : 'Not connected'),
      h('dt', null, 'Listings on the page'), h('dd', null, listed.length ? `${listed.length} of ${b.listings.length}` : 'None yet: edit a listing and tick "Show this listing on my booking page"'),
      b.url && [h('dt', null, 'Your link'), h('dd', null, h('a', { href: b.url.slice(b.url.indexOf('#')), target: '_blank' }, b.url))]),
    b.test_mode && h('div', { class: 'alert alert--warn', style: { marginTop: '10px' } }, 'TEST MODE: you connected a PayMongo test key, so payments on your page are not real and guests see a test-mode notice. Switch to your live key (Change key) before sharing the link.'),
    listed.some((l) => !l.photo_count) && h('p', { class: 'muted small' }, 'Tip: add photos to every listing (Listings → Photos). Pages with photos get far more bookings.'),
    h('div', { class: 'chips', style: { marginTop: '12px' } },
      b.paymongo_connected
        ? (b.enabled
          ? h('button', { class: 'btn btn--secondary btn--sm', onclick: () => save({ enabled: false }, 'Booking page turned off.') }, 'Turn off')
          : h('button', { class: 'btn btn--primary btn--sm', onclick: () => save({ enabled: true }, 'Your booking page is live!') }, 'Turn on'))
        : h('button', { class: 'btn btn--primary btn--sm', onclick: connect }, 'Connect PayMongo'),
      b.enabled && b.url && h('button', { class: 'btn btn--secondary btn--sm', onclick: copy }, 'Copy link'),
      h('button', { class: 'btn btn--ghost btn--sm', onclick: edit }, 'Page settings'),
      b.paymongo_connected && h('button', { class: 'btn btn--ghost btn--sm', onclick: connect }, 'Change key')));
}

// Guest experience: public review links, returning-guest discount, abandoned-booking follow-up.
async function guestExperienceCard() {
  let g;
  try { g = await get('/workspace/guest-settings'); } catch { return null; }
  const links = g.review_links || [];
  const rows = Array.from({ length: 4 }, (_, i) => ({
    label: h('input', { class: 'input', maxlength: 40, value: links[i]?.label || '', 'aria-label': `Review link ${i + 1} name`, placeholder: i ? 'Name' : 'Google' }),
    url: h('input', { class: 'input', type: 'url', maxlength: 300, value: links[i]?.url || '', 'aria-label': `Review link ${i + 1} address`, placeholder: 'https://…' }),
  }));
  const pct = h('input', { class: 'input', type: 'number', min: 1, max: 50, inputmode: 'numeric', value: g.returning_guest_pct ?? '', id: 'gx-pct', 'aria-describedby': 'gx-pct-hint' });
  const followup = h('input', { type: 'checkbox', checked: Boolean(g.abandoned_followup) });
  const err = h('div', { class: 'error', role: 'alert' });
  const save = async (e) => {
    err.textContent = '';
    const review_links = rows.map((r) => ({ label: r.label.value.trim(), url: r.url.value.trim() })).filter((r) => r.label || r.url);
    if (review_links.some((r) => !r.label || !/^https:\/\//i.test(r.url))) { err.textContent = 'Each review link needs a name and an address starting with https://'; return; }
    e.target.disabled = true;
    try {
      await patch('/workspace/guest-settings', { review_links, returning_guest_pct: pct.value.trim() === '' ? null : Number(pct.value), abandoned_followup: followup.checked });
      toast('Guest experience saved.');
    } catch (ex) { err.textContent = ex.fields ? Object.values(ex.fields).join(' ') : ex.message; }
    e.target.disabled = false;
  };
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Guest experience')),
    h('div', { class: 'form' },
      h('fieldset', { class: 'hp-fieldset' }, h('legend', null, 'Public review links'),
        h('p', { class: 'muted small' }, 'Guests who rate 4 or 5 stars are invited to share on these pages (up to 4). Lower ratings stay private.'),
        rows.map((r) => h('div', { class: 'form-row form-row--2' }, r.label, r.url))),
      h('div', { class: 'field' }, h('label', { for: 'gx-pct' }, 'Returning-guest discount (%)'), pct,
        h('div', { class: 'hint', id: 'gx-pct-hint' }, 'From 1 to 50. Each guest who has checked out gets one personal code. Leave blank to turn off.')),
      h('label', { class: 'check' }, followup, h('span', null, 'Send one follow-up email when someone starts a direct booking but does not pay')),
      err,
      h('div', null, h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: save }, 'Save'))));
}
