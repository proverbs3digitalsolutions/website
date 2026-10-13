// Public direct-booking pages: a host's listings, one listing with photos,
// availability and checkout, and the guest's confirmation page.

import { get, post, ApiError } from '../api.js';
import { h, brand, field, fmtDate, toast, readForm, clearErrors, showErrors, todayManila } from '../ui.js';

const peso = (v) => `₱${Number(v || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
const photoUrl = (id) => `/api/public/listing-photos/${id}`;
const addDays = (s, n) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmtTime = (t) => { if (!t) return ''; const [hh, mm] = t.split(':').map(Number); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };

function shell(hostName, slug, ...children) {
  return h('div', { class: 'bk' },
    h('header', { class: 'bk__top' }, h('div', { class: 'bk__wrap bk__top-inner' },
      h('a', { class: 'bk__host', href: `#/book/${slug}` }, hostName || 'Book your stay'),
      h('span', { class: 'bk__powered' }, 'Secure booking by ', brand(null)))),
    h('main', { class: 'bk__wrap bk__main', id: 'main' }, children),
    h('footer', { class: 'bk__wrap bk__foot muted small' }, 'Payments are processed securely by PayMongo. ', h('a', { href: '#/privacy' }, 'Privacy notice')));
}

function cover(l, cls = 'bk-card__img') {
  return l.photos?.length
    ? h('img', { class: cls, src: photoUrl(l.photos[0]), alt: l.unit_name, loading: 'lazy' })
    : h('div', { class: `${cls} bk-noimg`, 'aria-hidden': 'true' }, l.unit_name.slice(0, 1));
}

// ---------------------------------------------------------------- host page
export async function bookHostView(el, { params }) {
  let data;
  try { data = await get(`/public/book/${encodeURIComponent(params.slug)}`); } catch (err) {
    el.replaceChildren(shell(null, params.slug, h('div', { class: 'card' }, h('h1', null, 'Page not found'), h('p', { class: 'muted' }, err.message))));
    return;
  }
  const { host, listings } = data;
  document.title = `${host.name} — Book direct`;
  el.replaceChildren(shell(host.name, params.slug,
    h('section', { class: 'bk-hero' }, h('h1', null, host.name), host.intro && h('p', null, host.intro),
      host.demo && h('p', { class: 'alert alert--info' }, 'This is a demo booking page. Bookings and payments are turned off.'),
      host.test_mode && h('p', { class: 'alert alert--warn' }, 'TEST MODE: this page uses a PayMongo test key, so payments are not real.')),
    !host.accepting && !host.demo && h('div', { class: 'alert alert--warn' }, 'Online booking is paused right now. Please contact the host directly.'),
    listings.length
      ? h('div', { class: 'bk-grid' }, listings.map((l) => h('a', { class: 'bk-card', href: `#/book/${params.slug}/${l.unit_id}` },
        cover(l),
        h('div', { class: 'bk-card__body' },
          h('strong', null, l.unit_name),
          h('span', { class: 'muted small' }, [l.property_name, l.city].filter(Boolean).join(' · ')),
          h('span', { class: 'small' }, `Up to ${l.max_guests || 2} guests${l.min_nights > 1 ? ` · ${l.min_nights}-night minimum` : ''}`),
          h('span', { class: 'bk-card__price' }, h('strong', null, peso(l.nightly_rate)), ' / night')))))
      : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'No places are open for online booking yet.'))));
}

// ---------------------------------------------------------------- one listing
export async function bookListingView(el, { params, query }) {
  const slug = params.slug;
  let data;
  try { data = await get(`/public/book/${encodeURIComponent(slug)}`); } catch (err) {
    el.replaceChildren(shell(null, slug, h('div', { class: 'card' }, h('h1', null, 'Page not found'), h('p', { class: 'muted' }, err.message))));
    return;
  }
  const { host } = data;
  const l = data.listings.find((x) => x.unit_id === params.unitId);
  if (!l) {
    el.replaceChildren(shell(host.name, slug, h('div', { class: 'card' }, h('h1', null, 'Not available'), h('p', null, h('a', { href: `#/book/${slug}` }, 'See all places')))));
    return;
  }
  document.title = `${l.unit_name} — ${host.name}`;
  if (query.cancelled) {
    // Release the held dates right away so they can be booked again.
    history.replaceState(null, '', `#/book/${slug}/${params.unitId}`);
    post(`/public/book/cancel/${encodeURIComponent(query.cancelled)}`).catch(() => {});
    toast('Payment cancelled. Nothing was charged and your dates were not booked.');
  }
  const testBanner = host.test_mode && h('div', { class: 'alert alert--warn' }, 'TEST MODE: this page uses a PayMongo test key, so payments are not real.');

  // Gallery
  const main = cover(l, 'bk-gallery__main');
  const gallery = h('div', { class: 'bk-gallery' }, main,
    l.photos.length > 1 && h('div', { class: 'bk-gallery__thumbs' }, l.photos.map((id) => h('button', {
      type: 'button', class: 'bk-gallery__thumb', 'aria-label': 'Show photo',
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
        class: `bk-cal__day${info?.taken ? ' is-taken' : ''}${date === checkIn || date === checkOut ? ' is-picked' : ''}${inRange ? ' is-range' : ''}`,
        'aria-label': `${fmtDate(date)}${info?.taken ? ', not available' : info ? `, ${peso(info.price)}` : ''}`,
        onclick: () => pick(date),
      }, h('span', null, String(dd)), info && !info.taken && !past && h('small', null, `₱${Math.round(info.price / 100) / 10}k`)));
    }
    const label = first.toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return h('div', { class: 'bk-cal__month' }, h('strong', null, label),
      h('div', { class: 'bk-cal__grid' }, ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w) => h('span', { class: 'bk-cal__wd' }, w)), cells));
  }
  const nextMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7); };
  const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); };
  function drawCal() {
    calBox.replaceChildren(
      h('div', { class: 'bk-cal__nav' },
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: monthStart <= todayManila().slice(0, 7), onclick: async () => { monthStart = prevMonth(monthStart); await loadDays(monthStart); drawCal(); } }, '‹ Earlier'),
        h('span', { class: 'muted small' }, checkIn && !checkOut ? 'Now choose your check-out date' : 'Choose your check-in date'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: async () => { monthStart = nextMonth(monthStart); await loadDays(monthStart); drawCal(); } }, 'Later ›')),
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
    h('label', null, 'Payment'),
    (opt === 'full' || opt === 'either') && h('label', { class: 'check' }, h('input', { type: 'radio', name: 'pay', value: 'full', checked: true }), h('span', null, 'Pay in full now')),
    (opt === 'deposit' || opt === 'either') && h('label', { class: 'check' }, h('input', { type: 'radio', name: 'pay', value: 'deposit', checked: opt === 'deposit' }), h('span', { class: 'pay-dep' }, 'Pay a 50% deposit now, the rest before check-in')),
    h('div', { class: 'error', role: 'alert' }));
  const formError = h('div');
  const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit', disabled: true }, 'Continue to payment');
  let current = null;
  async function updateQuote() {
    current = null;
    submit.disabled = true;
    if (!checkIn || !checkOut) {
      summary.replaceChildren(h('p', { class: 'muted' }, checkIn ? `Check-in ${fmtDate(checkIn)}. Now choose check-out.` : 'Choose your dates on the calendar to see the price.'));
      return;
    }
    try {
      const q = await get(`/public/book/${encodeURIComponent(slug)}/units/${l.unit_id}/quote?check_in=${checkIn}&check_out=${checkOut}`);
      current = q;
      // Show only the payment choices allowed for these dates.
      const full = payChoice.querySelector('input[value=full]');
      const dep = payChoice.querySelector('input[value=deposit]');
      if (dep) { dep.closest('label').hidden = !q.deposit_allowed; if (!q.deposit_allowed && dep.checked && full) full.checked = true; }
      if (full) full.closest('label').hidden = !q.full_allowed;
      if (!q.deposit_allowed && opt === 'deposit' && !full) {
        payChoice.querySelector('.error').textContent = 'Your stay is too soon for a deposit; it will be charged in full.';
      }
      summary.replaceChildren(h('dl', { class: 'dl' },
        h('dt', null, 'Dates'), h('dd', null, `${fmtDate(checkIn)} – ${fmtDate(checkOut)}`),
        h('dt', null, `${q.nights} night${q.nights > 1 ? 's' : ''}`), h('dd', null, peso(q.discount_label ? q.subtotal : q.accommodation_total)),
        q.discount_label && [h('dt', null, q.discount_label.replace(/^./, (c) => c.toUpperCase())), h('dd', null, `− ${peso(q.discount_amount)}`)],
        Number(q.cleaning_fee) > 0 && [h('dt', null, 'Cleaning fee'), h('dd', null, peso(q.cleaning_fee))],
        h('dt', null, 'Total'), h('dd', null, h('strong', null, peso(q.total))),
        q.deposit_allowed && [h('dt', null, '50% deposit'), h('dd', null, `${peso(q.deposit)} now, ${peso(Number(q.total) - Number(q.deposit))} due by ${fmtDate(q.balance_due_date)}`)]),
      !q.available && h('div', { class: 'alert alert--error' }, 'Sorry, these dates are no longer available.'));
      submit.disabled = !q.available || !host.accepting;
    } catch (err) {
      summary.replaceChildren(h('div', { class: 'alert alert--error' }, err.message));
    }
  }

  const form = h('form', { class: 'form', novalidate: true },
    formError,
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'name', label: 'Full name', required: true, maxlength: 120, autocomplete: 'name' }),
      field({ name: 'num_guests', label: 'Guests', type: 'number', required: true, min: 1, max: l.max_guests || 20, value: Math.min(2, l.max_guests || 2), inputmode: 'numeric' })),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email', hint: 'We send your confirmation here.' }),
      field({ name: 'phone', label: 'Mobile number', type: 'tel', required: true, inputmode: 'tel', autocomplete: 'tel', placeholder: '0917 123 4567' })),
    field({ name: 'notes', label: 'Message to the host (optional)', type: 'textarea', maxlength: 1000, placeholder: 'Arrival time, special requests…' }),
    payChoice,
    h('div', { class: 'field', dataset: { field: 'consent' } },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'consent' }),
        h('span', null, `I agree to the house rules, and that my details are shared with ${host.name} to manage my booking (see the `, h('a', { href: '#/privacy', target: '_blank' }, 'privacy notice'), ').')),
      h('div', { class: 'error', role: 'alert' })),
    submit,
    !host.accepting && h('p', { class: 'muted small' }, host.demo ? 'This is a demo, so booking is turned off.' : 'Online booking is paused. Please contact the host.'));

  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !current) return;
    busy = true;
    clearErrors(form);
    formError.replaceChildren();
    const d = readForm(form);
    submit.disabled = true;
    submit.textContent = 'Opening secure payment…';
    try {
      const r = await post(`/public/book/${encodeURIComponent(slug)}/units/${l.unit_id}/checkout`, {
        check_in: checkIn, check_out: checkOut, num_guests: Number(d.num_guests), name: d.name, email: d.email, phone: d.phone, notes: d.notes,
        pay: current.deposit_allowed ? (form.querySelector('input[name=pay]:checked')?.value || 'full') : 'full',
        consent: form.elements.consent.checked,
      });
      location.href = r.checkout_url;
    } catch (err) {
      formError.replaceChildren(h('div', { class: 'alert alert--error', role: 'alert' }, err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'));
      if (err.fields) showErrors(form, err.fields);
      if (err.code === 'DATES_TAKEN') { days = new Map(); await loadDays(monthStart); drawCal(); }
      submit.disabled = false;
      submit.textContent = 'Continue to payment';
      busy = false;
    }
  });

  await loadDays(monthStart);
  await loadDays(nextMonth(monthStart));
  drawCal();
  updateQuote();

  el.replaceChildren(shell(host.name, slug,
    testBanner,
    h('a', { class: 'back', href: `#/book/${slug}` }, '‹ All places'),
    h('h1', { class: 'bk-title' }, l.unit_name),
    h('p', { class: 'muted' }, [l.property_name, l.city, l.province].filter(Boolean).join(', ')),
    gallery,
    h('div', { class: 'bk-layout' },
      h('div', { class: 'bk-details' },
        h('div', { class: 'bk-facts' },
          h('span', null, `👥 Up to ${l.max_guests || 2} guests`),
          h('span', null, `🕑 Check-in ${fmtTime(l.checkin_time)} · Check-out ${fmtTime(l.checkout_time)}`),
          l.min_nights > 1 && h('span', null, `🌙 ${l.min_nights}-night minimum`)),
        l.description && h('p', { class: 'bk-desc' }, l.description),
        l.house_rules && [h('h2', null, 'House rules'), h('p', { class: 'bk-desc' }, l.house_rules)],
        h('h2', null, 'Availability'),
        calBox),
      h('aside', { class: 'card bk-book' },
        h('div', { class: 'bk-book__price' }, h('strong', null, peso(l.nightly_rate)), ' / night'),
        summary,
        form))));
}

// ---------------------------------------------------------------- after payment
export async function bookDoneView(el, { params }) {
  const show = (s, extra) => el.replaceChildren(shell(s?.stay?.host, params.slug, extra));
  let tries = 0;
  async function check() {
    let s;
    try { s = await get(`/public/book/status/${encodeURIComponent(params.token)}`); } catch (err) {
      show(null, h('div', { class: 'card' }, h('h1', null, 'Booking not found'), h('p', { class: 'muted' }, err.message)));
      return;
    }
    const st = s.stay;
    if (s.status === 'confirmed') {
      show(s, h('div', { class: 'card bk-done' },
        h('div', { class: 'gc__tick', 'aria-hidden': 'true' }, '✓'),
        h('h1', null, `You're booked, ${String(st.guest_name).split(' ')[0]}!`),
        h('p', { class: 'muted' }, `A confirmation and receipt were sent to your email.`),
        h('dl', { class: 'dl' },
          h('dt', null, 'Booking code'), h('dd', null, h('strong', null, st.code)),
          h('dt', null, 'Place'), h('dd', null, `${st.listing}, ${st.property}`),
          h('dt', null, 'Dates'), h('dd', null, `${fmtDate(st.check_in)} – ${fmtDate(st.check_out)}`),
          h('dt', null, 'Guests'), h('dd', null, String(st.guests)),
          h('dt', null, 'Paid'), h('dd', null, peso(st.paid)),
          Number(st.balance) > 0 && [h('dt', null, 'Balance'), h('dd', null, `${peso(st.balance)}, due ${st.balance_due_days} day${st.balance_due_days === 1 ? '' : 's'} before check-in`)]),
        st.checkin_link && h('a', { class: 'btn btn--primary', href: st.checkin_link.slice(st.checkin_link.indexOf('#')) }, 'Register your guests now'),
        h('p', { class: 'muted small' }, 'The building needs everyone\'s names and a valid ID before arrival. You can also do this later from the link in your email.')));
      return;
    }
    if (s.status === 'pending' && tries < 40) {
      tries += 1;
      show(s, h('div', { class: 'card bk-done' }, h('h1', null, 'Confirming your payment…'),
        h('p', { class: 'muted' }, 'This usually takes a few seconds. Please keep this page open.')));
      setTimeout(check, 3000);
      return;
    }
    const msg = {
      conflict: 'Your payment went through, but those dates were just booked by someone else. The host has been notified and will contact you to offer other dates or a full refund.',
      expired: 'This booking was not completed and nothing was charged. Please start again.',
      failed: 'The payment could not be started. Nothing was charged. Please try again.',
      pending: 'We have not received the payment confirmation yet. If you paid, you will get a confirmation email shortly; otherwise please try again.',
    }[s.status] || 'Something went wrong.';
    show(s, h('div', { class: 'card bk-done' }, h('h1', null, s.status === 'conflict' ? 'Dates no longer available' : 'Booking not completed'),
      h('p', null, msg), h('a', { class: 'btn btn--secondary', href: `#/book/${params.slug}` }, 'Back to all places')));
  }
  await check();
}
