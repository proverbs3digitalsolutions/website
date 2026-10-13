// Guest's "pay your balance" page, opened from the private link the host sends.

import { get, post } from '../api.js';
import { h, brand, toast } from '../ui.js';
import { t, initGuestLang, langToggle, fmtDateL as fmtDate } from '../i18n.js';

const peso = (v) => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function payBalanceView(el, { params, query }) {
  const token = params.token;
  const page = (...children) => h('div', { class: 'gc' },
    h('header', { class: 'gc__top gc__top--lang' }, brand(null), langToggle(() => payBalanceView(el, { params, query: {} }))),
    h('main', { class: 'gc__main', id: 'main' }, children),
    h('p', { class: 'gc__foot muted small' }, t('Payments are processed securely by PayMongo. '), h('a', { href: '#/privacy' }, t('Privacy notice'))));
  let d;
  try { d = await get(`/public/pay/${encodeURIComponent(token)}`); } catch (err) {
    el.replaceChildren(page(h('div', { class: 'card' }, h('h1', null, t('Link not found')), h('p', { class: 'muted' }, err.message))));
    return;
  }
  initGuestLang(d.guest_language);
  // Back from PayMongo: confirm the payment.
  if (query.done) {
    el.replaceChildren(page(h('div', { class: 'card bk-done' }, h('h1', null, t('Confirming your payment…')), h('p', { class: 'muted' }, t('Please keep this page open.')))));
    for (let i = 0; i < 20; i += 1) {
      const r = await post(`/public/pay/${encodeURIComponent(token)}/refresh`).catch(() => null);
      if (r?.paid || (r && !r.pending)) break;
      await new Promise((ok) => setTimeout(ok, 3000));
    }
    history.replaceState(null, '', `#/pay/${token}`);
    d = await get(`/public/pay/${encodeURIComponent(token)}`);
    if (Number(d.balance) <= 0) toast(t('Payment received. Thank you!'));
  }
  const paidUp = Number(d.balance) <= 0;
  const btn = h('button', { class: 'btn btn--primary btn--block', type: 'button' }, t('Pay {amount} now', { amount: peso(d.balance) }));
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = t('Opening secure payment…');
    try {
      const r = await post(`/public/pay/${encodeURIComponent(token)}/checkout`);
      location.href = r.checkout_url;
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = t('Pay {amount} now', { amount: peso(d.balance) });
    }
  });
  el.replaceChildren(page(
    d.test_mode && h('div', { class: 'alert alert--warn' }, t('TEST MODE: payments on this page are not real.')),
    h('div', { class: 'card bk-done' },
      paidUp && h('div', { class: 'gc__tick', 'aria-hidden': 'true' }, '✓'),
      h('p', { class: 'gc__eyebrow' }, d.host),
      h('h1', null, paidUp ? t('Your booking is fully paid') : `${d.guest_first_name ? t('Hi {name}! ', { name: d.guest_first_name }) : ''}${t('Pay your balance')}`),
      h('dl', { class: 'dl' },
        h('dt', null, t('Stay')), h('dd', null, `${d.listing}, ${d.property}`),
        h('dt', null, t('Dates')), h('dd', null, `${fmtDate(d.check_in)} – ${fmtDate(d.check_out)}`),
        h('dt', null, t('Booking')), h('dd', null, d.code),
        h('dt', null, t('Total')), h('dd', null, peso(d.total)),
        h('dt', null, t('Paid so far')), h('dd', null, peso(d.paid)),
        h('dt', null, t('Balance')), h('dd', null, h('strong', null, peso(d.balance)))),
      d.cancelled ? h('div', { class: 'alert alert--info' }, t('This booking was cancelled.'))
        : paidUp ? h('p', { class: 'muted' }, t('Thank you! Nothing more to pay. See you soon.'))
          : d.accepting ? [btn, h('p', { class: 'muted small' }, t('GCash, Maya, cards and GrabPay. You get an email receipt.'))]
            : h('div', { class: 'alert alert--info' }, t('Online payment is not available for this booking. Please contact your host.')))));
}
