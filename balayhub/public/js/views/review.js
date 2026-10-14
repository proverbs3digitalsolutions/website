// Guest's private review page, opened from the thank-you message after their stay.

import { get, post } from '../api.js';
import { h, brand, toast, showErrors, clearErrors } from '../ui.js';
import { t, tServer, initGuestLang, langToggle, keepFormValues, restoreFormValues, fmtDateL as fmtDate, extendTranslations } from '../i18n.js';

extendTranslations({
  'Too many attempts': 'Napakaraming subok',
  'Something went wrong': 'May nagkaproblema',
  'Thank you!': 'Salamat po!',
  'Would you share your experience?': 'Gusto mo bang ibahagi ang karanasan mo?',
  'A public review helps other travellers find {host}. It only takes a minute.': 'Nakakatulong ang public review para mahanap ng ibang biyahero si {host}. Isang minuto lang ito.',
  'Opens in a new tab': 'Bubukas sa bagong tab',
});

// The heading follows the cause: only a 404 is a bad link.
const failTitle = (err) => (err.status === 404 ? t('Link not found') : err.status === 429 ? t('Too many attempts') : t('Something went wrong'));

const LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

function starPicker(name, label, required) {
  let value = 0;
  // Kept in a hidden box so the language switch can carry the stars over (see keepFormValues).
  const store = h('input', { type: 'hidden', name, value: '', dataset: { keep: '' } });
  const buttons = [1, 2, 3, 4, 5].map((n) => h('button', {
    type: 'button', 'aria-label': n === 1 ? t('1 star – {label}', { label: t(LABELS[n]) }) : t('{n} stars – {label}', { n, label: t(LABELS[n]) }), 'aria-pressed': 'false',
    onclick: () => set(n),
  }, '★'));
  const caption = h('span', { class: 'muted small' }, required ? t('Tap a star') : t('Optional'));
  function set(n) { value = n; paint(); }
  function paint() {
    store.value = value ? String(value) : '';
    buttons.forEach((b, i) => { b.classList.toggle('is-on', i < value); b.setAttribute('aria-pressed', String(i + 1 === value)); });
    caption.textContent = value ? t(LABELS[value]) : (required ? t('Tap a star') : t('Optional'));
  }
  const el = h('div', { class: 'field', dataset: { field: name } },
    store, h('label', null, label), h('div', { class: `stars${required ? '' : ' stars--sm'}`, role: 'group', 'aria-label': label }, buttons), caption,
    h('div', { class: 'error', role: 'alert' }));
  return { el, set, store, get: () => value || undefined };
}

export async function guestReviewView(el, { params }, snap) {
  initGuestLang();
  const token = params.token;
  const page = (...children) => h('div', { class: 'gc' },
    h('header', { class: 'gc__top gc__top--lang' }, brand(null), langToggle(() => guestReviewView(el, { params }, keepFormValues(el)))),
    h('main', { class: 'gc__main', id: 'main' }, children),
    h('p', { class: 'gc__foot muted small' }, t('Your feedback goes only to your host. '), h('a', { href: '#/privacy' }, t('Privacy notice'))));
  let d;
  try { d = await get(`/public/review/${encodeURIComponent(token)}`); } catch (err) {
    el.replaceChildren(page(h('div', { class: 'card' }, h('h1', null, failTitle(err)), h('p', { class: 'muted' }, tServer(err.message)))));
    return;
  }
  initGuestLang(d.guest_language);
  const thanks = (links = []) => el.replaceChildren(page(h('div', { class: 'card bk-done' },
    h('div', { class: 'gc__tick', 'aria-hidden': 'true' }, '✓'),
    h('h1', null, t('Thank you!')),
    h('p', { class: 'muted' }, t('Thank you for your feedback. {host} will read it personally. We hope to host you again!', { host: d.host })),
    links.length > 0 && h('section', { class: 'gp-share', 'aria-labelledby': 'share-h' },
      h('h2', { id: 'share-h', style: { width: '100%', textAlign: 'center' } }, t('Would you share your experience?')),
      h('p', { class: 'muted small', style: { width: '100%', textAlign: 'center' } }, t('A public review helps other travellers find {host}. It only takes a minute.', { host: d.host })),
      links.map((l) => h('a', { class: 'btn btn--secondary', href: l.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${l.label} (${t('Opens in a new tab')})` }, l.label))))));
  if (d.reviewed) { thanks(); return; }
  if (!d.open) {
    el.replaceChildren(page(h('div', { class: 'card' }, d.not_yet
      ? [h('h1', null, t('Feedback opens soon')), h('p', { class: 'muted' }, t('You can leave feedback once your stay starts.'))]
      : [h('h1', null, t('Feedback is closed')), h('p', { class: 'muted' }, t('This stay can no longer be reviewed here. You can always message your host directly.'))])));
    return;
  }
  const overall = starPicker('rating', t('Overall, how was your stay?'), true);
  const clean = starPicker('cleanliness', t('How clean was the place?'), false);
  const comment = h('textarea', { class: 'input', name: 'comment', rows: 4, maxlength: 2000, placeholder: t('What did you like? What could be better?') });
  const btn = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, t('Send feedback'));
  const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    clearErrors(form);
    if (!overall.get()) { showErrors(form, { rating: t('Please choose a star rating first.') }); return; }
    btn.disabled = true;
    try {
      const res = await post(`/public/review/${encodeURIComponent(token)}`, { rating: overall.get(), cleanliness: clean.get(), comment: comment.value.trim() || undefined });
      d.reviewed = true;
      thanks(overall.get() >= 4 && Array.isArray(res?.share_links) ? res.share_links.filter((l) => /^https:\/\//i.test(l?.url || '')) : []);
    } catch (err) { toast(tServer(err.message), 'error'); btn.disabled = false; }
  } },
  overall.el, clean.el,
  h('div', { class: 'field' }, h('label', { for: 'review-comment' }, t("Anything you'd like to tell your host? (optional)")), Object.assign(comment, { id: 'review-comment' })),
  btn);
  el.replaceChildren(page(h('div', { class: 'card' },
    h('p', { class: 'gc__eyebrow' }, d.host),
    h('h1', null, `${d.guest_first_name ? t('Hi {name}! ', { name: d.guest_first_name }) : ''}${t('How was your stay?')}`),
    h('p', { class: 'muted' }, t('{listing} · {dates}. This is private: only your host sees it.', { listing: d.listing, dates: `${fmtDate(d.check_in)} – ${fmtDate(d.check_out)}` })),
    form)));
  // Back from a language switch: put the typed comment and the stars back.
  restoreFormValues(el, snap);
  overall.set(Number(overall.store.value) || 0);
  clean.set(Number(clean.store.value) || 0);
}
