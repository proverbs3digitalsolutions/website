// Privacy Notice. Draft text — to be reviewed by a qualified Philippine privacy
// professional before launch (see docs/PRIVACY-CHECKLIST.md).

import { get } from '../api.js';
import { h, brand } from '../ui.js';
import { state, homeRoute } from '../app.js';
import { t, extendTranslations } from '../i18n.js';

// Taglish for the contact line only; the notice itself is the English legal text.
extendTranslations({
  'For privacy questions or requests, contact your host, or ': 'Para sa tanong o request tungkol sa privacy, kontakin ang host mo, o ',
  'Create your account': 'Gawin ang account mo',
  ' and ask us in Help & support.': ' at magtanong sa Help & support.',
});

export async function privacyView(el) {
  let contact = '';
  try { contact = (await get('/public/plans')).contact_email || ''; } catch { /* ignore */ }
  const section = (title, ...paras) => [h('h2', null, title), ...paras.map((p) => (Array.isArray(p) ? h('ul', null, p.map((li) => h('li', null, li))) : typeof p === 'string' ? h('p', null, p) : p))];
  el.append(h('div', { class: 'public' },
    h('header', { class: 'public__top' }, brand(state.user ? homeRoute() : '#/'), h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => (history.length > 1 ? history.back() : (location.hash = state.user ? '#/settings' : '#/')) }, 'Back')),
    h('main', { class: 'content', id: 'main' }, h('article', { class: 'card prose' },
      h('h1', null, 'BalayHub Privacy Notice'),
      h('p', { class: 'muted' }, 'Version 2026-10-13 · Draft pending review by a Philippine data privacy professional.'),
      ...section('Who we are',
        'BalayHub is a rental property management service. For the records a host, landlord or property manager keeps about their own guests and tenants, that business is the personal information controller and BalayHub processes the data on their behalf. For your own account details, BalayHub is the controller.'),
      ...section('If you are a guest',
        ['Booking: when you book on a host’s BalayHub booking page we collect your name, email, mobile number, number of guests, dates and any message you write, and share them with that host to manage your stay.',
          'Payments: online payments are processed by PayMongo using the host’s own PayMongo account. BalayHub never sees or stores your card details; we keep the amount, method and payment reference.',
          'Guest check-in form: the names of everyone staying, arrival time, vehicle plate and photos of valid IDs, used to register your stay with the building. ID photos are deleted from BalayHub a set number of days after check-out (30 by default).',
          'Building admin: if the host uses the gate pass feature, your group’s names, dates, plate number and ID photos are sent to the building’s admin or security office through a private link that stops working the day after check-out (or, if the host chooses, as email attachments). Copies kept by the building follow the building’s own rules.',
          'Reviews: if you rate your stay, your rating and comment are visible only to the host and their team.']),
      ...section('What we collect',
        ['Account details: your name, email address, password (stored only as a secure hash), role, and sign-in activity.',
          'Records you enter about your rentals: properties, units, tenant names and contact details, lease terms, rent charges, payments, expenses, repair requests, and attachments such as signed leases and receipts.',
          'Technical data needed to run the service securely, such as session cookies and security logs.']),
      ...section('Why we use it',
        ['To provide the service: store your records, calculate balances and reports, and control who can access them.',
          'To keep accounts secure: email verification, password recovery, access logs and audit history.',
          'To send transactional emails you need, such as verification and password reset links.',
          'We do not sell personal data or use tenant data for advertising.']),
      ...section('Lawful basis',
        'We process account data to perform our agreement with you. Landlords process tenant data for the legitimate purpose of managing a lease and keeping financial records, and must have their own lawful basis under the Data Privacy Act of 2012 (Republic Act No. 10173). Where consent is the basis for an activity, we will ask for it specifically and you can withdraw it.'),
      ...section('Who can see it',
        'Only members of your workspace, according to their role. Property managers and staff see only the properties assigned to them; staff do not see tenant contact details or lease documents. Our hosting, database, storage and email providers process data only to run the service, under agreements that require them to protect it. If a host uses AI reply drafts, that guest conversation and its reservation details are sent to our AI provider (Anthropic) to write the draft; they are not used to train AI models.'),
      ...section('How we protect it',
        'Encrypted connections, hashed passwords, server-enforced access controls on every request, private file storage with permission-checked downloads, audit logs of important changes, and regular backups.'),
      ...section('How long we keep it',
        'Financial records (payments, expenses, leases) are archived instead of deleted so your books stay complete; they are kept while your workspace is active and for the period required by applicable tax and accounting rules. When a workspace is closed, data is securely deleted after the retention period unless the law requires otherwise.'),
      ...section('Your rights',
        'Under the Data Privacy Act you may request access to, correction of, or deletion or blocking of your personal data, object to processing, and file a complaint with the National Privacy Commission. Tenants should contact their landlord first; the landlord can export the tenant’s record from BalayHub to respond.'),
      ...section('Contact',
        contact ? `For privacy questions or requests, contact the BalayHub Data Protection Officer at ${contact}. Guests can also contact their host directly.`
          // No contact email yet: visitors create an account, then ask in Help & support (sign-up, not the log-in wall).
          : h('p', null, t('For privacy questions or requests, contact your host, or '), h('a', { href: '#/signup' }, t('Create your account')), t(' and ask us in Help & support.')))))));
}
