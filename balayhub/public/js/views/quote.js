// Guest's quote page (#/quote/:token): the host's offer, house rules, details and the pay button.

import { get, post, ApiError } from '../api.js';
import { h, brand, field, readForm, clearErrors, showErrors, EMAIL_RE } from '../ui.js';
import { t, tServer, tFields, guestLang, initGuestLang, langToggle, extendTranslations, fmtDateL as fmtDate, fmtDateTimeL } from '../i18n.js';

// The same mobile rule as book.js (and the server), kept local so this page loads on its own.
const PHONE_RE = /^[+\d][\d\s()-]{6,19}$/;

extendTranslations({
  'Too many attempts': 'Napakaraming subok',
  'Something went wrong': 'May nagkaproblema',
  'Please enter your full name.': 'Ilagay ang buong pangalan mo.',
  'Please enter your mobile number.': 'Ilagay ang mobile number mo.',
  'Enter a valid email address.': 'Maglagay ng tamang email address.',
  'Your quote': 'Quote mo',
  'Quote from {host}': 'Quote mula kay {host}',
  'Accommodation': 'Tuluyan',
  'Discount': 'Discount',
  'Add-ons': 'Mga add-on',
  'Total': 'Kabuuan',
  'Due now': 'Babayaran ngayon',
  'Balance, due before check-in': 'Natitira, bayaran bago mag-check-in',
  'Note from {host}': 'Mensahe mula kay {host}',
  'This offer is valid until {date}.': 'Valid ang offer na ito hanggang {date}.',
  'Your dates are held only when you pay.': 'Hawak lang ang dates mo kapag nabayaran na.',
  'This offer has expired': 'Expired na ang offer na ito',
  'Please ask {host} for a new quote.': 'Humingi ng bagong quote kay {host}.',
  'This quote was cancelled': 'Kinansela ang quote na ito',
  'The host cancelled this offer. Please contact them if you have questions.': 'Kinansela ng host ang offer na ito. Makipag-ugnayan sa kanila kung may tanong.',
  'This quote is already paid': 'Bayad na ang quote na ito',
  'Your stay is booked. Booking code: {code}': 'Naka-book na ang stay mo. Booking code: {code}',
  'Your stay is booked.': 'Naka-book na ang stay mo.',
  'Quote not found': 'Hindi mahanap ang quote',
  'Your details': 'Details mo',
  'Pay {amount}': 'Bayaran ang {amount}',
  'Opening secure payment…': 'Binubuksan ang secure payment…',
  'Full name': 'Buong pangalan',
  'Email': 'Email',
  'Mobile number': 'Mobile number',
  'We send your confirmation here.': 'Dito namin ipapadala ang confirmation.',
  'House rules': 'House rules',
  'I agree that my details are shared with {host} to manage my booking (see the ': 'Sumasang-ayon ako na ibabahagi ang details ko kay {host} para sa booking ko (tingnan ang ',
  'I agree to the house rules': 'Sumasang-ayon ako sa house rules',
  'Please read and agree to the house rules.': 'Basahin at sang-ayunan ang house rules.',
  'Something went wrong. Please try again.': 'May mali. Subukan ulit.',
  '{n} nights': '{n} na gabi',
  '1 night': '1 gabi',
  'Loading…': 'Naglo-load…',
  'the host': 'ang host',
  'Please check the highlighted fields.': 'Pakitingnan ang mga naka-highlight.',
});

// Only a 404 is a bad link; a rate limit or a server error says so instead.
const failTitle = (err) => (err.status === 404 ? t('Quote not found') : err.status === 429 ? t('Too many attempts') : t('Something went wrong'));

// Every amount on this page is owed, charged or totalled, so it always shows two decimals (D-86).
const peso = (v) => { const n = Number(v || 0); return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
// What the guest has typed in the details form. A language switch rebuilds the whole page, so this is handed to the redraw.
const typedDetails = (el) => {
  const f = el.querySelector('form.form');
  return f ? readForm(f) : {};
};

export async function quoteView(el, { params, kept = {} }) {
  initGuestLang();
  const token = encodeURIComponent(params.token);
  let q = null;
  const redraw = () => quoteView(el, { params, kept: typedDetails(el) });
  const shell = (host, ...children) => h('div', { class: 'bk' },
    h('header', { class: 'bk__top' }, h('div', { class: 'bk__wrap bk__top-inner' },
      h('span', { class: 'bk__host' }, host || t('Your quote')),
      h('span', { class: 'bk__right' }, langToggle(redraw), h('span', { class: 'bk__powered' }, t('Secure booking by '), brand(null))))),
    h('main', { class: 'bk__wrap bk__main bk-quote', id: 'main' }, children),
    h('footer', { class: 'bk__wrap bk__foot muted small' }, q?.status === 'open' && t('Payments are processed securely by PayMongo. '), h('a', { href: '#/privacy' }, t('Privacy notice'))));
  const stateCard = (host, title, body, tick) => el.replaceChildren(shell(host, h('div', { class: 'card bk-done' },
    tick && h('div', { class: 'gc__tick', 'aria-hidden': 'true' }, '✓'), h('h1', null, title), body && h('p', { class: 'muted' }, body))));

  el.replaceChildren(shell(null, h('div', { class: 'card', 'aria-busy': 'true' }, h('p', { class: 'muted' }, t('Loading…')))));
  try { q = await get(`/public/quote/${token}`); } catch (err) {
    if (err.code === 'QUOTE_EXPIRED' || err.status === 410) {
      const hostName = err.data?.host?.name || t('the host');
      stateCard(null, t('This offer has expired'), t('Please ask {host} for a new quote.', { host: hostName }));
    } else stateCard(null, failTitle(err), tServer(err.message));
    return;
  }
  const host = q.host.name;
  initGuestLang(q.host.guest_language);
  document.title = `${t('Quote from {host}', { host })}`;
  if (q.status === 'expired') return stateCard(host, t('This offer has expired'), t('Please ask {host} for a new quote.', { host }));
  if (q.status === 'cancelled') return stateCard(host, t('This quote was cancelled'), t('The host cancelled this offer. Please contact them if you have questions.'));
  if (q.status === 'paid') return stateCard(host, t('This quote is already paid'), q.booking_code ? t('Your stay is booked. Booking code: {code}', { code: q.booking_code }) : t('Your stay is booked.'), true);

  const unit = q.listing;
  const rules = unit.house_rules;
  const total = Number(q.total_amount);
  const due = Number(q.amount_due_now);
  const addons = q.addons;
  const formError = h('div');
  const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, t('Pay {amount}', { amount: peso(due) }));
  const form = h('form', { class: 'form', novalidate: true }, formError,
    h('h2', null, t('Your details')),
    field({ name: 'name', label: t('Full name'), required: true, maxlength: 120, autocomplete: 'name', value: kept.name ?? (q.guest_name || '') }),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'email', label: t('Email'), type: 'email', required: true, autocomplete: 'email', value: kept.email ?? (q.guest_email || ''), hint: t('We send your confirmation here.') }),
      field({ name: 'phone', label: t('Mobile number'), type: 'tel', required: true, inputmode: 'tel', autocomplete: 'tel', placeholder: '0917 123 4567', value: kept.phone ?? (q.guest_phone || '') })),
    rules && h('div', { class: 'field bk-rules', dataset: { field: 'accept_rules' } },
      h('strong', { id: 'bk-rules-h' }, t('House rules')),
      h('div', { class: 'bk-rules__text', tabindex: 0, role: 'region', 'aria-labelledby': 'bk-rules-h' }, rules),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'accept_rules', checked: Boolean(kept.accept_rules) }), h('span', null, t('I agree to the house rules'))),
      h('div', { class: 'error', role: 'alert' })),
    h('div', { class: 'field', dataset: { field: 'consent' } },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'consent', checked: Boolean(kept.consent) }),
        h('span', null, t('I agree that my details are shared with {host} to manage my booking (see the ', { host }), h('a', { href: '#/privacy', target: '_blank' }, t('privacy notice')), ').')),
      h('div', { class: 'error', role: 'alert' })),
    submit);
  let busy = false;
  // A field's message clears as soon as the guest changes that field (a checkbox, when ticked); the banner goes with the last marked field.
  const clearFieldError = (e) => {
    const wrap = e.target.closest?.('[data-field]');
    if (!wrap?.classList.contains('field--invalid')) return;
    wrap.classList.remove('field--invalid');
    wrap.querySelectorAll('[aria-invalid]').forEach((f) => f.removeAttribute('aria-invalid'));
    const err = wrap.querySelector('.error');
    if (err) err.textContent = '';
    if (!form.querySelector('.field--invalid')) formError.replaceChildren();
  };
  form.addEventListener('input', clearFieldError);
  form.addEventListener('change', clearFieldError);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    clearErrors(form);
    formError.replaceChildren();
    // Everything is checked in one pass so the guest sees every problem at once; the server stays the judge.
    const v = readForm(form);
    const problems = {};
    if (!String(v.name || '').trim()) problems.name = t('Please enter your full name.');
    if (!String(v.email || '').trim()) problems.email = tServer('Email is required.');
    else if (!EMAIL_RE.test(String(v.email).trim())) problems.email = t('Enter a valid email address.');
    if (!String(v.phone || '').trim()) problems.phone = t('Please enter your mobile number.');
    else if (!PHONE_RE.test(String(v.phone).trim())) problems.phone = tServer('Enter a valid phone number.');
    if (rules && !form.elements.accept_rules.checked) problems.accept_rules = t('Please read and agree to the house rules.');
    if (!form.elements.consent.checked) problems.consent = tServer('Please agree to continue.');
    if (Object.keys(problems).length) { formError.replaceChildren(h('div', { class: 'alert alert--error', role: 'alert' }, t('Please check the highlighted fields.'))); showErrors(form, problems); return; }
    busy = true;
    // aria-disabled, not disabled: a disabled control drops focus to the page while it waits (D-97, D-105, D-120).
    submit.setAttribute('aria-disabled', 'true');
    submit.textContent = t('Opening secure payment…');
    try {
      const r = await post(`/public/quote/${token}/checkout`, { name: v.name, email: v.email, phone: v.phone, accept_rules: rules ? true : undefined, consent: true });
      location.href = r.checkout_url;
    } catch (err) {
      if (err.code === 'QUOTE_EXPIRED' || err.status === 410) { redraw(); return; }
      // Each message shows once: one whose field is on the form sits at that field; the banner names only the rest.
      const unplaced = err.fields ? showErrors(form, tFields(err.fields)) : [];
      const banner = !(err instanceof ApiError) ? t('Something went wrong. Please try again.')
        : unplaced.length ? unplaced.join(' ')
        : Object.keys(err.fields || {}).length ? t('Please check the highlighted fields.')
        : tServer(err.message);
      formError.replaceChildren(h('div', { class: 'alert alert--error', role: 'alert' }, banner));
      submit.removeAttribute('aria-disabled');
      submit.textContent = t('Pay {amount}', { amount: peso(due) });
      busy = false;
    }
  });
  const row = (k, v, strong) => [h('dt', null, k), h('dd', null, strong ? h('strong', null, v) : v)];
  el.replaceChildren(shell(host,
    h('h1', { class: 'bk-title' }, t('Quote from {host}', { host })),
    h('div', { class: 'card bk-quote__offer' },
      h('h2', null, unit.unit_name),
      h('p', { class: 'muted' }, [unit.property_name, unit.city].filter(Boolean).join(', ')),
      h('dl', { class: 'dl' },
        row(t('Dates'), `${fmtDate(q.check_in)} – ${fmtDate(q.check_out)}`),
        row(t('Guests'), String(q.num_guests)),
        row(t('Accommodation'), peso(q.accommodation_total)),
        Number(q.cleaning_fee) > 0 && row(t('Cleaning fee'), peso(q.cleaning_fee)),
        ...addons.map((a) => {
          const name = (guestLang() === 'tl' && a.name_tl) || a.name;
          return row(`${name}${Number(a.quantity) > 1 ? ` × ${a.quantity}` : ''}`, peso(a.amount));
        }),
        Number(q.discount_amount) > 0 && row(t('Discount'), `− ${peso(q.discount_amount)}`),
        row(t('Total'), peso(total), true),
        row(t('Due now'), peso(due), true),
        due < total && row(t('Balance, due before check-in'), peso(total - due))),
      q.note && h('div', { class: 'bk-policy' }, h('strong', null, t('Note from {host}', { host })), h('p', { class: 'small bk-quote__note' }, q.note)),
      h('p', { class: 'alert alert--warn', role: 'status' }, t('This offer is valid until {date}.', { date: fmtDateTimeL(q.expires_at) }), ' ', t('Your dates are held only when you pay.'))),
    h('div', { class: 'card' }, form)));
}
