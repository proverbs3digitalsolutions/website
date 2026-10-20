// Settings: account, team access (owner), audit history and privacy.

import { api, get, post, patch, ApiError } from '../api.js';
import { h, icon, label, field, formModal, confirmDialog, emptyState, pageHead, toast, peso, fmtDate, fmtMonth, fmtDateTime, openModal, clearErrors, showErrors } from '../ui.js';
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
const roleOptions = (u) => [['manager', 'Property manager'], ['staff', u.business_type === 'long_term' ? 'Staff (bookkeeping, caretaker)' : 'Staff (cleaner, front desk, accountant)'], ...(u.business_type === 'long_term' ? [] : [['cleaner', 'Cleaner — sees cleaning jobs only, no money or guest details']])];
const roleName = (r) => (r === 'cleaner' ? 'Cleaner' : label(r));
// Managers and cleaners need at least one property, the same rule the server applies.
const propertyProblem = (data) => (['manager', 'cleaner'].includes(data.role) && !(data.property_ids || []).length ? `Pick at least one property for a ${data.role}.` : '');
export const needProperty = (data) => { const msg = propertyProblem(data); if (msg) throw new ApiError(msg, { status: 400 }); };
// Same email test as the server (src/lib/validate.js). The invite checks the email first, then the property, the
// server's order, and returns every problem at once so each field can say what is wrong.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const inviteProblems = (data) => {
  const fields = {};
  const email = String(data.email ?? '');
  if (email.length > 254 || !EMAIL_RE.test(email)) fields.email = 'Enter a valid email address.';
  const property = propertyProblem(data);
  if (property) fields.property_ids = property;
  return fields;
};

// The pay picker starts on the plan chosen under "Plan after your trial", else the current paid plan, else Growth.
// The sentence shown while a payment waits at the bank (GET /billing pending_payment); money is the file's peso formatter.
export const pendingText = (pp, money) => (pp.minutes_left > 0
  ? `A payment of ${money(pp.amount)} is waiting for your bank. Finish it in the bank window, or try again in ${pp.minutes_left} minutes.`
  : `A payment of ${money(pp.amount)} is still waiting for your bank. Pay another way, or try again later.`);

export const payDefaultPlan = (p, bill) => [bill.renewal_plan, p.plan, 'growth'].find((k) => k && bill.options.some((o) => o.key === k));

// The router attaches the page after the view returns, so focus() on a detached node does nothing: focus once it is attached.
async function focusWhenAttached(el, node) {
  node.focus();
  for (const t = Date.now(); el.isConnected === false && Date.now() - t < 10000;) await new Promise((ok) => setTimeout(ok, 50));
  if (el.isConnected !== false) node.focus();
}

// Set when a Pay press found the plan already paid elsewhere (PAYMENT_RECEIVED); the redrawn page shows it and takes focus.
let carriedNotice = null;
// PAYMENT_IN_PROGRESS carries the server's "try again" sentence too, but the redrawn page shows the waiting view instead when one is pending.
let carriedUnlessWaiting = false;
let billWaiting = false; // set by planCard: the loaded billing has a payment waiting at the bank

export async function settingsView(el, { rerender, query = {} }) {
  let billingNotice = null;
  let carriedEl = null;
  const unlessWaiting = carriedUnlessWaiting; carriedUnlessWaiting = false;
  if (carriedNotice) { billingNotice = h('div', { class: 'alert alert--error', role: 'alert', tabindex: '-1' }, carriedNotice); carriedEl = billingNotice; carriedNotice = null; }
  // Back from PayMongo checkout: confirm the payment with the server.
  if (query.billing) {
    history.replaceState(null, '', '#/settings');
    try {
      const r = await post(`/billing/${encodeURIComponent(query.billing)}/refresh`);
      if (r.status === 'paid') { await refreshUser(); billingNotice = h('div', { class: 'alert', role: 'status', tabindex: '-1' }, 'Payment received. Thank you! Your plan is active.'); }
      else if (r.status === 'failed') billingNotice = h('div', { class: 'alert alert--error', role: 'alert', tabindex: '-1' }, "Your saved card couldn't be charged. Pay another way, or use a different card.");
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
        ['short_term', 'Short-term stays'], ['long_term', 'Long-term rentals'], ['both', 'Both'],
      ], hint: 'Short-term means per-night stays (Airbnb, staycations). Long-term means monthly tenants and leases.' }),
      h('div', null, h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'aria-label': 'Save modules for this workspace', onclick: async (e) => {
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
  if (u.role === 'owner' && u.plan && !u.plan.is_demo) sections.push(await planCard(u, rerender));
  if (u.role === 'owner' && u.plan && !u.plan.is_demo && u.business_type !== 'long_term') sections.push(await bookingCard(rerender));
  if (u.role === 'owner' && u.plan && !u.plan.is_demo && u.business_type !== 'long_term') sections.push(await guestExperienceCard());
  if (u.role === 'owner' && u.plan && !u.plan.is_demo && u.business_type !== 'long_term') sections.push(await manualPaymentsCard(rerender));
  if (u.role === 'owner' && u.plan && !u.plan.is_demo) sections.push(dataCard(u, rerender));

  let invite = null;
  if (u.role === 'owner') {
    const [{ members, invitations }, { properties }] = await Promise.all([get('/team'), get('/properties')]);
    const propName = (id) => properties.find((p) => p.property_id === id)?.property_name || 'Archived property';

    invite = () => formModal({
      title: 'Invite a team member',
      submitText: 'Create invitation',
      fields: [
        field({ name: 'email', label: 'Their email', type: 'email', required: true }),
        field({ name: 'role', label: 'Role', type: 'select', required: true, value: 'manager', placeholderOption: false, options: roleOptions(u), hint: `Property manager: ${ROLE_HELP.manager} Staff: ${ROLE_HELP.staff}${u.business_type === 'long_term' ? '' : ` ${CLEANER_HINT}`}` }),
        propertyChecks(properties),
      ],
      onSubmit: async (data) => {
        const problems = inviteProblems(data);
        if (Object.keys(problems).length) throw new ApiError('Please check the highlighted fields.', { status: 400, fields: problems });
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
          h('button', { class: 'btn btn--secondary btn--sm', 'aria-label': `Edit access for ${m.full_name}`, onclick: () => editMember(m) }, 'Edit access'),
          h('button', { class: 'btn btn--ghost btn--sm', 'aria-label': `Remove ${m.full_name}`, onclick: () => removeMember(m) }, 'Remove'))))))),
      invitations.length > 0 && [h('h3', { style: { margin: '16px 0 6px' } }, 'Pending invitations'),
        h('ul', { class: 'list' }, invitations.map((i) => h('li', null, h('div', { class: 'row' },
          h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, i.email), h('span', { class: 'row__sub' }, `${roleName(i.role)} · expires ${fmtDateTime(i.expires_at)}`)),
          h('button', { class: 'btn btn--secondary btn--sm', 'aria-label': `New link for ${i.email}`, onclick: async () => {
            // Links are stored hashed, so "copy" means issuing a fresh one (the old one stops working).
            try { const res = await post('/team/invitations', { email: i.email, role: i.role, property_ids: i.property_ids || [] }); await rerender(); showInviteLink(res); } catch (err) { toast(err.message, 'error'); }
          } }, 'New link'),
          h('button', { class: 'btn btn--ghost btn--sm', 'aria-label': `Revoke invitation for ${i.email}`, onclick: async () => { await post(`/team/invitations/${i.invitation_id}/revoke`); toast('Invitation revoked.'); rerender(); } }, 'Revoke')))))],
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
          h('td', null, actionText(a.action)),
          h('td', { class: 'small muted' }, summarize(a.details, a.action)))))))
        : emptyState({ title: 'No activity yet', text: 'Important changes to records and access are logged here.' })));
  }

  sections.push(h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Privacy')),
    h('p', null, u.business_type === 'long_term'
      ? 'BalayHub stores tenant and property records to help you manage your rentals. Collect only what you need. Owners can export a tenant’s data from their profile to answer access requests under the Data Privacy Act.'
      : 'BalayHub stores guest, booking and property records to help you run your stays. Collect only what you need: guest ID photos are deleted automatically after the stay, and the owner can export or delete the workspace data under the Data Privacy Act.'),
    h('p', { style: { marginTop: '10px' } }, h('a', { class: 'link-tap', href: '#/privacy' }, 'Read the Privacy Notice'))));

  if (unlessWaiting && billWaiting && billingNotice === carriedEl) billingNotice = null;
  el.replaceChildren(pageHead({ title: 'Settings', sub: u.organization_name }), h('div', { class: 'stack' }, billingNotice, sections));
  if (billingNotice) focusWhenAttached(el, billingNotice);
  // The top bar's "Invite a teammate" link (#/settings?invite=1) opens the dialog once the page is drawn.
  query.invite && invite && (delete query.invite, history.replaceState(null, '', '#/settings'), invite());
}

// Audit actions in plain words. My account shows the same labels (it imports actionText from here).
export const ACTIONS = {
  'auth.login': 'Signed in', 'auth.password_changed': 'Changed your password', 'auth.password_reset': 'Reset a password', 'auth.signed_out_others': 'Signed out your other devices',
  'user.profile_updated': 'Updated your profile', 'user.notify_prefs_updated': 'Changed notification settings',
  'reservation.created': 'Added a reservation', 'reservation.updated': 'Edited a reservation', 'reservation.cancelled': 'Cancelled a reservation',
  'reservation.confirmation_sent': 'Sent a booking confirmation', 'reservation.receipt_sent': 'Sent a receipt', 'reservation.payment_recorded': 'Recorded a guest payment',
  'reservation.payment_voided': 'Voided a guest payment', 'reservation.charge_added': 'Added a charge to a reservation', 'reservation.charge_voided': 'Removed a charge from a reservation',
  'reservation.refund_recorded': 'Recorded a refund', 'reservation.refund_voided': 'Voided a refund', 'booking_group.updated': 'Edited a booking group',
  'booking_group.created': 'Added a group booking', 'booking_group.room_added': 'Added a room to a group booking', 'booking_group.room_removed': 'Removed a room from a group booking', 'booking_group.cancelled': 'Cancelled a group booking',
  'reservation.check_in': 'Checked a guest in', 'reservation.undo_check_in': 'Undid a guest check-in', 'reservation.check_out': 'Checked a guest out', 'reservation.undo_check_out': 'Undid a guest check-out',
  'reservation.booked_online': 'Guest booked online', 'reservation.balance_paid_online': 'Guest paid the balance online',
  'deposit.received': 'Recorded a security deposit', 'deposit.settled': 'Returned or settled a deposit', 'deposit.reopened': 'Reopened a deposit',
  'damage.reported': 'Reported damage', 'damage.charged': 'Charged a guest for damage', 'damage.deducted': 'Deducted damage from a deposit', 'damage.waived': 'Waived a damage charge',
  'calendar.blocked': 'Blocked dates', 'calendar.unblocked': 'Unblocked dates', 'rates.updated': 'Changed nightly prices',
  'bulk.blocks': 'Blocked or unblocked dates in bulk', 'bulk.prices': 'Changed prices in bulk',
  'pricing_rule.created': 'Added a pricing rule', 'pricing_rule.updated': 'Edited a pricing rule', 'pricing_rule.removed': 'Removed a pricing rule',
  'season.created': 'Added a season price', 'season.removed': 'Removed a season price',
  'cleaning.task_created': 'Added a cleaning task', 'cleaning.task_updated': 'Edited a cleaning task', 'cleaning.checklist_updated': 'Edited the cleaning checklist', 'cleaning.inspected': 'Inspected a cleaning',
  'cleaning.task_todo': 'Set a cleaning task back to to-do', 'cleaning.task_in_progress': 'Started a cleaning task', 'cleaning.task_done': 'Finished a cleaning task', 'cleaning.task_cancelled': 'Cancelled a cleaning task',
  'cleaning.clean': 'Marked a listing clean', 'cleaning.dirty': 'Marked a listing dirty',
  'cleaner_rate.saved': 'Saved a cleaner rate', 'cleaner_rate.deleted': 'Removed a cleaner rate', 'cleaner_pay.paid': 'Marked a cleaner’s pay as paid', 'cleaner_pay.unpaid': 'Marked a cleaner’s pay as unpaid',
  'daily_close.saved': 'Saved a daily close', 'daily_close.reopened': 'Reopened a closed day',
  'guest.created': 'Added a guest', 'guest.updated': 'Updated a guest', 'checkin.link_replaced': 'Made a new check-in link',
  'file.uploaded': 'Uploaded a file', 'file.downloaded': 'Downloaded a file',
  'guide.link_shared': 'Shared a guest guide link', 'guide.updated': 'Edited the guest guide',
  'inbox.ai_draft': 'Used an AI reply draft', 'inbox.message_sent': 'Sent a message', 'inbox.message_scheduled': 'Scheduled a message',
  'inbox.message_cancelled': 'Cancelled a scheduled message', 'inbox.note_added': 'Added an internal note',
  'template.created': 'Added a message template', 'template.updated': 'Edited a message template', 'template.archived': 'Removed a message template',
  'template.language_switched': 'Switched message templates’ language',
  'automation.created': 'Added an automatic message', 'automation.updated': 'Edited an automatic message', 'automation.removed': 'Removed an automatic message',
  'ical.feed_added': 'Connected a channel calendar', 'ical.feed_removed': 'Disconnected a channel calendar', 'ical.export_rotated': 'Made a new calendar export link',
  'discount_code.created': 'Added a discount code', 'discount_code.enabled': 'Turned on a discount code', 'discount_code.disabled': 'Turned off a discount code',
  'direct_booking.settings_changed': 'Changed booking page settings', 'workspace.manual_payments_updated': 'Changed manual payment settings',
  'workspace.guest_settings_updated': 'Changed guest experience settings',
  'property.created': 'Added a property', 'property.updated': 'Edited a property', 'property.archived': 'Archived a property', 'property.restored': 'Restored a property',
  'property.gatepass_updated': 'Changed gate pass settings',
  'unit.created': 'Added a listing/unit', 'unit.updated': 'Edited a listing/unit', 'unit.archived': 'Archived a listing/unit', 'unit.restored': 'Restored a listing/unit',
  'unit_owner.created': 'Added a unit owner', 'unit_owner.updated': 'Edited a unit owner', 'unit_owner.archived': 'Archived a unit owner', 'unit_owner.statement_sent': 'Sent an owner statement',
  'unit_owner.statement_published': 'Published an owner statement', 'unit_owner.statement_unpublished': 'Unpublished an owner statement', 'owner_statements.reminder_sent': 'Sent an owner statement reminder',
  'owner_payout.recorded': 'Recorded an owner payout', 'owner_payout.voided': 'Voided an owner payout',
  'owner_reserve.withdrawal_recorded': 'Recorded an owner reserve withdrawal', 'owner_reserve.withdrawal_voided': 'Voided an owner reserve withdrawal',
  'owner_portal.invited': 'Invited an owner to the portal', 'owner_portal.disabled': 'Turned off the owner portal',
  'owner_portal.block_created': 'Blocked dates for an owner', 'owner_portal.block_cancelled': 'Cancelled an owner block',
  'tenant.created': 'Added a tenant', 'tenant.updated': 'Edited a tenant', 'tenant.archived': 'Archived a tenant', 'tenant.restored': 'Restored a tenant', 'tenant.exported': 'Exported a tenant’s data',
  'lease.created': 'Added a lease', 'lease.updated': 'Edited a lease', 'lease.cancelled': 'Cancelled a lease', 'lease.ended': 'Ended a lease', 'lease.terminated': 'Terminated a lease',
  'payment.recorded': 'Recorded a rent payment', 'payment.voided': 'Voided a rent payment',
  'expense.recorded': 'Added an expense', 'expense.corrected': 'Corrected an expense', 'expense.voided': 'Voided an expense',
  'maintenance.created': 'Logged a repair request', 'maintenance.updated': 'Edited a repair request', 'maintenance.scheduled': 'Scheduled a repair',
  'maintenance.status_changed': 'Changed a repair’s status', 'maintenance.schedule_created': 'Added a maintenance schedule',
  'maintenance.schedule_updated': 'Edited a maintenance schedule', 'maintenance.schedule_paused': 'Paused a maintenance schedule',
  'maintenance.schedule_resumed': 'Resumed a maintenance schedule',
  'lost_found.reported': 'Logged a lost item', 'lost_found.updated': 'Edited a lost item',
  'supply.created': 'Added a supply', 'supply.updated': 'Edited a supply', 'supply.movement': 'Recorded a supply movement', 'supply.archived': 'Archived a supply',
  'payment_proof.submitted': 'Received a payment screenshot', 'payment_proof.image_added': 'Added a payment screenshot', 'payment_proof.rejected': 'Rejected a payment screenshot',
  'payment_proof.withdrawn': 'Withdrew a payment proof',
  'quote.created': 'Created a quote', 'quote.sent': 'Sent a quote', 'quote.cancelled': 'Cancelled a quote',
  'addon.created': 'Added an add-on', 'addon.updated': 'Edited an add-on', 'addon.archived': 'Archived an add-on',
  'member.invited': 'Invited a team member', 'member.joined': 'Joined the workspace', 'member.updated': 'Changed a team member’s access',
  'member.removed': 'Removed a team member', 'member.invite_revoked': 'Cancelled an invitation', 'gatepass.sent': 'Sent a gate pass',
  'billing.checkout_started': 'Started a plan payment', 'billing.pay_saved_started': 'Started a payment with the saved card', 'billing.paid': 'Plan payment received', 'billing.card_check_started': 'Started the card check', 'billing.card_check_passed': 'Card check passed', 'billing.card_check_failed': 'Card check failed', 'billing.card_removed': 'Removed the saved card', 'billing.renewal_changed': 'Changed the renewal plan', 'billing.subscription_started': 'Automatic payment started', 'billing.subscription_cancelled': 'Automatic payment cancelled', 'billing.subscription_payment_failed': 'Automatic payment failed', 'billing.trial_reminder_sent': 'Trial reminder email sent', 'platform.card_check_waived': 'Skipped the card check', 'platform.workspace_deletion_scheduled': 'Workspace deletion scheduled by BalayHub', 'platform.workspace_deletion_cancelled': 'Workspace deletion cancelled by BalayHub', 'platform.workspace_deleted': 'Workspace deleted by BalayHub', 'billing.coupon_applied': 'Used a plan coupon', 'platform.coupon_created': 'Plan coupon created', 'platform.coupon_updated': 'Plan coupon changed', 'platform.coupon_switched_on': 'Plan coupon switched on', 'platform.coupon_switched_off': 'Plan coupon switched off', 'platform.plan_changed': 'Changed the workspace plan',
  'workspace.created': 'Created the workspace', 'workspace.updated': 'Changed workspace settings', 'workspace.exported': 'Exported all workspace data',
  'workspace.deletion_requested': 'Asked to delete the workspace', 'workspace.deletion_cancelled': 'Cancelled the workspace deletion',
};
export function actionText(action) {
  if (ACTIONS[action]) return ACTIONS[action];
  const t = action.replace(/[._]/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Audit detail keys in plain words. A key not listed here is still shown, as plain words.
const DETAIL_LABELS = {
  email: 'Email', role: 'Role', name: 'Name', title: 'Title', code: 'Code', slug: 'Page address', public_slug: 'Page address', note: 'Note', reason: 'Reason',
  status: 'Status', from: 'From', to: 'To', method: 'Method', channel: 'Channel', category: 'Category', kind: 'Type', plan: 'Plan',
  amount: 'Amount', amount_paid: 'Amount paid', total_amount: 'Total', price: 'Price', unit_price: 'Unit price', monthly_rent: 'Monthly rent',
  estimated_cost: 'Estimated cost', payout: 'Payout', refund: 'Refund', deduction: 'Deduction', reserve_topup: 'Reserve top-up',
  check_in: 'Check-in', check_out: 'Check-out', start: 'Start', end: 'End', end_date: 'End date', paid_on: 'Paid on', paid_until: 'Paid until',
  month: 'Month', months: 'Months', enabled: 'Turned on', sent: 'Sent', count: 'Count', quantity: 'Quantity',
  abandoned_followup: 'Follow-up email', returning_guest_pct: 'Returning-guest discount',
  pricing: 'Pricing', adjust_pct: 'Price change',
  vip: 'VIP', gatepass_enabled: 'Send automatically', gatepass_days_before: 'Days before check-in', gatepass_attach_ids: 'Attach IDs',
  gatepass_authorized_by: 'Authorized by', gatepass_notes: 'Notes for the admin',
  admin_email: 'Admin email', review_links: 'Public review links', door_code: 'Door code', unit_label: 'Unit', par_level: 'Keep at least',
  checkin_time: 'Check-in time', checkout_time: 'Check-out time', min_nights: 'Minimum nights', wifi_name: 'Wi-Fi name', wifi_password: 'Wi-Fi password',
  security_deposit_amount: 'Security deposit', deposit_pct: 'Deposit percent', bookable_online: 'Bookable online', checkin_instructions: 'Check-in instructions',
  business_type: 'Modules for this workspace', guest_language: 'Default language', intro: 'Welcome text', paymongo_key: 'PayMongo key',
  instructions: 'Payment details for guests', full_name: 'Full name', phone: 'Mobile number', management_fee_pct: 'Management fee',
  fee_model: 'Fee type', flat_monthly_fee: 'Flat monthly fee', reserve_target: 'Repairs reserve target', reserve_monthly: 'Repairs reserve top-up',
  cleaning_to_manager: 'Cleaning fees kept for cleaning', unit_ids: 'Units', property_ids: 'Properties', offset_days: 'Number of days',
  due_day: 'Rent due day', deposit_amount: 'Security deposit', days: 'Days', max_quantity: 'Maximum quantity', subject: 'Subject',
  body: 'Message', notes: 'Notes', description: 'Details', priority: 'Priority', assigned_to: 'Assigned to',
  on_booking_page: 'Offer on the booking page', before_arrival: 'Offer before arrival', active: 'Active',
};
// The same key can mean a different thing in a different record: "enabled" is the booking page or manual payments,
// "property_ids" is the people list or the notifications list, and the notification types have card labels.
// Only changed-field lists use these, so an old row with a plain value still reads as before.
const ACTION_LABELS = {
  'direct_booking.settings_changed': { enabled: 'Booking page on' },
  'workspace.manual_payments_updated': { enabled: 'Manual payments on' },
  'workspace.updated': { name: 'Workspace name' },
  'member.updated': { property_ids: 'Properties they can access' },
  'pricing_rule.updated': { active: 'Rule on' },
  'cleaning.checklist_updated': { items: 'Checklist items' },
  'addon.updated': { name_tl: 'Taglish name', description: 'Description', unit_ids: 'Listings' },
  'user.notify_prefs_updated': {
    new_booking: 'New bookings', guest_message: 'Guest messages', checkin_form: 'Guest check-in forms', payment: 'Online payments',
    cleaning: 'Cleaning tasks', mention: 'Mentions in notes', assignment: 'Conversations assigned to you', sync_problem: 'Calendar sync problems',
  },
};
const MONEY_KEYS = new Set(['amount', 'amount_paid', 'total_amount', 'price', 'unit_price', 'monthly_rent', 'estimated_cost', 'payout', 'refund', 'deduction', 'reserve_topup']);
// Stored codes for add-on pricing and pricing rules, in plain words.
const DETAIL_VALUES = {
  per_stay: 'Per stay', per_night: 'Per night', per_guest: 'Per guest', per_guest_night: 'Per guest, per night',
  last_minute: 'Last minute', far_out: 'Far out', gap_night: 'Gap night',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One detail value as text: pesos for money, dates as dates, yes or no for switches, known words as labels.
function detailValue(k, v) {
  if (k === 'abandoned_followup') return v ? 'On' : 'Off';
  if (k === 'returning_guest_pct') return `${v}%`;
  if (k === 'adjust_pct') return `${Number(v) > 0 ? '+' : ''}${v}%`;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (MONEY_KEYS.has(k)) return v !== '' && Number.isFinite(Number(v)) ? peso(v) : '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtDate(s);
  if (/^\d{4}-\d{2}$/.test(s)) return fmtMonth(s);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return fmtDateTime(s);
  // A code nothing above names still reads as words ("some_code" is "Some code"), never with an underscore.
  const word = DETAIL_VALUES[s] || label(s);
  return /^[a-z]+(_[a-z]+)+$/.test(word) ? word.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : word;
}

// "every 1 month", "every 3 months": the stored unit is plural ('days' or 'months'), so it is singular for 1.
const repeatText = (n, unit) => `every ${n} ${Number(n) === 1 ? String(unit).replace(/s$/, '') : unit}`;

// A field's plain-words name: its detail label, or the key in sentence case. A Taglish guide field says so.
// The action (optional) names the record, so a key that means different things there reads with that record's label.
const fieldLabel = (k, action) => {
  if (ACTION_LABELS[action]?.[k]) return ACTION_LABELS[action][k];
  if (DETAIL_LABELS[k]) return DETAIL_LABELS[k];
  if (k.endsWith('_tl')) return `${fieldLabel(k.slice(0, -3), action)} (Taglish)`;
  return k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
};
// "Changed: Arrival, Parking". Ids are left out, and labels are all it names, never the values.
const changedText = (keys, action) => {
  const names = keys.filter((k) => !k.endsWith('_id')).map((k) => fieldLabel(k, action));
  return names.length ? `Changed: ${names.join(', ')}` : '';
};
// Two saved values read the same when their text is equal, or when both are numbers of the same size ('2500.00' and 2500).
const numeric = (x) => (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '') ? Number(x) : NaN);
const sameValue = (a, b) => String(a ?? '') === String(b ?? '') || (Number.isFinite(numeric(a)) && numeric(a) === numeric(b));
// The keys whose value differs between the saved 'before' and the 'after' that was sent.
const changedFields = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])]
  .filter((k) => !sameValue(before[k], after[k]));

// Audit details on one line. Ids (any *_id field, or any UUID value), empty values and nested data are left out.
// A list of changed fields and a before/after pair name the fields that changed, as labels, never their values.
// The audit action (optional) is the record the details belong to; see ACTION_LABELS.
export function summarize(details, action) {
  if (!details) return '';
  const parts = [];
  for (const [k, v] of Object.entries(details)) {
    // Turning the discount off saves null. That is shown as Off, so the row still says what changed.
    if (k === 'returning_guest_pct' && v === null) { parts.push(`${DETAIL_LABELS[k]}: Off`); continue; }
    if (k === 'fields' && Array.isArray(v)) { const text = changedText(v, action); if (text) parts.push(text); continue; }
    if (k === 'before' && v && typeof v === 'object') { const text = changedText(changedFields(v, details.after || {}), action); if (text) parts.push(text); continue; }
    if (v === null || v === undefined || typeof v === 'object' || k.endsWith('_id') || UUID.test(String(v))) continue;
    // A repeat schedule is two fields, the count and the unit. They read as one phrase where the count is.
    if (k === 'every_unit') continue;
    if (k === 'every_n' && details.every_unit) {
      parts.push(`Repeats: ${repeatText(v, details.every_unit)}`);
      continue;
    }
    const text = detailValue(k, v);
    if (text) parts.push(`${fieldLabel(k)}: ${text}`);
  }
  const text = [...new Set(parts)].join(' · ');
  // Cut long details with an ellipsis so it is clear the text goes on.
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

// ---------------------------------------------------------------- plan
// Plans count short-term listings only: units with a nightly rate (D-03), the same count the server checks.
export const shortTermCount = (listings) => listings.filter((l) => l.nightly_rate != null).length;
// A listing with no nightly rate is a monthly unit, which plans do not count. The plan card says so only then.
export const monthlyNote = (listings) => listings.some((l) => l.nightly_rate == null);

export async function planCard(u, rerender) {
  const p = u.plan;
  // Loaded here, not at the top, so the rest of this file still loads without it.
  const bc = await import('./billingcoupon.js');
  let pub = { plans: [], contact_email: '' };
  try { pub = await get('/public/plans'); } catch { /* ignore */ }
  let listings = [];
  try { ({ listings } = await get('/listings')); } catch { /* ignore */ }
  let bill = { online: false, options: [], history: [] };
  try { bill = await get('/billing'); } catch { /* ignore */ }
  billWaiting = !!bill.pending_payment;
  const status = p.read_only
    ? h('div', { class: 'alert alert--error' }, p.reason === 'trial_ended' ? 'Your free trial has ended. Your workspace is view-only until you choose a plan.' : 'Your payment is overdue. Your workspace is view-only until you renew.')
    : p.plan === 'trial' ? h('div', { class: 'alert alert--info' }, `Free trial: ${p.trial_days_left} day${p.trial_days_left === 1 ? '' : 's'} left. All features are included.`)
      : p.reason === 'grace' ? h('div', { class: 'alert alert--warn' }, `Your plan was paid until ${fmtDate(p.paid_until)}. Please renew within 7 days to avoid interruption.`) : null;
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Plan & billing'), h('span', { class: 'badge badge--paid' }, p.name)),
    status,
    h('dl', { class: 'dl', style: { marginTop: '12px' } },
      h('dt', null, 'Current plan'), h('dd', null, p.price ? `${p.name} — ₱${p.price.toLocaleString('en-PH')} / month` : p.name),
      h('dt', null, 'Short-term listings'), h('dd', null, `${shortTermCount(listings)} of ${p.listing_limit >= 1000 ? 'unlimited' : p.listing_limit}`,
        monthlyNote(listings) && h('div', { class: 'muted small' }, 'Monthly units are not counted.')),
      p.paid_until && [h('dt', null, 'Paid until'), h('dd', null, fmtDate(p.paid_until))]),
    p.plan === 'comped' ? h('p', { class: 'muted' }, 'Your workspace is on a complimentary plan, so there is nothing to pay.')
      : bill.online ? payOnline(p, bill, rerender, bc) : [
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
          h('span', { class: 'row__title' }, b.kind === 'card_check' ? 'Card check' : `${b.plan[0].toUpperCase()}${b.plan.slice(1)} · ${b.months} month${b.months > 1 ? 's' : ''}`),
          h('span', { class: 'row__sub' }, b.kind === 'card_check' ? (b.status === 'paid' ? `Paid ${fmtDateTime(b.paid_at)}${rowCard(b) || (bill.card ? ` · ${cardText(bill.card)}` : '')}` : `Started ${fmtDateTime(b.created_at)}, waiting for payment`)
            : b.provider === 'coupon' ? `Free with coupon ${b.coupon_code} · covers ${fmtDate(b.period_start)} to ${fmtDate(b.period_end)}`
            : b.status === 'paid' ? `Paid ${fmtDateTime(b.paid_at)}${b.payment_method ? ` · ${b.payment_method}` : ''}${rowCard(b)} · covers ${fmtDate(b.period_start)} to ${fmtDate(b.period_end)}${Number(b.discount_amount) > 0 ? ` · coupon ${b.coupon_code} saved ${bc.money(b.discount_amount)}` : ''}`
              : `Started ${fmtDateTime(b.created_at)}, waiting for payment`)),
        h('div', { class: 'row__end' }, h('strong', null, bc.money(b.amount)),
          h('span', { class: `badge badge--${b.status === 'paid' ? 'paid' : 'unpaid'}` }, b.provider === 'coupon' ? 'Free' : b.status === 'paid' ? 'Paid' : 'Pending'))))))]);
}

// A paid row remembers its own card (migration 039); hosted and older rows have none and keep the plain text.
const rowCard = (b) => (b.card_last4 ? ` · ${cardText({ brand: b.card_brand, last4: b.card_last4 })}` : '');
const cardText = (c) => `${c.brand ? c.brand[0].toUpperCase() + c.brand.slice(1) : 'Card'} ending ${c.last4}`;
const planName = (bill, key) => bill.options?.find((o) => o.key === key)?.name || (key ? key[0].toUpperCase() + key.slice(1) : '');

// Card on file, the plan chosen for after the trial, and automatic payment (Stage 2). Owner only; the server sends none of it to others.
export function cardBlock(p, bill, rerender) {
  const ar = bill.auto_renew || {};
  const stage2 = !!bill.subscriptions;
  const saveBtn = (text, onclick, key) => h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'data-focus-key': key, onclick }, text);
  const change = async (body, doneText, btn) => {
    btn.disabled = true;
    try { await patch('/billing/renewal', body); toast(doneText); rerender(); } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  };
  const rows = [];
  if (bill.card) {
    const until = p.paid_until || p.trial_ends_at;
    rows.push(h('div', { class: 'payonline__row' }, h('span', null, `Card on file: ${cardText(bill.card)}`),
      saveBtn('Remove card', async (e) => {
        const ok = await confirmDialog({ title: 'Remove your card?', cancelText: 'Keep card', confirmText: 'Remove card',
          text: stage2 ? `BalayHub forgets this card and turns off automatic payment.${until ? ` Your plan stays active until ${fmtDate(until)}.` : ''}` : 'BalayHub forgets this card. You can still pay another way.' });
        if (!ok) return;
        try { await api('DELETE', '/billing/card'); toast('Card removed.'); rerender(); } catch (err) { toast(err.message, 'error'); e.target?.focus?.(); }
      })));
  }
  if (bill.renewal_plan && bill.options?.length) {
    const sel = h('select', { class: 'input input--sm', 'aria-label': 'Plan after your trial', hidden: true }, bill.options.map((o) => h('option', { value: o.key, selected: o.key === bill.renewal_plan }, o.name)));
    const save = saveBtn('Save', (e) => change({ renewal_plan: sel.value }, 'Saved.', e.target), 'card-plan-change'); // after the redraw Save is hidden: focus goes to the new Change (same key)
    save.hidden = true;
    const chg = saveBtn('Change', () => { sel.hidden = false; save.hidden = false; chg.hidden = true; sel.focus(); }, 'card-plan-change');
    rows.push(h('div', { class: 'payonline__row' }, h('span', null, `${p.plan === 'trial' ? 'Plan after your trial' : 'Next plan'}: ${planName(bill, bill.renewal_plan)}`), chg, sel, save));
  }
  if (stage2 && bill.card) {
    if (ar.status === 'past_due' || ar.status === 'unpaid') {
      rows.push(h('div', { class: 'alert alert--error', role: 'alert' }, `Your card payment on ${fmtDate(ar.next_charge_on || p.paid_until)} didn't go through. Pay now to keep making changes.`));
    }
    if (ar.on) {
      const o = bill.options?.find((x) => x.key === bill.renewal_plan);
      rows.push(h('div', { class: 'payonline__row' },
        h('span', null, `Automatic payment is on. Next charge: ${o ? peso(o.prices[0].amount) : 'your plan price'} to ${cardText(bill.card)}${ar.next_charge_on ? ` on ${fmtDate(ar.next_charge_on)}` : ''}.`),
        saveBtn('Cancel automatic payment', async (e) => {
          const ok = await confirmDialog({ title: 'Cancel automatic payment?', cancelText: 'Keep it on', confirmText: 'Cancel automatic payment',
            text: `Your plan stays active${p.paid_until ? ` until ${fmtDate(p.paid_until)}` : ''}. After that, renew here by hand.` });
          if (ok) await change({ auto_renew: false }, 'Automatic payment is off.', e.target);
        }, 'card-auto-toggle')));
    } else {
      const tick = h('input', { type: 'checkbox', id: 'auto-consent' });
      const consent = h('label', { class: 'check', hidden: true }, tick, h('span', null, 'I agree that BalayHub may charge my card for the plan above every month after my trial, until I cancel.'));
      const err = h('div', { class: 'error', role: 'alert' });
      const go = saveBtn('Turn on automatic payment', async (e) => {
        if (consent.hidden) { consent.hidden = false; tick.focus(); return; }
        if (!tick.checked) { err.textContent = 'Tick the box to agree to automatic payment.'; tick.focus(); return; }
        err.textContent = '';
        await change({ auto_renew: true, consent: true }, 'Automatic payment is on.', e.target);
      }, 'card-auto-toggle');
      rows.push(h('div', null, h('div', { class: 'payonline__row' }, h('span', null, 'Automatic payment is off.'), go), consent, err));
    }
  }
  return rows.length ? h('div', { class: 'cardblock', style: { marginTop: '12px' } }, rows) : null;
}

// Choose a plan and length, then pay on PayMongo's secure page.
export function payOnline(p, bill, rerender, bc) {
  let plan = payDefaultPlan(p, bill);
  let months = 1;
  let quote = null; // the server's preview with the coupon applied, or null for the list price
  const amountEl = h('strong');
  const strikeEl = h('span', { class: 'strike muted', hidden: true });
  const msgEl = h('div', { class: 'muted small', 'aria-live': 'polite' });
  const btn = h('button', { class: 'btn btn--primary', type: 'button' });
  const cards = h('div', { class: 'plan-mini' });
  const drawCards = () => cards.replaceChildren(...bill.options.map((o) => h('button', {
    type: 'button', class: `plan-mini__item plan-mini__pick${o.key === plan ? ' is-current' : ''}`, 'aria-pressed': String(o.key === plan),
    onclick: () => { plan = o.key; drawCards(); selectionChanged(); },
  }, h('strong', null, o.name), h('span', null, `₱${o.prices[0].amount.toLocaleString('en-PH')}/mo`),
  h('span', { class: 'muted small' }, `Up to ${o.listings} listings${o.ai ? ' · AI drafts' : ''}`))));
  const monthSel = h('select', { class: 'input input--sm', 'aria-label': 'Months', onchange: (e) => { months = Number(e.target.value); selectionChanged(); } },
    [[1, '1 month'], [3, '3 months'], [12, '12 months (2 months free)']].map(([m, t]) => h('option', { value: m }, t)));
  const box = bc.couponBox({ current: bill.coupon, getSelection: () => ({ plan, months }), onQuote: (q) => { quote = q; update(); } });
  const autoOn = !!(bill.subscriptions && bill.auto_renew?.on);
  const couponNote = h('span', { hidden: true }, autoOn ? ' Your coupon is applied automatically to the months it covers.' : ' BalayHub never charges your card on its own; you renew here.');
  const saved = !!(bill.saved_card_pay && bill.card);
  const pending = bill.pending_payment || null; // a payment is waiting at the bank: no second one-tap pay, no coupon box
  const savedBtn = saved && !pending ? h('button', { class: 'btn btn--primary', type: 'button' }) : null; // no saved card, no pay button
  const label = () => (quote?.free ? 'Activate free plan' : saved ? 'Pay another way' : quote?.card_only ? `Pay ${bc.plain(quote.amount)} by card` : 'Pay now');
  const update = () => {
    const o = bill.options.find((x) => x.key === plan);
    const discounted = quote && Number(quote.discount_amount) > 0;
    amountEl.textContent = bc.money(quote ? quote.amount : o.prices.find((x) => x.months === months).amount);
    strikeEl.hidden = !discounted;
    strikeEl.textContent = discounted ? bc.money(quote.list_amount) : '';
    msgEl.textContent = quote?.message || '';
    couponNote.hidden = !(quote?.coupon || bill.coupon?.status === 'active' || bill.coupon?.status === 'pending');
    if (!btn.disabled) btn.textContent = label();
    // A saved card makes one tap the main way to pay; a free coupon needs no card, so the plain Activate button stays.
    const showSaved = saved && !pending && !quote?.free;
    if (savedBtn) savedBtn.hidden = !showSaved;
    btn.className = showSaved ? 'btn btn--secondary' : 'btn btn--primary';
    if (savedBtn && !savedBtn.disabled) savedBtn.textContent = `Pay ${bc.money(quote ? quote.amount : bill.options.find((x) => x.key === plan).prices.find((x) => x.months === months).amount)} with ${cardText(bill.card || {})}`;
  };
  // A new plan or length makes the old preview wrong at once; ask the server again.
  const selectionChanged = () => { quote = null; update(); if (!pending) box.refresh(); };
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = quote?.free ? 'Activating…' : 'Opening secure checkout…';
    try {
      const code = box.getCode();
      const r = await post('/billing/checkout', { plan, months: String(months), seen_paid_until: bill.paid_until ?? null, ...(code ? { coupon_code: code } : {}) });
      if (r.activated) {
        await refreshUser();
        toast(`Your ${bill.options.find((x) => x.key === plan).name} plan is active until ${fmtDate(r.paid_until)}.`);
        rerender();
        return;
      }
      location.href = r.checkout_url;
    } catch (err) {
      if (err.code === 'PAYMENT_RECEIVED') { carriedNotice = err.message; await refreshUser(); rerender(); return; }
      if (err.code === 'PAYMENT_IN_PROGRESS') { carriedNotice = err.message; carriedUnlessWaiting = true; await refreshUser(); rerender(); return; }
      if (/^(COUPON|COMPED|CARD_OFF)/.test(err.code || '')) box.showError(err.message); else toast(err.message, 'error');
      btn.disabled = false;
      update();
    }
  });
  savedBtn?.addEventListener('click', async () => {
    savedBtn.disabled = true; btn.disabled = true;
    savedBtn.textContent = 'Charging your card…';
    try {
      const code = box.getCode();
      const r = await post('/billing/pay-saved', { plan, months: String(months), seen_paid_until: bill.paid_until ?? null, ...(code ? { coupon_code: code } : {}) });
      if (r.status === 'action_required' && r.redirect_url) { location.assign(r.redirect_url); return; }
      if (r.activated || r.status === 'paid') {
        await refreshUser();
        toast(`Your ${bill.options.find((x) => x.key === plan).name} plan is active until ${fmtDate(r.paid_until)}.`);
        rerender();
        return;
      }
      savedBtn.disabled = false; btn.disabled = false; update();
      msgEl.textContent = 'Your payment is being confirmed. Check back in a moment.';
    } catch (err) {
      if (err.code === 'PAYMENT_RECEIVED') { carriedNotice = err.message; await refreshUser(); rerender(); return; }
      if (err.code === 'PAYMENT_IN_PROGRESS') { carriedNotice = err.message; carriedUnlessWaiting = true; await refreshUser(); rerender(); return; }
      savedBtn.disabled = false; btn.disabled = false; update();
      if (err.code === 'SAVED_CARD_FAILED' || err.code === 'SAVED_CARD_NONE') {
        msgEl.textContent = "Your saved card couldn't be charged. Pay another way, or use a different card.";
        btn.focus();
      } else if (/^(COUPON|COMPED|CARD_OFF)/.test(err.code || '')) box.showError(err.message); else toast(err.message, 'error');
    }
  });
  drawCards();
  update();
  if (!pending) box.refresh();
  return h('div', { class: 'payonline' },
    cardBlock(p, bill, rerender),
    h('h3', { class: 'subhead', style: { marginTop: '16px' } }, p.plan === 'trial' || p.read_only ? 'Choose your plan' : 'Renew or change plan'),
    cards,
    h('div', { class: 'payonline__row' }, monthSel, h('span', null, 'Total: ', strikeEl, ' ', amountEl), savedBtn, btn),
    pending && h('p', { class: 'muted small', role: 'note' }, 'This cancels the payment waiting at your bank.'), // the hosted route first cancels the waiting one-tap payment (BIL)
    pending && h('div', { class: 'alert alert--info', role: 'status' }, pendingText(pending, bc.money)),
    msgEl,
    !pending && box,
    h('p', { class: 'muted small' }, 'Pay securely with GCash, Maya, card or GrabPay through PayMongo. Your plan activates as soon as the payment goes through. Renewing the same plan early adds the time on top; switching plans converts your unused days to the new plan; paying during the free trial keeps your remaining trial days.', couponNote));
}


// ---------------------------------------------------------------- password
// ---------------------------------------------------------------- guest language
function guestLanguageCard(u, rerender) {
  const lang = h('select', { class: 'input', id: 'guest-lang' },
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
      h('div', { class: 'field' }, h('label', { for: 'guest-lang' }, 'Default language'), lang),
      h('label', { class: 'check' }, alsoMessages, h('span', null, 'Also switch my booking confirmation, check-in, thank-you and payment reminder messages')),
      h('div', null, h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'aria-label': 'Save default language', onclick: save }, 'Save'))));
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
// The records a workspace holds, named by its modules: the delete warning and the download text use these. A short-term
// workspace reads as before; a long-term one names its properties, tenants and leases; both names both sets.
export function deleteText(type) {
  const names = type === 'long_term' ? 'properties, units, tenants, leases, rent payments, expenses, maintenance requests'
    : type === 'both' ? 'listings, reservations, guests, messages, payments, properties, units, tenants, leases, rent payments, expenses, maintenance requests'
      : 'listings, reservations, guests, messages, payments';
  return `all ${names}, files and team accounts`;
}
export function exportText(type) {
  return type === 'long_term' ? 'properties, units, tenants, leases, rent payments, expenses, maintenance and more'
    : type === 'both' ? 'listings, reservations, guests, messages, payments, properties, units, tenants, leases, rent payments, expenses, maintenance and more'
      : 'listings, reservations, guests, messages, payments, expenses and more';
}
function dataCard(u, rerender) {
  const del = () => formModal({
    title: 'Delete this workspace?',
    submitText: 'Delete workspace',
    fields: [
      h('div', { class: 'alert alert--error' },
        `This permanently deletes ${deleteText(u.business_type)} in `,
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
    h('p', { class: 'small' }, `Download everything in this workspace (${exportText(u.business_type)}) as a file you can keep or move to another system. ID photos and uploaded files are listed but not included.`),
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
    class: 'input', rows: 4, maxlength: 1000, value: m.instructions || '', 'aria-label': 'Payment details for guests', 'aria-describedby': 'mp-details-err',
    placeholder: 'e.g. GCash 0917 123 4567 (Maria Santos)\nBDO savings 0012 3456 7890 (Maria Santos)',
  });
  const save = async (e) => {
    const form = e.currentTarget.closest('.form');
    clearErrors(form);
    try {
      await patch('/workspace/manual-payments', { enabled: enabled.checked, instructions: details.value });
      toast('Manual payments saved.');
      rerender();
    } catch (err) {
      // Put the server's reason on the Payment details box and highlight it.
      const unplaced = showErrors(form, err.fields);
      toast(unplaced.length ? unplaced.join(' ') : (err.summary || err.message), 'error');
    }
  };
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Manual payments')),
    h('p', { class: 'muted small' }, 'Let guests pay by GCash, Maya or bank transfer. They send you a screenshot from their payment page; you check it and confirm it, which records the payment on the reservation. BalayHub does not check the money for you.'),
    h('div', { class: 'form' },
      h('label', { class: 'check' }, enabled, h('span', null, 'Accept manual payments on the payment page')),
      h('div', { class: 'field', dataset: { field: 'instructions' } }, h('label', null, 'Payment details guests should use'), details,
        h('div', { class: 'hint' }, 'Shown on the payment page, up to 1,000 characters. Add the GCash number, bank name and account name.'),
        h('div', { class: 'error', id: 'mp-details-err', role: 'alert' })),
      h('div', null, h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'aria-label': 'Save manual payments', onclick: save }, 'Save'))));
}

async function bookingCard(rerender) {
  let b;
  try { b = await get('/direct-booking'); } catch { return null; }
  const listed = b.listings.filter((l) => l.bookable_online);
  const noListing = !listed.length;
  const save = async (payload, msg) => {
    try { await patch('/direct-booking', payload); toast(msg); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  // An unchecked key that PayMongo can't be reached for asks first (409 PAYMONGO_UNCHECKED); a yes sends it again with the flag.
  const turnOn = async (confirmed) => {
    try { await patch('/direct-booking', { enabled: true, ...(confirmed && { confirm_unchecked_key: true }) }); toast('Your booking page is live!'); rerender(); } catch (err) {
      if (err.code !== 'PAYMONGO_UNCHECKED') { toast(err.message, 'error'); return; }
      if (await confirmDialog({ title: 'Key not checked yet', text: err.message, confirmText: 'Turn on anyway', cancelText: 'Cancel' })) await turnOn(true);
    }
  };
  const connect = () => formModal({
    title: 'Connect your PayMongo account',
    submitText: 'Save key',
    fields: [
      h('p', { class: 'small' }, 'Guests pay you directly through your own PayMongo account (GCash, Maya, cards). In your PayMongo dashboard go to ',
        h('strong', null, 'Developers → API keys'), ' and copy the ', h('strong', null, 'Secret key'), '. Start with the test key (sk_test_…) to try it, then switch to the live key.'),
      h('p', { class: 'small' }, 'No PayMongo account yet? Sign up at ', h('a', { href: 'https://dashboard.paymongo.com/signup', target: '_blank', rel: 'noopener' }, 'paymongo.com'), '. You get a test key right away; the live key comes after PayMongo checks your business.'),
      field({ name: 'paymongo_secret_key', label: 'PayMongo secret key', type: 'password', required: true, autocomplete: 'off', maxlength: 500, placeholder: 'sk_live_…' }),
      h('p', { class: 'muted small' }, 'Stored encrypted and never shown again. Only used to create checkouts and check payments for your bookings.'),
    ],
    onSubmit: async (d) => {
      await patch('/direct-booking', { paymongo_secret_key: d.paymongo_secret_key });
      // PayMongo accepted it ("Connected"), or couldn't be reached and the key waits for a check when the page is turned on.
      const { paymongo_checked: checked } = await get('/direct-booking').catch(() => ({}));
      toast(checked ? 'PayMongo connected.' : "Key saved. It couldn't be checked yet.");
      rerender();
    },
  });
  const edit = () => formModal({
    title: 'Booking page settings',
    submitText: 'Save',
    fields: [
      field({ name: 'slug', label: 'Page address', value: b.slug, required: true, maxlength: 40, hint: `Your page: ${location.origin}/#/book/<this>. Letters, numbers and dashes.` }),
      field({ name: 'intro', label: 'Welcome text', type: 'textarea', value: b.intro, maxlength: 1500, placeholder: 'e.g. Book directly with us for the best rate!' }),
    ],
    onSubmit: async (d) => {
      await patch('/direct-booking', d);
      // The server tidies the address (lower case, letters, numbers and dashes), so say what it was saved as.
      const { slug } = await get('/direct-booking').catch(() => ({}));
      toast(slug && slug !== d.slug ? `Saved as ${slug}.` : 'Saved.');
      rerender();
    },
  });
  const copy = async () => {
    try { await navigator.clipboard.writeText(b.url); toast('Link copied. Share it on Facebook, Instagram or Messenger.'); } catch {
      // No clipboard access: show the link selected in a box so the host can copy it by hand.
      const input = h('input', { class: 'input', readonly: true, value: b.url, 'aria-label': 'Your booking link' });
      openModal({ title: 'Copy your booking link', body: h('div', { class: 'form' }, input, h('p', { class: 'muted small' }, 'Press Ctrl+C (Cmd+C on a Mac) to copy it.')) });
      input.select();
    }
  };
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Direct booking page'),
      b.enabled ? h('span', { class: 'badge badge--paid' }, 'Live') : h('span', { class: 'badge badge--archived' }, 'Off')),
    h('p', { class: 'small' }, 'Let guests book and pay you directly, with no channel fees. Guests choose dates on your page and pay through your PayMongo account; the booking, confirmation, receipt and check-in form are created automatically, and your Airbnb and Booking.com calendars are updated through calendar sync.'),
    h('dl', { class: 'dl', style: { marginTop: '12px' } },
      h('dt', null, 'PayMongo'), h('dd', null,
        b.paymongo_connected ? (b.paymongo_checked ? `Connected (${b.paymongo_key_hint})` : `Saved, not checked yet (${b.paymongo_key_hint})`) : 'Not connected',
        b.paymongo_connected && !b.paymongo_checked && h('p', { class: 'muted small' }, "BalayHub couldn't reach PayMongo to check this key. It is checked again when you turn on your booking page.")),
      h('dt', null, 'Listings on the page'), h('dd', null, listed.length ? `${listed.length} of ${b.listings.length}` : [h('span', null, 'None yet: on Listings, press Edit and tick "Show this listing on my booking page". '), h('a', { class: 'link-tap', href: '#/listings' }, 'Go to Listings')]),
      b.url && [h('dt', null, 'Your link'), h('dd', null, h('a', { class: 'link-tap', href: b.url.slice(b.url.indexOf('#')), target: '_blank' }, b.url))]),
    b.test_mode && h('div', { class: 'alert alert--warn', style: { marginTop: '10px' } }, 'TEST MODE: you connected a PayMongo test key, so payments on your page are not real and guests see a test-mode notice. Switch to your live key (Change key) before sharing the link.'),
    listed.some((l) => !l.photo_count) && h('p', { class: 'muted small' }, 'Tip: add photos to every listing (Listings → Photos). Pages with photos get far more bookings.'),
    h('div', { class: 'chips', style: { marginTop: '12px' } },
      b.paymongo_connected
        ? (b.enabled
          ? h('button', { class: 'btn btn--secondary btn--sm', onclick: () => save({ enabled: false }, 'Booking page turned off.') }, 'Turn off')
          : h('button', { class: 'btn btn--primary btn--sm', disabled: noListing, 'aria-describedby': noListing ? 'bp-on-hint' : undefined, onclick: () => turnOn(false) }, 'Turn on'))
        : h('button', { class: 'btn btn--primary btn--sm', onclick: connect }, 'Connect PayMongo'),
      b.enabled && b.url && h('button', { class: 'btn btn--secondary btn--sm', onclick: copy }, 'Copy link'),
      h('button', { class: 'btn btn--ghost btn--sm', onclick: edit }, 'Page settings'),
      b.paymongo_connected && h('button', { class: 'btn btn--ghost btn--sm', onclick: connect }, 'Change key')),
    !b.enabled && b.paymongo_connected && noListing && h('p', { class: 'muted small', id: 'bp-on-hint' }, 'Tick at least one listing for your page first (Listings → Edit → Booking page and payments).'));
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
      h('div', null, h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'aria-label': 'Save guest experience', onclick: save }, 'Save'))));
}
