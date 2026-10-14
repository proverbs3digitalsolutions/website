// Terms of Service. Draft text — to be reviewed by a Philippine lawyer before
// launch (see docs/PRIVACY-CHECKLIST.md).

import { get } from '../api.js';
import { h, brand } from '../ui.js';
import { state } from '../app.js';
import { t, extendTranslations } from '../i18n.js';

// Taglish for the contact line only; the terms themselves are the English legal text.
extendTranslations({
  'Questions about these terms: ': 'May tanong tungkol sa mga terms na ito: ',
  'Questions about these terms? ': 'May tanong tungkol sa mga terms na ito? ',
  'Create your account': 'Gawin ang account mo',
  ' and ask us in Help & support.': ' at magtanong sa Help & support.',
});

export async function termsView(el) {
  let contact = '';
  try { contact = (await get('/public/plans')).contact_email || ''; } catch { /* ignore */ }
  const section = (title, ...paras) => [h('h2', null, title), ...paras.map((p) => (Array.isArray(p) ? h('ul', null, p.map((li) => h('li', null, li))) : typeof p === 'string' ? h('p', null, p) : p))];
  el.append(h('div', { class: 'public' },
    h('header', { class: 'public__top' }, brand(state.user ? '#/home' : '#/'), h('a', { class: 'btn btn--secondary btn--sm', href: state.user ? '#/settings' : '#/signup' }, 'Back')),
    h('main', { class: 'content', id: 'main' }, h('article', { class: 'card prose' },
      h('h1', null, 'BalayHub Terms of Service'),
      h('p', { class: 'muted' }, 'Version 2026-10-13 · Draft pending review by a Philippine lawyer.'),
      ...section('1. About these terms',
        'BalayHub is an online service for managing short-term and long-term rentals, operated by PROVERBS3 Digital Solutions ("we", "us"). By creating an account or using BalayHub you agree to these terms. If you use BalayHub for a business, you confirm you may accept them on its behalf.'),
      ...section('2. Your account',
        ['Keep your password safe and tell us right away if you think someone else has used your account.',
          'The owner of a workspace is responsible for the people they invite and the access they give them.',
          'You must give accurate information and be at least 18 years old.']),
      ...section('3. Free trial and plans',
        ['New workspaces get a free trial. After it ends, the workspace becomes view-only until a plan is chosen; your data is not deleted.',
          'Plans are paid in advance for the period you choose (1, 3 or 12 months). Prices are shown in Philippine pesos and may change; changes apply from your next payment.',
          'If a payment is not renewed, the workspace becomes view-only 7 days after the paid period ends.',
          'Payments are processed by PayMongo or another payment provider under their own terms. We never see or store your card details.']),
      ...section('4. Cancellations and refunds',
        'You can stop paying at any time; your plan simply runs until the end of the paid period. Payments are generally not refundable, except where required by law or if we fail to provide the service you paid for. Contact us if you think you were charged by mistake.'),
      ...section('5. Your data',
        ['You own the data you put into BalayHub, including your guests\' and tenants\' details. You are responsible for having a lawful basis to collect and use it under the Data Privacy Act of 2012 (RA 10173), and for telling your guests and tenants how you use it.',
          'We process that data only to provide the service, as described in our Privacy Notice.',
          'You can export all your data at any time from Settings, and you can ask us to delete your workspace. Deletion is permanent after a 14-day grace period.']),
      ...section('6. Acceptable use',
        ['Do not use BalayHub for anything illegal, to send spam, or to harass anyone.',
          'Do not try to access other workspaces\' data, break or overload the service, or get around plan limits.',
          'We may suspend an account that breaks these rules, after notice where reasonable.']),
      ...section('7. Third-party services',
        'BalayHub connects with services you choose, such as Airbnb, Booking.com and Agoda calendars, Google sign-in, email providers, PayMongo and AI providers. Those services have their own terms, and we are not responsible for their availability or for errors in data they send us (for example a calendar that does not update).'),
      ...section('8. Availability and changes',
        'We work to keep BalayHub available and your data backed up, but we do not guarantee it will always be available or error-free. We may improve or change features; if we make a change that significantly reduces what you paid for, you may ask for a pro-rated refund of the unused period.'),
      ...section('9. Limitation of liability',
        'To the extent allowed by law, we are not liable for indirect losses such as lost bookings, lost profits or double bookings caused by channel calendar delays. Our total liability for any claim is limited to the amount you paid us in the 3 months before the claim.'),
      ...section('10. Ending your use',
        'You can stop using BalayHub at any time and delete your workspace from Settings. We may end the service for a workspace with at least 30 days\' notice, giving you time to export your data.'),
      ...section('11. Governing law',
        'These terms are governed by the laws of the Republic of the Philippines. Disputes will be handled by the proper courts of the Philippines.'),
      ...section('12. Contact',
        contact
          ? h('p', null, t('Questions about these terms: '), h('a', { href: `mailto:${contact}` }, contact), '.')
          // No contact email yet: visitors create an account, then ask in Help & support (sign-up, not the log-in wall).
          : h('p', null, t('Questions about these terms? '), h('a', { href: '#/signup' }, t('Create your account')), t(' and ask us in Help & support.')))))));
}
