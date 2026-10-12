// Public landing page: what BalayHub does, pricing, FAQ, free trial and live demo.

import { get, post } from '../api.js';
import { h, brand, icon, toast } from '../ui.js';
import { refreshUser, navigate, homeRoute } from '../app.js';

export async function tryDemo(e) {
  const btn = e?.currentTarget;
  if (btn) { btn.disabled = true; btn.textContent = 'Opening demo…'; }
  try {
    await post('/auth/demo');
    await refreshUser();
    navigate(homeRoute(), { replace: true });
  } catch (err) {
    toast(err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Try the live demo'; }
  }
}

const peso = (n) => `₱${Number(n).toLocaleString('en-PH')}`;

// A small illustrated multi-calendar (decorative).
function heroCalendar() {
  const rows = [
    ['Paris 1208', [[0, 3, 'airbnb', 'Rafael D.'], [3, 5, 'direct', 'Emily L.']]],
    ['Rio 2210', [[1, 4, 'booking', 'Katherine S.'], [5, 7, 'airbnb', 'Peter T.']]],
    ['Tower 3 · 1815', [[0, 2, 'agoda', 'Laura G.'], [2, 6, 'direct', 'Archer C.']]],
    ['Loft A · Tagaytay', [[2, 5, 'airbnb', 'Mika V.']]],
  ];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return h('div', { class: 'lp-cal', 'aria-hidden': 'true' },
    h('div', { class: 'lp-cal__row lp-cal__row--head' }, h('span', null, ''), days.map((d) => h('span', null, d))),
    rows.map(([name, stays]) => h('div', { class: 'lp-cal__row' },
      h('span', { class: 'lp-cal__name' }, name),
      h('div', { class: 'lp-cal__track' }, stays.map(([s, e, ch, guest]) => h('span', {
        class: `lp-cal__bar lp-cal__bar--${ch}`, style: { '--s': s, '--e': e },
      }, guest))))),
    h('div', { class: 'lp-cal__legend' },
      [['airbnb', 'Airbnb'], ['booking', 'Booking.com'], ['agoda', 'Agoda'], ['direct', 'Direct']].map(([k, t]) => h('span', null, h('i', { class: `lp-dot lp-cal__bar--${k}` }), t))));
}

const FEATURES = [
  ['calendar', 'One calendar for every channel', 'Airbnb, Booking.com and Agoda calendars sync into one multi-calendar, and your direct bookings sync back out. No more double bookings.'],
  ['inbox', 'Guest inbox', 'Message guests by email from one inbox. Save replies as templates and let check-in instructions and thank-you notes send themselves.'],
  ['sparkle', 'AI reply drafts', 'One tap writes a friendly reply in English, Tagalog or Taglish using your listing details. You read and edit before sending.'],
  ['home', 'Housekeeping', 'A cleaning task for every check-out with a checklist and photos. Cleaners use their phone, or you send it to them on Messenger.'],
  ['cash', 'Payments & receipts', 'Record GCash, Maya, bank and cash payments, see who still owes, and email numbered receipts and booking confirmations.'],
  ['chart', 'Reports that make sense', 'Revenue, occupancy, average nightly rate and expenses per listing, so you know which unit is really earning.'],
];

const FAQ = [
  ['Does it connect to my Airbnb account?', 'BalayHub syncs calendars with Airbnb, Booking.com and Agoda using their calendar (iCal) links, which every host can set up in a few minutes. Guest messages on Airbnb stay on Airbnb; BalayHub\'s inbox is for guests you reach by email, including direct bookings.'],
  ['Is my guests\' data safe?', 'Your data is stored on a private server, every page requires a login, and each team member only sees the properties you assign. BalayHub follows the Philippine Data Privacy Act (RA 10173), and you can export or delete your data at any time.'],
  ['What happens when the free trial ends?', 'Nothing is deleted. Your workspace becomes view-only until you choose a plan, so you can still see and export everything.'],
  ['How do I pay?', 'Monthly, by GCash, Maya or bank transfer. Message us when you\'re ready and we\'ll activate your plan.'],
  ['Can my co-host or cleaner use it?', 'Yes. Invite a manager or staff member and choose which properties they can see. Staff never see guests\' phone numbers or email addresses.'],
  ['Do I need to install anything?', 'No. BalayHub runs in your phone or computer browser. On a phone you can add it to your home screen like an app.'],
];

export async function landingView(el) {
  let pricing = { plans: [], trial_days: 14, contact_email: '' };
  try { pricing = await get('/public/plans'); } catch { /* show the page without prices */ }
  const trialDays = pricing.trial_days || 14;

  el.append(h('div', { class: 'lp' },
    h('header', { class: 'lp-top' },
      h('div', { class: 'lp-wrap lp-top__inner' },
        brand('#/'),
        h('nav', { class: 'lp-top__nav', 'aria-label': 'Main' },
          h('a', { href: '#features', class: 'lp-hide-sm', onclick: (e) => { e.preventDefault(); document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }); } }, 'Features'),
          h('a', { href: '#pricing', class: 'lp-hide-sm', onclick: (e) => { e.preventDefault(); document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' }); } }, 'Pricing'),
          h('a', { href: '#/login' }, 'Log in'),
          h('a', { class: 'btn btn--primary btn--sm', href: '#/signup' }, 'Start free trial')))),
    h('main', { id: 'main' },
      h('section', { class: 'lp-hero' },
        h('div', { class: 'lp-wrap lp-hero__inner' },
          h('div', { class: 'lp-hero__copy' },
            h('p', { class: 'lp-eyebrow' }, 'For Airbnb and staycation hosts in the Philippines'),
            h('h1', null, 'Run all your units from ', h('span', null, 'one calendar.')),
            h('p', { class: 'lp-lead' }, 'BalayHub brings your Airbnb, Booking.com, Agoda and direct bookings together, with a guest inbox, cleaning schedule, GCash payments and receipts. Made for hosts with 1 to 10 units.'),
            h('div', { class: 'lp-cta' },
              h('a', { class: 'btn btn--primary', href: '#/signup' }, `Start your ${trialDays}-day free trial`),
              h('button', { class: 'btn btn--secondary', type: 'button', onclick: tryDemo }, 'Try the live demo')),
            h('p', { class: 'lp-small' }, 'No credit card needed. Works on your phone.')),
          heroCalendar())),
      h('section', { class: 'lp-section', id: 'features' },
        h('div', { class: 'lp-wrap' },
          h('h2', { class: 'lp-h2' }, 'Everything a host juggles, in one place'),
          h('p', { class: 'lp-sub' }, 'Stop switching between three host apps, a spreadsheet, a notebook and a dozen chat threads.'),
          h('div', { class: 'lp-features' }, FEATURES.map(([ic, title, text]) => h('div', { class: 'lp-feature' },
            h('span', { class: 'lp-feature__icon' }, icon(ic)), h('h3', null, title), h('p', null, text)))),
          h('p', { class: 'lp-note' }, 'Also have long-term tenants or a boarding house? BalayHub tracks leases, monthly rent and arrears too.'))),
      h('section', { class: 'lp-section lp-section--alt' },
        h('div', { class: 'lp-wrap' },
          h('h2', { class: 'lp-h2' }, 'Set up in an afternoon'),
          h('ol', { class: 'lp-steps' },
            h('li', null, h('strong', null, 'Add your listings'), h('span', null, 'Name, nightly rate, cleaning fee, Wi-Fi and house rules.')),
            h('li', null, h('strong', null, 'Connect your calendars'), h('span', null, 'Paste each listing\'s Airbnb, Booking.com or Agoda calendar link. Bookings appear automatically.')),
            h('li', null, h('strong', null, 'Invite your team'), h('span', null, 'Your co-host and cleaners get their own logins with just the access they need.'))))),
      h('section', { class: 'lp-section', id: 'pricing' },
        h('div', { class: 'lp-wrap' },
          h('h2', { class: 'lp-h2' }, 'Simple monthly pricing'),
          h('p', { class: 'lp-sub' }, `Every plan starts with a ${trialDays}-day free trial with all features. Pay monthly by GCash, Maya or bank transfer.`),
          h('div', { class: 'lp-plans' }, pricing.plans.map((p) => h('div', { class: `lp-plan${p.key === 'growth' ? ' lp-plan--pop' : ''}` },
            p.key === 'growth' && h('span', { class: 'lp-plan__tag' }, 'Most popular'),
            h('h3', null, p.name),
            h('div', { class: 'lp-plan__price' }, peso(p.price), h('span', null, ' / month')),
            h('ul', null,
              h('li', null, `Up to ${p.listings} listing${p.listings === 1 ? '' : 's'}`),
              h('li', null, 'Multi-calendar & channel sync'),
              h('li', null, 'Guest inbox, templates & automatic messages'),
              h('li', null, 'Housekeeping, payments & receipts'),
              h('li', { class: p.ai ? '' : 'lp-no' }, p.ai ? 'AI reply drafts' : 'No AI reply drafts'),
              h('li', null, 'Unlimited team members')),
            h('a', { class: `btn ${p.key === 'growth' ? 'btn--primary' : 'btn--secondary'} btn--block`, href: '#/signup' }, 'Start free trial')))),
          pricing.contact_email && h('p', { class: 'lp-note' }, 'More than 10 units or managing for owners? ', h('a', { href: `mailto:${pricing.contact_email}` }, 'Talk to us'), ' about a custom plan.'))),
      h('section', { class: 'lp-section lp-section--alt' },
        h('div', { class: 'lp-wrap lp-faq' },
          h('h2', { class: 'lp-h2' }, 'Questions hosts ask'),
          FAQ.map(([q, a]) => h('details', null, h('summary', null, q), h('p', null, a))))),
      h('section', { class: 'lp-section lp-final' },
        h('div', { class: 'lp-wrap' },
          h('h2', { class: 'lp-h2' }, 'Spend less time managing and more time hosting.'),
          h('div', { class: 'lp-cta lp-cta--center' },
            h('a', { class: 'btn btn--primary', href: '#/signup' }, 'Start free trial'),
            h('button', { class: 'btn btn--secondary', type: 'button', onclick: tryDemo }, 'Try the live demo'))))),
    h('footer', { class: 'lp-foot' },
      h('div', { class: 'lp-wrap lp-foot__inner' },
        h('span', null, `© ${new Date().getFullYear()} BalayHub`),
        h('a', { href: '#/privacy' }, 'Privacy notice'),
        pricing.contact_email && h('a', { href: `mailto:${pricing.contact_email}` }, pricing.contact_email)))));
}
