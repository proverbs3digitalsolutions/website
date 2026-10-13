// My account: who you are, your workspace and role, the properties you work
// on, sign-in and devices, preferences, your recent activity, and log out.

import { get, post, patch } from '../api.js';
import { h, icon, badge, label, fmtDate, fmtDateTime, field, formModal, toast, confirmDialog } from '../ui.js';
import { state, logout, refreshUser } from '../app.js';
import { changePassword, ROLE_TEXT } from './settings.js';
import { themeSwitch } from '../themeswitch.js';

const TYPE = { short_term: 'Short-term stays', long_term: 'Monthly rentals', both: 'Short-term stays and monthly rentals' };
const OWNER_TEXT = 'Full access: listings, reservations, money, reports, team, plan and billing, and the workspace’s data.';

// Audit actions in plain words.
const ACTIONS = {
  'auth.password_changed': 'Changed your password', 'auth.signed_out_others': 'Signed out your other devices', 'user.profile_updated': 'Updated your profile',
  'reservation.created': 'Added a reservation', 'reservation.updated': 'Edited a reservation', 'reservation.cancelled': 'Cancelled a reservation',
  'reservation.confirmation_sent': 'Sent a booking confirmation', 'reservation.receipt_sent': 'Sent a receipt', 'reservation.payment_recorded': 'Recorded a guest payment',
  'reservation.payment_voided': 'Voided a guest payment', 'deposit.received': 'Recorded a security deposit', 'deposit.settled': 'Returned or settled a deposit',
  'deposit.reopened': 'Reopened a deposit', 'calendar.blocked': 'Blocked dates', 'calendar.unblocked': 'Unblocked dates', 'rates.updated': 'Changed nightly prices',
  'season.created': 'Added a season price', 'season.removed': 'Removed a season price', 'cleaning.task_created': 'Added a cleaning task', 'cleaning.task_updated': 'Updated a cleaning task',
  'cleaning.checklist_updated': 'Edited the cleaning checklist', 'guest.created': 'Added a guest', 'guest.updated': 'Updated a guest', 'checkin.link_replaced': 'Made a new check-in link',
  'inbox.ai_draft': 'Used an AI reply draft', 'inbox.message_cancelled': 'Cancelled a scheduled message', 'template.created': 'Added a message template',
  'template.updated': 'Edited a message template', 'template.archived': 'Removed a message template', 'template.language_switched': 'Switched message templates’ language',
  'automation.created': 'Added an automatic message', 'automation.updated': 'Edited an automatic message', 'automation.removed': 'Removed an automatic message',
  'ical.feed_added': 'Connected a channel calendar', 'ical.feed_removed': 'Disconnected a channel calendar', 'ical.export_rotated': 'Made a new calendar export link',
  'discount_code.created': 'Added a discount code', 'direct_booking.settings_changed': 'Changed booking page settings', 'property.created': 'Added a property',
  'property.updated': 'Edited a property', 'property.archived': 'Archived a property', 'property.restored': 'Restored a property', 'property.gatepass_updated': 'Changed gate pass settings',
  'unit.created': 'Added a listing/unit', 'unit.updated': 'Edited a listing/unit', 'unit.archived': 'Archived a listing/unit', 'unit.restored': 'Restored a listing/unit',
  'unit_owner.created': 'Added a unit owner', 'unit_owner.updated': 'Edited a unit owner', 'unit_owner.archived': 'Archived a unit owner', 'unit_owner.statement_sent': 'Sent an owner statement',
  'tenant.created': 'Added a tenant', 'tenant.updated': 'Edited a tenant', 'tenant.archived': 'Archived a tenant', 'tenant.restored': 'Restored a tenant', 'tenant.exported': 'Exported a tenant’s data',
  'lease.created': 'Added a lease', 'lease.updated': 'Edited a lease', 'lease.cancelled': 'Cancelled a lease', 'payment.recorded': 'Recorded a rent payment', 'payment.voided': 'Voided a rent payment',
  'expense.recorded': 'Added an expense', 'expense.corrected': 'Corrected an expense', 'expense.voided': 'Voided an expense', 'maintenance.created': 'Logged a repair request',
  'file.uploaded': 'Uploaded a file', 'gatepass.sent': 'Sent a gate pass', 'member.invited': 'Invited a team member', 'member.updated': 'Changed a team member’s access', 'member.removed': 'Removed a team member',
  'member.invite_revoked': 'Cancelled an invitation', 'workspace.updated': 'Changed workspace settings', 'workspace.exported': 'Exported all workspace data',
  'workspace.deletion_requested': 'Asked to delete the workspace', 'workspace.deletion_cancelled': 'Cancelled the workspace deletion',
};
function activityText(a) {
  if (ACTIONS[a.action]) return ACTIONS[a.action];
  const t = a.action.replace(/[._]/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function planLine(p) {
  if (!p) return '—';
  if (p.is_demo) return 'Demo workspace (view only)';
  if (p.reason === 'deleting') return 'Scheduled for deletion (view only)';
  if (p.reason === 'trial_ended') return 'Free trial ended (view only)';
  if (p.reason === 'payment_due') return `${p.name} — payment overdue (view only)`;
  if (p.plan === 'trial') return `Free trial · ${p.trial_days_left} day${p.trial_days_left === 1 ? '' : 's'} left`;
  if (p.paid_until) return `${p.name} · paid until ${fmtDate(p.paid_until)}${p.reason === 'grace' ? ' (please renew)' : ''}`;
  return p.name;
}

export async function accountView(el, { rerender }) {
  const d = await get('/account/profile');
  const { user: u, workspace: w } = d;
  const isOwner = w?.role === 'owner';
  const roleText = !w ? '' : isOwner ? OWNER_TEXT
    : (w.business_type === 'long_term' ? ROLE_TEXT.long_term : ROLE_TEXT.short_term)[w.role];
  const initials = u.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
  const others = d.sessions.filter((s) => !s.current);

  const editProfile = () => formModal({
    title: 'Edit profile', submitText: 'Save',
    fields: [
      field({ name: 'full_name', label: 'Full name', required: true, value: u.full_name, maxlength: 120, autocomplete: 'name' }),
      field({ name: 'phone', label: 'Mobile number', type: 'tel', value: u.phone || '', placeholder: '0917 123 4567', autocomplete: 'tel' }),
    ],
    onSubmit: async (data) => {
      await patch('/account/profile', { full_name: data.full_name, phone: data.phone || null });
      await refreshUser();
      toast('Profile updated.');
      rerender();
    },
  });

  const signOutDevice = (s) => async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await post(`/account/sessions/${s.id}/logout`); toast(`Signed out ${s.device}.`); rerender(); } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  };
  const signOutOthers = async (e) => {
    if (!await confirmDialog({ title: 'Sign out other devices?', text: 'Every other phone or computer signed in to your account will need to log in again. This one stays signed in.', confirmText: 'Sign out others' })) return;
    const btn = e.target; btn.disabled = true;
    try { const r = await post('/account/sessions/logout-others'); toast(`Signed out ${r.signed_out} other device${r.signed_out === 1 ? '' : 's'}.`); rerender(); } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  };

  el.replaceChildren(
    h('div', { class: 'acct-hero card' },
      h('div', { class: 'acct-avatar', 'aria-hidden': 'true' }, initials || '?'),
      h('div', { class: 'acct-hero__main' },
        h('h1', null, u.full_name),
        h('p', { class: 'muted' }, u.email, w ? ` · ${w.name}` : ''),
        w && h('div', { class: 'chips' }, badge('active', label(w.role)), u.email_verified ? badge('paid', 'Email verified') : badge('unpaid', 'Email not verified'))),
      h('div', { class: 'acct-hero__actions' },
        h('button', { class: 'btn btn--secondary', onclick: editProfile }, 'Edit profile'),
        h('button', { class: 'btn btn--danger', onclick: logout }, icon('logout'), 'Log out'))),

    h('div', { class: 'grid grid--2', style: { marginTop: '16px' } },
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Profile'), h('button', { class: 'btn btn--secondary btn--sm', onclick: editProfile }, 'Edit')),
          h('dl', { class: 'dl' },
            h('dt', null, 'Name'), h('dd', null, u.full_name),
            h('dt', null, 'Email'), h('dd', null, u.email, ' ', u.email_verified ? '✓' : ''),
            h('dt', null, 'Mobile'), h('dd', null, u.phone || h('span', { class: 'muted' }, 'Not added')),
            h('dt', null, 'Member since'), h('dd', null, fmtDate(u.created_at))),
          h('p', { class: 'muted small', style: { marginTop: '10px' } }, 'Need to change your email? ', h('a', { href: '#/help/new?topic=account' }, 'Ask BalayHub Support'), '.')),

        w && h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Workspace & role')),
          h('dl', { class: 'dl' },
            h('dt', null, 'Workspace'), h('dd', null, w.name),
            h('dt', null, 'Used for'), h('dd', null, TYPE[w.business_type] || '—'),
            h('dt', null, 'Your role'), h('dd', null, label(w.role)),
            h('dt', null, 'What you can do'), h('dd', { class: 'small' }, roleText),
            h('dt', null, 'Plan'), h('dd', null, planLine(w.plan)),
            h('dt', null, 'Team'), h('dd', null, `${w.members} member${w.members === 1 ? '' : 's'}`),
            d.owner && [h('dt', null, 'Workspace owner'), h('dd', null, d.owner.full_name, h('div', { class: 'muted small' }, d.owner.email))]),
          h('div', { class: 'chips', style: { marginTop: '12px' } },
            isOwner && h('a', { class: 'btn btn--secondary btn--sm', href: '#/settings' }, w.plan?.plan === 'trial' || w.plan?.read_only ? 'Choose a plan' : 'Plan & billing'),
            isOwner && h('a', { class: 'btn btn--secondary btn--sm', href: '#/settings' }, 'Manage team'),
            !isOwner && h('p', { class: 'muted small' }, 'Your access is set by the workspace owner. Ask them if you need more.'))),

        w && h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, isOwner ? 'Your properties' : 'Properties you work on')),
          d.properties.length
            ? h('ul', { class: 'list' }, d.properties.map((p) => h('li', null, h('div', { class: 'row' },
              h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, p.property_name), h('span', { class: 'row__sub' }, [p.city, `${p.units} unit${p.units === 1 ? '' : 's'}`].filter(Boolean).join(' · ')))))))
            : h('p', { class: 'muted' }, isOwner ? 'No properties yet.' : 'You haven’t been assigned to a property yet. Ask the workspace owner.'))),

      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Sign-in & security')),
          h('dl', { class: 'dl' },
            h('dt', null, 'Sign-in'), h('dd', null, u.google_linked ? 'Email & password, and Google' : 'Email & password')),
          h('div', { class: 'chips', style: { margin: '10px 0 14px' } },
            h('button', { class: 'btn btn--secondary btn--sm', onclick: changePassword }, 'Change password')),
          h('h3', { class: 'subhead' }, 'Signed-in devices'),
          h('ul', { class: 'list' }, d.sessions.map((s, i) => h('li', { class: i >= 5 ? 'acct-more' : null, hidden: i >= 5 }, h('div', { class: 'row' },
            h('div', { class: 'row__main' },
              h('span', { class: 'row__title' }, s.device, s.current ? h('span', { class: 'muted small' }, ' · this device') : ''),
              h('span', { class: 'row__sub' }, `Signed in ${fmtDateTime(s.created_at)} · last active ${fmtDateTime(s.last_seen_at)}`)),
            h('div', { class: 'row__end' }, s.current
              ? h('button', { class: 'btn btn--secondary btn--sm', onclick: logout }, 'Log out')
              : h('button', { class: 'btn btn--secondary btn--sm', onclick: signOutDevice(s) }, 'Sign out')))))),
          d.sessions.length > 5 && h('button', { class: 'flt__clear', style: { marginTop: '6px' }, onclick: (e) => { e.currentTarget.closest('.card').querySelectorAll('.acct-more').forEach((li) => { li.hidden = false; }); e.currentTarget.remove(); } }, `Show ${d.sessions.length - 5} more`),
          others.length > 1 && h('button', { class: 'btn btn--secondary btn--sm', style: { marginTop: '10px' }, onclick: signOutOthers }, 'Sign out all other devices'),
          h('p', { class: 'muted small', style: { marginTop: '10px' } }, 'Don’t recognise a device? Sign it out and change your password.')),

        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Preferences')),
          h('div', { class: 'acct-pref' }, h('span', null, 'Appearance'), themeSwitch()),
          h('div', { class: 'acct-pref' }, h('span', null, 'Notifications on this device'),
            h('a', { href: '#/settings' }, u.notifications_on ? 'On · manage' : 'Turn on'))),

        d.support && h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Help & support')),
          h('p', null, d.support.waiting
            ? h('strong', null, `Support is waiting for your reply on ${d.support.waiting} ticket${d.support.waiting === 1 ? '' : 's'}.`)
            : d.support.open ? `You have ${d.support.open} open support ticket${d.support.open === 1 ? '' : 's'}.` : 'No open support tickets.'),
          h('div', { class: 'chips', style: { marginTop: '10px' } },
            h('a', { class: 'btn btn--secondary btn--sm', href: '#/help' }, 'Help & support'),
            h('a', { class: 'btn btn--secondary btn--sm', href: '#/help/new' }, 'Contact support'))),

        w && h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Your recent activity')),
          d.activity.length
            ? h('ul', { class: 'list' }, d.activity.map((a) => h('li', null, h('div', { class: 'row' },
              h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, activityText(a)), h('span', { class: 'row__sub' }, fmtDateTime(a.created_at)))))))
            : h('p', { class: 'muted' }, 'Nothing yet.')))),
  );
}
