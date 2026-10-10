// Privacy Notice. Draft text — to be reviewed by a qualified Philippine privacy
// professional before launch (see docs/PRIVACY-CHECKLIST.md).

import { h, brand } from '../ui.js';
import { state } from '../app.js';

export async function privacyView(el) {
  const section = (title, ...paras) => [h('h2', null, title), ...paras.map((p) => (Array.isArray(p) ? h('ul', null, p.map((li) => h('li', null, li))) : h('p', null, p)))];
  el.append(h('div', { class: 'public' },
    h('header', { class: 'public__top' }, brand(state.user ? '#/dashboard' : '#/'), h('a', { class: 'btn btn--secondary btn--sm', href: state.user ? '#/settings' : '#/signup' }, 'Back')),
    h('main', { class: 'content', id: 'main' }, h('article', { class: 'card prose' },
      h('h1', null, 'BalayHub Privacy Notice'),
      h('p', { class: 'muted' }, 'Version 2026-10-01 · Draft pending review by a Philippine data privacy professional.'),
      ...section('Who we are',
        'BalayHub is a rental property management service. For the records a landlord or property manager keeps about their own tenants, that landlord’s business is the personal information controller and BalayHub processes the data on their behalf. For your own account details, BalayHub is the controller.'),
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
        'Only members of your workspace, according to their role. Property managers and staff see only the properties assigned to them; staff do not see tenant contact details or lease documents. Our hosting, database, storage and email providers process data only to run the service, under agreements that require them to protect it.'),
      ...section('How we protect it',
        'Encrypted connections, hashed passwords, server-enforced access controls on every request, private file storage with permission-checked downloads, audit logs of important changes, and regular backups.'),
      ...section('How long we keep it',
        'Financial records (payments, expenses, leases) are archived instead of deleted so your books stay complete; they are kept while your workspace is active and for the period required by applicable tax and accounting rules. When a workspace is closed, data is securely deleted after the retention period unless the law requires otherwise.'),
      ...section('Your rights',
        'Under the Data Privacy Act you may request access to, correction of, or deletion or blocking of your personal data, object to processing, and file a complaint with the National Privacy Commission. Tenants should contact their landlord first; the landlord can export the tenant’s record from BalayHub to respond.'),
      ...section('Contact',
        'For privacy questions or requests, contact the BalayHub Data Protection Officer at [DPO email — to be set before launch].')))));
}
