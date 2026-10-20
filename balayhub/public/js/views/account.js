// My account: who you are, your workspace and role, the properties you work
// on, sign-in and devices, preferences, your recent activity, and log out.

import { get, post, patch } from '../api.js';
import { h, icon, badge, label, fmtDate, fmtDateTime, field, formModal, toast, confirmDialog } from '../ui.js';
import { state, logout, refreshUser } from '../app.js';
import { changePassword, ROLE_TEXT, actionText } from './settings.js';
import { themeSwitch } from '../themeswitch.js';

const TYPE = { short_term: 'Short-term stays', long_term: 'Monthly rentals', both: 'Short-term stays and monthly rentals' };
const OWNER_TEXT = 'Full access: listings, reservations, money, reports, team, plan and billing, and the workspace’s data.';

function planLine(p) {
  if (!p) return '—';
  if (p.card_check_due) return 'Waiting for your card check'; // the trial hasn't started (APP-FLOW 5.10)
  if (p.is_demo) return 'Demo workspace (view only)';
  if (p.reason === 'deleting') return 'Scheduled for deletion (view only)';
  if (p.reason === 'trial_ended') return 'Free trial ended (view only)';
  if (p.reason === 'payment_due') return `${p.name} — payment overdue (view only)`;
  if (p.plan === 'trial') return `Free trial · ${p.trial_days_left} day${p.trial_days_left === 1 ? '' : 's'} left`;
  if (p.paid_until) return `${p.name} · paid until ${fmtDate(p.paid_until)}${p.reason === 'grace' ? ' (please renew)' : ''}`;
  return p.name;
}

// This browser holds a push subscription and notifications are allowed: the same test the Settings card uses.
async function thisDeviceSubscribed() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return Boolean(await reg?.pushManager.getSubscription()) && Notification.permission === 'granted';
  } catch { return false; }
}

// Notifications card: which kinds of alerts you get, and (owners and managers) for which properties.
function notifyCard(role) {
  const card = h('div', { class: 'card' });
  async function load() {
    card.replaceChildren(h('div', { class: 'card__head' }, h('h2', null, 'Notifications')), h('p', { class: 'muted' }, 'Loading…'));
    let np;
    try { np = await get('/account/notify-prefs'); } catch (err) {
      card.replaceChildren(h('div', { class: 'card__head' }, h('h2', null, 'Notifications')), h('div', { class: 'alert alert--error', role: 'alert' }, err.message),
        h('button', { class: 'btn btn--secondary btn--sm', style: { marginTop: '10px' }, onclick: load }, 'Try again'));
      return;
    }
    // A long-term workspace has no alert types yet, so there is nothing to choose.
    if (!Object.keys(np.types).length) {
      card.replaceChildren(h('div', { class: 'card__head' }, h('h2', null, 'Notifications')), h('p', { class: 'muted' }, 'Alerts for monthly rentals aren’t available yet.'));
      return;
    }
    const boxes = Object.entries(np.types).map(([k, on]) => {
      const input = h('input', { type: 'checkbox', name: k, checked: on });
      return h('label', { class: 'check', key: k }, input, h('span', null, np.labels[k]));
    });
    const props = np.properties;
    const picked = new Set(np.property_ids || []);
    const showProps = ['owner', 'manager'].includes(role) && props.length > 0;
    let all = !np.property_ids;
    const propBoxes = props.map((p) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'prop', value: p.property_id, checked: picked.has(p.property_id) }), h('span', null, p.property_name)));
    const propList = h('div', { class: 'stack notify__props', hidden: all }, propBoxes);
    const radio = (v, t) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'scope', value: v, checked: (v === 'all') === all, onchange: () => { all = v === 'all'; propList.hidden = all; } }), h('span', null, t));
    const err = h('div', { class: 'error', role: 'alert' });
    const save = h('button', { class: 'btn btn--primary btn--sm', type: 'submit', 'aria-label': 'Save notifications' }, 'Save');
    card.replaceChildren(
      h('div', { class: 'card__head' }, h('h2', null, 'Notifications')),
      h('form', {
        class: 'stack',
        onsubmit: async (e) => {
          e.preventDefault(); err.textContent = '';
          const types = Object.fromEntries(boxes.map((b) => [b.querySelector('input').name, b.querySelector('input').checked]));
          const body = { types };
          if (showProps) {
            body.property_ids = all ? null : propBoxes.filter((b) => b.querySelector('input').checked).map((b) => b.querySelector('input').value);
            if (!all && !body.property_ids.length) { err.textContent = 'Pick at least one property, or choose all properties.'; return; }
          }
          save.disabled = true;
          try { await patch('/account/notify-prefs', body); toast('Notification settings saved.'); } catch (ex) { err.textContent = ex.fields.property_ids || ex.fields.types || ex.message; } finally { save.disabled = false; }
        },
      },
      h('p', { class: 'muted small' }, 'Choose which alerts reach you by push or email.'),
      h('div', { class: 'stack' }, boxes),
      showProps && h('fieldset', { class: 'hp-fieldset' }, h('legend', null, 'Properties'),
        h('div', { class: 'stack' }, radio('all', 'All properties'), radio('some', 'Only these properties'), propList)),
      err, h('div', null, save)));
  }
  load();
  return card;
}

export async function accountView(el, { rerender }) {
  const d = await get('/account/profile');
  const { user: u, workspace: w } = d;
  const isOwner = w?.role === 'owner';
  const roleText = !w ? '' : isOwner ? OWNER_TEXT
    : (w.business_type === 'long_term' ? ROLE_TEXT.long_term : ROLE_TEXT.short_term)[w.role];
  const initials = u.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
  const cardDue = Boolean(w?.plan?.card_check_due);
  const others = d.sessions.filter((s) => !s.current);
  // Only a subscription on this device counts for "on this device"; the server's answer alone may be another device's.
  u.notifications_on = u.notifications_on && await thisDeviceSubscribed();

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
        h('h1', null, 'My account'),
        h('h2', { class: 'acct-hero__name' }, u.full_name),
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
            w.members != null && [h('dt', null, 'Team'), h('dd', null, `${w.members} member${w.members === 1 ? '' : 's'}`)],
            d.owner && [h('dt', null, 'Workspace owner'), h('dd', null, d.owner.full_name, h('div', { class: 'muted small' }, d.owner.email))]),
          h('div', { class: 'chips', style: { marginTop: '12px' } },
            isOwner && cardDue && h('a', { class: 'btn btn--primary btn--sm', href: '#/confirm-card' }, 'Confirm your card'),
            isOwner && !cardDue && h('a', { class: 'btn btn--secondary btn--sm', href: '#/settings' }, w.plan?.plan === 'trial' || w.plan?.read_only ? 'Choose a plan' : 'Plan & billing'),
            isOwner && !cardDue && h('a', { class: 'btn btn--secondary btn--sm', href: '#/settings' }, 'Manage team'),
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
              : h('button', { class: 'btn btn--secondary btn--sm', 'aria-label': `Sign out ${s.device}, signed in ${fmtDateTime(s.created_at)}`, onclick: signOutDevice(s) }, 'Sign out')))))),
          d.sessions.length > 5 && h('button', { class: 'flt__clear', style: { marginTop: '6px' }, onclick: (e) => { e.currentTarget.closest('.card').querySelectorAll('.acct-more').forEach((li) => { li.hidden = false; }); e.currentTarget.remove(); } }, `Show ${d.sessions.length - 5} more`),
          others.length > 1 && h('button', { class: 'btn btn--secondary btn--sm', style: { marginTop: '10px' }, onclick: signOutOthers }, 'Sign out all other devices'),
          h('p', { class: 'muted small', style: { marginTop: '10px' } }, 'Don’t recognise a device? Sign it out and change your password.')),

        w && notifyCard(w.role),

        h('div', { class: 'card' },
          h('div', { class: 'card__head' }, h('h2', null, 'Preferences')),
          h('div', { class: 'acct-pref' }, h('span', null, 'Appearance'), themeSwitch()),
          // A monthly-rental workspace has no alert types yet (DECISIONS 596, APP-FLOW 833): no Turn on link, "On · manage" only if a device is already on.
          h('div', { class: 'acct-pref' }, h('span', null, 'Notifications on this device'),
            w?.business_type === 'long_term' && !u.notifications_on
              ? h('span', { class: 'muted' }, 'Not available yet for monthly rentals')
              : h('a', { class: 'link-tap', href: '#/settings' }, u.notifications_on ? 'On · manage' : 'Turn on'))),

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
              h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, actionText(a.action)), h('span', { class: 'row__sub' }, fmtDateTime(a.created_at)))))))
            : h('p', { class: 'muted' }, 'Nothing yet.')))),
  );
}
