// Public direct-booking pages: a host's listings, one listing with photos,
// availability and checkout, and the guest's confirmation page.

import { get, post, ApiError } from '../api.js';
import { h, brand, field, toast, readForm, clearErrors, showErrors, todayManila } from '../ui.js';
import { t, tServer, tFields, locale, initGuestLang, langToggle, fmtDateL as fmtDate } from '../i18n.js';

const peso = (v) => { const n = Number(v || 0); return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`; };
const photoUrl = (id) => `/api/public/listing-photos/${id}`;
const addDays = (s, n) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmtTime = (t) => { if (!t) return ''; const [hh, mm] = t.split(':').map(Number); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };

let redraw = () => {};
function shell(hostName, slug, ...children) {
  return h('div', { class: 'bk' },
    h('header', { class: 'bk__top' }, h('div', { class: 'bk__wrap bk__top-inner' },
      h('a', { class: 'bk__host', href: `#/book/${slug}` }, hostName || t('Book your stay')),
      h('span', { class: 'bk__right' }, langToggle(() => redraw()), h('span', { class: 'bk__powered' }, t('Secure booking by '), brand(null))))),
    h('main', { class: 'bk__wrap bk__main', id: 'main' }, children),
    h('footer', { class: 'bk__wrap bk__foot muted small' }, t('Payments are processed securely by PayMongo. '), h('a', { href: '#/privacy' }, t('Privacy notice'))));
}

function cover(l, cls = 'bk-card__img') {
  return l.photos?.length
    ? h('img', { class: cls, src: photoUrl(l.photos[0]), alt: l.unit_name, loading: 'lazy' })
    : h('div', { class: `${cls} bk-noimg`, 'aria-hidden': 'true' }, l.unit_name.slice(0, 1));
}

// ---------------------------------------------------------------- host page
export async function bookHostView(el, { params }) {
  initGuestLang();
  let data;
  try { data = await get(`/public/book/${encodeURIComponent(params.slug)}`); } catch (err) {
    el.replaceChildren(shell(null, params.slug, h('div', { class: 'card' }, h('h1', null, t('Page not found')), h('p', { class: 'muted' }, err.message))));
    return;
  }
  const { host, listings } = data;
  initGuestLang(host.guest_language);
  redraw = () => bookHostView(el, { params });
  document.title = `${host.name} — Book direct`;
  el.replaceChildren(shell(host.name, params.slug,
    h('section', { class: 'bk-hero' }, h('h1', null, host.name), host.intro && h('p', null, host.intro),
      host.demo && h('p', { class: 'alert alert--info' }, t('This is a demo booking page. Bookings and payments are turned off.')),
      host.test_mode && h('p', { class: 'alert alert--warn' }, t('TEST MODE: this page uses a PayMongo test key, so payments are not real.'))),
    !host.accepting && !host.demo && h('div', { class: 'alert alert--warn' }, t('Online booking is paused right now. Please contact the host directly.')),
    listings.length
      ? h('div', { class: 'bk-grid' }, listings.map((l) => h('a', { class: 'bk-card', href: `#/book/${params.slug}/${l.unit_id}` },
        cover(l),
        h('div', { class: 'bk-card__body' },
          h('strong', null, l.unit_name),
          h('span', { class: 'muted small' }, [l.property_name, l.city].filter(Boolean).join(' · ')),
          h('span', { class: 'small' }, `${t('Up to {n} guests', { n: l.max_guests || 2 })}${l.min_nights > 1 ? ` · ${t('{n}-night minimum', { n: l.min_nights })}` : ''}`),
          h('span', { class: 'bk-card__price' }, h('strong', null, peso(l.nightly_rate)), t(' / night'))))))
      : h('div', { class: 'card' }, h('p', { class: 'muted' }, t('No places are open for online booking yet.')))));
}

// ---------------------------------------------------------------- one listing
export async function bookListingView(el, { params, query }) {
  initGuestLang();
  const slug = params.slug;
  let data;
  try { data = await get(`/public/book/${encodeURIComponent(slug)}`); } catch (err) {
    el.replaceChildren(shell(null, slug, h('div', { class: 'card' }, h('h1', null, t('Page not found')), h('p', { class: 'muted' }, err.message))));
    return;
  }
  const { host } = data;
  initGuestLang(host.guest_language);
  redraw = () => bookListingView(el, { params, query: {} });
  const l = data.listings.find((x) => x.unit_id === params.unitId);
  if (!l) {
    el.replaceChildren(shell(host.name, slug, h('div', { class: 'card' }, h('h1', null, t('Not available')), h('p', null, h('a', { href: `#/book/${slug}` }, t('See all places'))))));
    return;
  }
  document.title = `${l.unit_name} — ${host.name}`;
  if (query.cancelled) {
    // Release the held dates right away so they can be booked again.
    history.replaceState(null, '', `#/book/${slug}/${params.unitId}`);
    post(`/public/book/cancel/${encodeURIComponent(query.cancelled)}`).catch(() => {});
    toast(t('Payment cancelled. Nothing was charged and your dates were not booked.'));
  }
  const testBanner = host.test_mode && h('div', { class: 'alert alert--warn' }, t('TEST MODE: this page uses a PayMongo test key, so payments are not real.'));

  // Gallery
  const main = cover(l, 'bk-gallery__main');
  const gallery = h('div', { class: 'bk-gallery' }, main,
    l.photos.length > 1 && h('div', { class: 'bk-gallery__thumbs' }, l.photos.map((id, i) => h('button', {
      type: 'button', class: 'bk-gallery__thumb', 'aria-label': t('Show photo {n}', { n: i + 1 }),
      onclick: () => { main.src = photoUrl(id); },
    }, h('img', { src: photoUrl(id), alt: '', loading: 'lazy' })))));

  // Availability calendar: pick check-in, then check-out.
  let checkIn = null; let checkOut = null;
  let days = new Map();
  let monthStart = todayManila().slice(0, 7);
  const calBox = h('div', { class: 'bk-cal' });
  const summary = h('div', { class: 'bk-summary' });
  async function loadDays(fromMonth) {
    const from = `${fromMonth}-01` < todayManila() ? todayManila() : `${fromMonth}-01`;
    const r = await get(`/public/book/${encodeURIComponent(slug)}/units/${l.unit_id}/availability?from=${from}`);
    for (const x of r.days) days.set(x.date, x);
  }
  const takenBetween = (a, b) => { for (let x = a; x < b; x = addDays(x, 1)) if (days.get(x)?.taken) return true; return false; };
  function month(ym) {
    const [y, m] = ym.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < first.getUTCDay(); i += 1) cells.push(h('span', { class: 'bk-cal__blank' }));
    for (let dd = 1; dd <= daysIn; dd += 1) {
      const date = `${ym}-${String(dd).padStart(2, '0')}`;
      const info = days.get(date);
      const past = date < todayManila();
      const inRange = checkIn && checkOut && date >= checkIn && date < checkOut;
      const disabled = past || !info || (info.taken && !(checkIn && !checkOut && date > checkIn && !takenBetween(checkIn, date)));
      cells.push(h('button', {
        type: 'button', disabled,
        class: `bk-cal__day${info?.taken ? ' is-taken' : ''}${date === checkIn || date === checkOut ? ' is-picked' : ''}${inRange ? ' is-range' : ''}${info?.holiday && !info.taken ? ' is-holiday' : ''}`,
        title: info?.holiday && !info.taken ? `${t('Holiday price')}: ${info.holiday}` : null,
        'aria-label': `${fmtDate(date)}${info?.taken ? t(', not available') : info ? `, ${peso(info.price)}${info.holiday ? ` (${info.holiday})` : ''}` : ''}`,
        onclick: () => pick(date),
      }, h('span', null, String(dd)), info && !info.taken && !past && h('small', null, `₱${Math.round(info.price / 100) / 10}k`)));
    }
    const label = first.toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return h('div', { class: 'bk-cal__month' }, h('strong', null, label),
      h('div', { class: 'bk-cal__grid' }, t('S M T W T F S').split(' ').map((w) => h('span', { class: 'bk-cal__wd' }, w)), cells));
  }
  const nextMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7); };
  const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); };
  function drawCal() {
    calBox.replaceChildren(
      h('div', { class: 'bk-cal__nav' },
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: monthStart <= todayManila().slice(0, 7), onclick: async () => { monthStart = prevMonth(monthStart); await loadDays(monthStart); drawCal(); } }, t('‹ Earlier')),
        h('span', { class: 'muted small' }, checkIn && !checkOut ? t('Now choose your check-out date') : t('Choose your check-in date')),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: async () => { monthStart = nextMonth(monthStart); await loadDays(monthStart); drawCal(); } }, t('Later ›'))),
      h('div', { class: 'bk-cal__months' }, month(monthStart), month(nextMonth(monthStart))));
  }
  function pick(date) {
    if (!checkIn || checkOut || date <= checkIn || takenBetween(checkIn, date)) {
      if (days.get(date)?.taken) return; // can't start a stay on a taken night
      checkIn = date; checkOut = null;
    } else checkOut = date;
    drawCal();
    updateQuote();
  }

  // Quote and checkout form
  const opt = l.payment_option;
  const payChoice = h('div', { class: 'field', dataset: { field: 'pay' } },
    h('label', null, t('Payment')),
    (opt === 'full' || opt === 'either') && h('label', { class: 'check' }, h('input', { type: 'radio', name: 'pay', value: 'full', checked: true }), h('span', null, t('Pay in full now'))),
    (opt === 'deposit' || opt === 'either') && h('label', { class: 'check' }, h('input', { type: 'radio', name: 'pay', value: 'deposit', checked: opt === 'deposit' }), h('span', { class: 'pay-dep' }, t('Pay a 50% deposit now, the rest before check-in'))),
    h('div', { class: 'error', role: 'alert' }));
  const formError = h('div');
  // Discount code
  let promoCode = '';
  const codeMsg = h('div', { class: 'muted small', role: 'status' });
  const codeInput = h('input', { class: 'input', name: 'code', maxlength: 40, autocomplete: 'off', placeholder: 'e.g. BALIK10', 'aria-label': t('Discount code') });
  const applyCode = () => { promoCode = codeInput.value.trim(); updateQuote(); };
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCode(); } });
  const codeBox = h('details', { class: 'field bk-code', dataset: { field: 'code' } },
    h('summary', null, t('Have a discount code?')),
    h('div', { class: 'chips' }, codeInput, h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: applyCode }, t('Apply'))),
    codeMsg, h('div', { class: 'error', role: 'alert' }));
  const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit', disabled: true }, t('Continue to payment'));
  let current = null;
  async function updateQuote() {
    current = null;
    submit.disabled = true;
    payChoice.querySelector('.error').textContent = '';
    codeBox.querySelector('.error').textContent = '';
    if (!checkIn || !checkOut) {
      summary.replaceChildren(h('p', { class: 'muted' }, checkIn ? t('Check-in {date}. Now choose check-out.', { date: fmtDate(checkIn) }) : t('Choose your dates on the calendar to see the price.')));
      return;
    }
    try {
      const promo = promoCode ? `&code=${encodeURIComponent(promoCode)}` : '';
      const q = await get(`/public/book/${encodeURIComponent(slug)}/units/${l.unit_id}/quote?check_in=${checkIn}&check_out=${checkOut}${promo}`);
      codeMsg.textContent = tServer(q.code_error) || (q.promo_code ? `${t('Code {code} applied: −{amount}.', { code: q.promo_code, amount: peso(q.promo_discount) })}${q.promo_note ? ` ${tServer(q.promo_note)}` : ''}` : '');
      codeMsg.className = q.code_error ? 'error' : 'muted small';
      current = q;
      // Show only the payment choices allowed for these dates.
      const full = payChoice.querySelector('input[value=full]');
      const dep = payChoice.querySelector('input[value=deposit]');
      if (dep) { dep.closest('label').hidden = !q.deposit_allowed; if (!q.deposit_allowed && dep.checked && full) full.checked = true; }
      if (full) full.closest('label').hidden = !q.full_allowed;
      if (!q.deposit_allowed && opt === 'deposit' && !full) {
        payChoice.querySelector('.error').textContent = t('Your stay is too soon for a deposit; it will be charged in full.');
      }
      summary.replaceChildren(h('dl', { class: 'dl' },
        h('dt', null, t('Dates')), h('dd', null, `${fmtDate(checkIn)} – ${fmtDate(checkOut)}`),
        h('dt', null, q.nights > 1 ? t('{n} nights', { n: q.nights }) : t('1 night')), h('dd', null, peso(q.discount_label || q.promo_code ? q.subtotal : q.accommodation_total)),
        q.discount_label && [h('dt', null, tServer(q.discount_label).replace(/^./, (c) => c.toUpperCase())), h('dd', null, `− ${peso(q.discount_amount)}`)],
        q.promo_code && [h('dt', null, t('Code {code}', { code: q.promo_code })), h('dd', null, `− ${peso(q.promo_discount)}`)],
        Number(q.cleaning_fee) > 0 && [h('dt', null, t('Cleaning fee')), h('dd', null, peso(q.cleaning_fee))],
        h('dt', null, t('Total')), h('dd', null, h('strong', null, peso(q.total))),
        q.deposit_allowed && [h('dt', null, t('50% deposit')), h('dd', null, t('{now} now, {rest} due by {date}', { now: peso(q.deposit), rest: peso(Number(q.total) - Number(q.deposit)), date: fmtDate(q.balance_due_date) }))]),
      !q.available && h('div', { class: 'alert alert--error' }, t('Sorry, these dates are no longer available.')));
      submit.disabled = !q.available || !host.accepting;
    } catch (err) {
      // Show the actual reason (e.g. minimum stay), not just "check the highlighted fields".
      const reason = err.fields ? Object.values(err.fields)[0] : err.message;
      summary.replaceChildren(h('div', { class: 'alert alert--error', role: 'alert' }, tServer(reason)));
    }
  }

  const form = h('form', { class: 'form', novalidate: true },
    formError,
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'name', label: t('Full name'), required: true, maxlength: 120, autocomplete: 'name' }),
      field({ name: 'num_guests', label: t('Guests'), type: 'number', required: true, min: 1, max: l.max_guests || 20, value: Math.min(2, l.max_guests || 2), inputmode: 'numeric' })),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'email', label: t('Email'), type: 'email', required: true, autocomplete: 'email', hint: t('We send your confirmation here.') }),
      field({ name: 'phone', label: t('Mobile number'), type: 'tel', required: true, inputmode: 'tel', autocomplete: 'tel', placeholder: '0917 123 4567' })),
    field({ name: 'notes', label: t('Message to the host (optional)'), type: 'textarea', maxlength: 1000, placeholder: t('Arrival time, special requests…') }),
    codeBox,
    payChoice,
    h('div', { class: 'field', dataset: { field: 'consent' } },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'consent' }),
        h('span', null, t('I agree to the house rules, and that my details are shared with {host} to manage my booking (see the ', { host: host.name }), h('a', { href: '#/privacy', target: '_blank' }, t('privacy notice')), ').')),
      h('div', { class: 'error', role: 'alert' })),
    submit,
    !host.accepting && h('p', { class: 'muted small' }, host.demo ? t('This is a demo, so booking is turned off.') : t('Online booking is paused. Please contact the host.')));

  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !current) return;
    busy = true;
    clearErrors(form);
    formError.replaceChildren();
    const d = readForm(form);
    submit.disabled = true;
    submit.textContent = t('Opening secure payment…');
    try {
      const r = await post(`/public/book/${encodeURIComponent(slug)}/units/${l.unit_id}/checkout`, {
        check_in: checkIn, check_out: checkOut, num_guests: Number(d.num_guests), name: d.name, email: d.email, phone: d.phone, notes: d.notes,
        pay: current.deposit_allowed ? (form.querySelector('input[name=pay]:checked')?.value || 'full') : 'full',
        consent: form.elements.consent.checked,
        code: promoCode || undefined,
      });
      location.href = r.checkout_url;
    } catch (err) {
      formError.replaceChildren(h('div', { class: 'alert alert--error', role: 'alert' }, err instanceof ApiError ? tServer(err.message) : t('Something went wrong. Please try again.')));
      if (err.fields) showErrors(form, tFields(err.fields));
      if (err.fields?.code) { codeBox.open = true; codeMsg.textContent = ''; }
      if (err.code === 'DATES_TAKEN') { days = new Map(); await loadDays(monthStart); drawCal(); }
      submit.disabled = false;
      submit.textContent = t('Continue to payment');
      busy = false;
    }
  });

  await loadDays(monthStart);
  await loadDays(nextMonth(monthStart));
  // The lowest price on the open nights shown (weekend, holiday and season rates differ).
  const open = [...days.values()].filter((x) => !x.taken && x.price !== null && x.date >= todayManila()).map((x) => Number(x.price));
  const fromPrice = open.length ? Math.min(...open) : Number(l.nightly_rate);
  drawCal();
  updateQuote();

  el.replaceChildren(shell(host.name, slug,
    testBanner,
    h('a', { class: 'back', href: `#/book/${slug}` }, t('‹ All places')),
    h('h1', { class: 'bk-title' }, l.unit_name),
    h('p', { class: 'muted' }, [l.property_name, l.city, l.province].filter(Boolean).join(', ')),
    gallery,
    h('div', { class: 'bk-layout' },
      h('div', { class: 'bk-details' },
        h('div', { class: 'bk-facts' },
          h('span', null, `👥 ${t('Up to {n} guests', { n: l.max_guests || 2 })}`),
          h('span', null, `🕑 ${t('Check-in {in} · Check-out {out}', { in: fmtTime(l.checkin_time), out: fmtTime(l.checkout_time) })}`),
          l.min_nights > 1 && h('span', null, `🌙 ${t('{n}-night minimum', { n: l.min_nights })}`)),
        l.description && h('p', { class: 'bk-desc' }, l.description),
        l.house_rules && [h('h2', null, t('House rules')), h('p', { class: 'bk-desc' }, l.house_rules)],
        h('h2', null, t('Availability')),
        calBox),
      h('aside', { class: 'card bk-book' },
        h('div', { class: 'bk-book__price' }, fromPrice < Number(l.nightly_rate) || [...days.values()].some((x) => !x.taken && Number(x.price) !== Number(l.nightly_rate)) ? t('from ') : null,
          h('strong', null, peso(fromPrice)), t(' / night')),
        summary,
        form))));
}

// ---------------------------------------------------------------- after payment
export async function bookDoneView(el, { params }) {
  initGuestLang();
  const show = (s, extra) => el.replaceChildren(shell(s?.stay?.host, params.slug, extra));
  let tries = 0;
  async function check() {
    let s;
    try { s = await get(`/public/book/status/${encodeURIComponent(params.token)}`); } catch (err) {
      show(null, h('div', { class: 'card' }, h('h1', null, t('Booking not found')), h('p', { class: 'muted' }, err.message)));
      return;
    }
    const st = s.stay;
    initGuestLang(st?.guest_language);
    redraw = () => check();
    if (s.status === 'confirmed') {
      show(s, h('div', { class: 'card bk-done' },
        h('div', { class: 'gc__tick', 'aria-hidden': 'true' }, '✓'),
        h('h1', null, t("You're booked, {name}!", { name: String(st.guest_name).split(' ')[0] })),
        h('p', { class: 'muted' }, t('A confirmation and receipt were sent to your email.')),
        h('dl', { class: 'dl' },
          h('dt', null, t('Booking code')), h('dd', null, h('strong', null, st.code)),
          h('dt', null, t('Place')), h('dd', null, `${st.listing}, ${st.property}`),
          h('dt', null, t('Dates')), h('dd', null, `${fmtDate(st.check_in)} – ${fmtDate(st.check_out)}`),
          h('dt', null, t('Guests')), h('dd', null, String(st.guests)),
          h('dt', null, t('Paid')), h('dd', null, peso(st.paid)),
          Number(st.balance) > 0 && [h('dt', null, t('Balance')), h('dd', null, t('{amount}, due by {date}', { amount: peso(st.balance), date: fmtDate(addDays(st.check_in, -st.balance_due_days)) }))]),
        st.checkin_link && h('a', { class: 'btn btn--primary', href: st.checkin_link.slice(st.checkin_link.indexOf('#')) }, t('Register your guests now')),
        h('p', { class: 'muted small' }, t("The building needs everyone's names and a valid ID before arrival. You can also do this later from the link in your email."))));
      return;
    }
    if (s.status === 'pending' && tries < 40) {
      tries += 1;
      show(s, h('div', { class: 'card bk-done' }, h('h1', null, t('Confirming your payment…')),
        h('p', { class: 'muted' }, t('This usually takes a few seconds. Please keep this page open.'))));
      setTimeout(check, 3000);
      return;
    }
    const msg = {
      conflict: t('Your payment went through, but those dates were just booked by someone else. The host has been notified and will contact you to offer other dates or a full refund.'),
      expired: t('This booking was not completed and nothing was charged. Please start again.'),
      failed: t('The payment could not be started. Nothing was charged. Please try again.'),
      pending: t('We have not received the payment confirmation yet. If you paid, you will get a confirmation email shortly; otherwise please try again.'),
    }[s.status] || t('Something went wrong. Please try again.');
    show(s, h('div', { class: 'card bk-done' }, h('h1', null, s.status === 'conflict' ? t('Dates no longer available') : t('Booking not completed')),
      h('p', null, msg), h('a', { class: 'btn btn--secondary', href: `#/book/${params.slug}` }, t('Back to all places'))));
  }
  await check();
}
