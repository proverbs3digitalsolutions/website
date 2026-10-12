// Settings: account, team access (owner), audit history and privacy.

import { get, post, patch } from '../api.js';
import { h, icon, label, field, formModal, confirmDialog, emptyState, pageHead, toast, fmtDateTime, openModal } from '../ui.js';
import { state, refreshUser } from '../app.js';

function propertyChecks(properties, selected = []) {
  return h('fieldset', { class: 'field', dataset: { field: 'property_ids' }, style: { border: 0, padding: 0, margin: 0 } },
    h('legend', null, 'Properties they can access'),
    properties.length ? h('div', { class: 'checks' }, properties.map((p) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', name: 'property_ids', value: p.property_id, checked: selected.includes(p.property_id), dataset: { multi: '1' } }),
      h('span', null, p.property_name))))
      : h('p', { class: 'muted small' }, 'Add properties first, then assign them here.'),
    h('div', { class: 'error', role: 'alert' }));
}

const ROLE_HELP = {
  manager: 'Manages assigned properties: tenants, leases, rent, expenses, repairs and reports.',
  staff: 'Records payments, expenses and repair requests for assigned properties. No access to tenant contact details or lease documents.',
};

export async function settingsView(el, { rerender }) {
  const u = state.user;
  const sections = [];

  sections.push(h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Your account')),
    h('dl', { class: 'dl' },
      h('dt', null, 'Name'), h('dd', null, u.full_name),
      h('dt', null, 'Email'), h('dd', null, u.email),
      h('dt', null, 'Workspace'), h('dd', null, u.organization_name),
      h('dt', null, 'Role'), h('dd', null, label(u.role))),
    h('p', { class: 'muted small', style: { marginTop: '12px' } }, 'To change your password, log out and use “Forgot password”.'),
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

  if (u.role === 'owner') {
    const [{ members, invitations }, { properties }] = await Promise.all([get('/team'), get('/properties')]);
    const propName = (id) => properties.find((p) => p.property_id === id)?.property_name || 'Archived property';

    const invite = () => formModal({
      title: 'Invite a team member',
      submitText: 'Create invitation',
      fields: [
        field({ name: 'email', label: 'Their email', type: 'email', required: true }),
        field({ name: 'role', label: 'Role', type: 'select', required: true, value: 'manager', placeholderOption: false, options: [['manager', 'Property manager'], ['staff', 'Staff / accountant']], hint: `${ROLE_HELP.manager} Staff: ${ROLE_HELP.staff}` }),
        propertyChecks(properties),
      ],
      onSubmit: async (data) => {
        const res = await post('/team/invitations', { ...data, property_ids: data.property_ids || [] });
        showInviteLink(res);
        rerender();
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
        field({ name: 'role', label: 'Role', type: 'select', value: m.role, placeholderOption: false, options: [['manager', 'Property manager'], ['staff', 'Staff / accountant']] }),
        propertyChecks(properties, m.property_ids),
      ],
      onSubmit: async (data) => { await patch(`/team/members/${m.user_id}`, { role: data.role, property_ids: data.property_ids || [] }); toast('Access updated.'); rerender(); },
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
          h('span', { class: 'row__sub' }, `${m.email} · ${label(m.role)}`),
          m.role !== 'owner' && h('span', { class: 'row__sub' }, m.property_ids.length ? `Access: ${m.property_ids.map(propName).join(', ')}` : 'No properties assigned yet')),
        m.role !== 'owner' && h('div', { class: 'row__end' }, h('div', { class: 'chips' },
          h('button', { class: 'btn btn--secondary btn--sm', onclick: () => editMember(m) }, 'Edit access'),
          h('button', { class: 'btn btn--ghost btn--sm', onclick: () => removeMember(m) }, 'Remove'))))))),
      invitations.length > 0 && [h('h3', { style: { margin: '16px 0 6px' } }, 'Pending invitations'),
        h('ul', { class: 'list' }, invitations.map((i) => h('li', null, h('div', { class: 'row' },
          h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, i.email), h('span', { class: 'row__sub' }, `${label(i.role)} · expires ${fmtDateTime(i.expires_at)}`)),
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
    h('p', null, 'BalayHub stores tenant and property records to help you manage your rentals. Collect only what you need. Owners can export a tenant’s data from their profile to answer access requests under the Data Privacy Act.'),
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
