// Guest's "pay your balance" page, opened from the private link the host sends.
// Shows the itemised bill, the online payment button and, when the host allows it,
// the manual payment details with a form to send a proof of payment.

import { get, post, api, ApiError } from '../api.js';
import { h, brand, toast, field, readForm, showErrors, clearErrors } from '../ui.js';
import { t, tServer, tFields, initGuestLang, langToggle, fmtDateL as fmtDate, extendTranslations } from '../i18n.js';

// Same peso format as the booking pages: no centavos when it's a whole amount.
const peso = (v) => { const n = Number(v || 0); return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`; };

const METHOD_TEXT = { gcash: 'GCash', maya: 'Maya', bank_transfer: 'Bank transfer', other: 'Other', cash: 'Cash', card: 'Card', channel_payout: 'Booking platform', check: 'Check' };
const PROOF_METHODS = [['gcash', 'GCash'], ['maya', 'Maya'], ['bank_transfer', 'Bank transfer'], ['other', 'Other']];
const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_PROOF_BYTES = 10 * 1024 * 1024;

extendTranslations({
  'Accommodation (1 night)': 'Tirahan (1 gabi)',
  'Accommodation ({n} nights)': 'Tirahan ({n} na gabi)',
  'Cleaning fee': 'Bayad sa paglilinis',
  'Other fees': 'Iba pang bayarin',
  'There are already 5 payment proofs waiting for the host to check. Please wait for the host to review them before you send another.':
    'May 5 nang patunay ng bayad na naghihintay pang i-check ng host. Maghintay muna na ma-review nila ang mga ito bago magpadala ulit.',
  'Payment received': 'Bayad na natanggap',
  'Balance due': 'Babayaran pa',
  'Adjustments': 'Mga adjustment',
  'Pay by GCash, Maya or bank transfer': 'Magbayad gamit ang GCash, Maya o bank transfer',
  'Pay the amount, then send the proof below. {host} checks each payment and confirms it.': 'Bayaran ang halaga, tapos ipadala ang patunay sa ibaba. Titingnan ni {host} ang bayad at kukumpirmahin ito.',
  'Amount paid': 'Halagang binayad',
  'Payment method': 'Paraan ng pagbayad',
  'Reference number': 'Reference number',
  'The reference or transaction number from your app or bank.': 'Reference o transaction number mula sa app o bangko.',
  'Name of payer': 'Pangalan ng nagbayad',
  'The name on the account you paid from.': 'Pangalan sa account na ginamit mo sa pagbayad.',
  'Screenshot or receipt': 'Screenshot o resibo',
  'JPG, PNG, WEBP or PDF, up to 10 MB.': 'JPG, PNG, WEBP o PDF, hanggang 10 MB.',
  'Send proof': 'Ipadala ang patunay',
  "You're offline. Please try again when you're connected.": 'Offline ka. Subukan ulit kapag may internet na.',
  'Sending…': 'Ipinapadala…',
  'Enter the amount you paid.': 'Ilagay ang halagang binayad mo.',
  'This is more than the balance of {amount}.': 'Mas malaki ito sa balanseng {amount}.',
  'Choose a screenshot or receipt.': 'Pumili ng screenshot o resibo.',
  'The file is too large. Please use one up to 10 MB.': 'Masyadong malaki ang file. Gumamit ng file na hanggang 10 MB.',
  'Please use a JPG, PNG, WEBP or PDF file.': 'Gumamit ng JPG, PNG, WEBP o PDF na file.',
  'Uploading the screenshot…': 'Ina-upload ang screenshot…',
  'Thank you! Your proof was sent.': 'Salamat! Naipadala na ang patunay.',
  '{host} will check the payment and confirm it. You will get an email when it is confirmed.': 'Titingnan ni {host} ang bayad at kukumpirmahin ito. Makakatanggap ka ng email kapag kumpirmado na.',
  'Other': 'Iba pa',
});

export async function payBalanceView(el, { params, query }) {
  initGuestLang();
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
  const paidUp = Number(d.balance) <= 0 && !d.cancelled;
  const btn = h('button', { class: 'btn btn--primary btn--block', type: 'button' }, t('Pay {amount} now', { amount: peso(d.balance) }));
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = t('Opening secure payment…');
    try {
      const r = await post(`/public/pay/${encodeURIComponent(token)}/checkout`);
      location.href = r.checkout_url;
    } catch (err) {
      toast(tServer(err.message), 'error');
      btn.disabled = false;
      btn.textContent = t('Pay {amount} now', { amount: peso(d.balance) });
    }
  });
  el.replaceChildren(page(
    d.test_mode && h('div', { class: 'alert alert--warn' }, t('TEST MODE: payments on this page are not real.')),
    h('div', { class: 'card bk-done' },
      paidUp && h('div', { class: 'gc__tick', 'aria-hidden': 'true' }, '✓'),
      h('p', { class: 'gc__eyebrow' }, d.host),
      h('h1', null, d.cancelled ? t('This booking was cancelled') : paidUp ? t('Your booking is fully paid') : `${d.guest_first_name ? t('Hi {name}! ', { name: d.guest_first_name }) : ''}${t('Pay your balance')}`),
      h('dl', { class: 'dl' },
        h('dt', null, t('Stay')), h('dd', null, `${d.listing}, ${d.property}`),
        h('dt', null, t('Dates')), h('dd', null, `${fmtDate(d.check_in)} – ${fmtDate(d.check_out)}`),
        h('dt', null, t('Booking')), h('dd', null, d.code)),
      billSection(d),
      d.cancelled ? h('div', { class: 'alert alert--info' }, t('This booking was cancelled.'))
        : paidUp ? h('p', { class: 'muted' }, t('Thank you! Nothing more to pay. See you soon.'))
          : d.accepting ? [btn, h('p', { class: 'muted small' }, t('GCash, Maya, cards and GrabPay. You get an email receipt.'))]
            : d.manual_payments?.accepting ? null
              : h('div', { class: 'alert alert--info' }, t('Online payment is not available for this booking. Please contact your host.'))),
    d.manual_payments?.accepting && manualCard(d, token)));
}

// The itemised bill: the stay, fees and extra charges, then payments received and what is still owed.
// The amounts come from the server already added up, so nothing is summed here.
function billSection(d) {
  const b = d.bill;
  const line = (label, amount) => [h('dt', null, label), h('dd', null, amount)];
  return h('dl', { class: 'dl bill', style: { marginTop: '4px' } },
    line(b.nights === 1 ? t('Accommodation (1 night)') : t('Accommodation ({n} nights)', { n: b.nights }), peso(b.accommodation_total)),
    Number(b.cleaning_fee) > 0 && line(t('Cleaning fee'), peso(b.cleaning_fee)),
    Number(b.other_fees) > 0 && line(t('Other fees'), peso(b.other_fees)),
    b.charges.map((c) => line(c.quantity > 1 ? `${c.description} (${c.quantity} × ${peso(c.unit_price)})` : c.description, peso(c.amount))),
    line(t('Total'), h('strong', null, peso(b.total))),
    b.payments.map((p) => line(`${t('Payment received')} · ${fmtDate(p.payment_date)} · ${METHOD_TEXT[p.payment_method] || p.payment_method}`, `−${peso(p.amount)}`)),
    Number(b.adjustments) > 0 && line(t('Adjustments'), `−${peso(b.adjustments)}`),
    line(t('Balance due'), h('strong', null, peso(d.balance))));
}

// Pay by GCash, Maya or bank transfer: the host's payment details, then a form to send the proof.
function manualCard(d, token) {
  const card = h('div', { class: 'card' });
  const sent = () => card.replaceChildren(h('div', { class: 'gc__done' },
    h('div', { class: 'gc__tick', 'aria-hidden': 'true' }, '✓'),
    h('h2', null, t('Thank you! Your proof was sent.')),
    h('p', { class: 'muted' }, t('{host} will check the payment and confirm it. You will get an email when it is confirmed.', { host: d.host }))));
  card.replaceChildren(
    h('h2', null, t('Pay by GCash, Maya or bank transfer')),
    h('div', { class: 'gc__instructions', style: { whiteSpace: 'pre-line' } }, d.manual_payments.instructions || ''),
    h('p', { class: 'muted small' }, t('Pay the amount, then send the proof below. {host} checks each payment and confirms it.', { host: d.host })),
    proofForm(d, token, sent));
  return card;
}

// The proof form: amount, method, reference, payer name and a screenshot. It goes in two steps,
// the details first and then the screenshot. If the screenshot fails, trying again only re-sends
// the screenshot, so the payment is never recorded twice.
function proofForm(d, token, onSent) {
  let proofId = null;
  const form = h('form', { class: 'form', novalidate: true });
  const formError = h('div', { class: 'form-error' });
  const progress = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const photo = h('input', { type: 'file', id: 'proof-file', accept: PROOF_TYPES.join(','), class: 'input' });
  const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, t('Send proof'));
  const alertBox = (msg) => h('div', { class: 'alert alert--error', role: 'alert' }, msg);
  form.append(
    formError,
    field({ name: 'amount', label: t('Amount paid'), type: 'money', required: true, value: Number(d.balance).toFixed(2) }),
    field({ name: 'method', label: t('Payment method'), type: 'select', required: true, value: 'gcash', placeholderOption: false, options: PROOF_METHODS.map(([v, l]) => [v, t(l)]) }),
    field({ name: 'reference_number', label: t('Reference number'), maxlength: 100, hint: t('The reference or transaction number from your app or bank.') }),
    field({ name: 'payer_name', label: t('Name of payer'), maxlength: 120, hint: t('The name on the account you paid from.') }),
    h('div', { class: 'field' },
      h('label', { for: 'proof-file' }, t('Screenshot or receipt'), h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')),
      photo,
      h('div', { class: 'hint' }, t('JPG, PNG, WEBP or PDF, up to 10 MB.'))),
    progress,
    submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    formError.replaceChildren();
    const v = readForm(form);
    const file = photo.files[0];
    const amount = Number(String(v.amount || '').replace(/[₱,\s]/g, ''));
    const problems = {};
    if (!(amount > 0)) problems.amount = t('Enter the amount you paid.');
    else if (amount > Number(d.balance)) problems.amount = t('This is more than the balance of {amount}.', { amount: peso(d.balance) });
    if (Object.keys(problems).length) { showErrors(form, problems); return; }
    if (!file) { formError.replaceChildren(alertBox(t('Choose a screenshot or receipt.'))); return; }
    if (file.size > MAX_PROOF_BYTES) { formError.replaceChildren(alertBox(t('The file is too large. Please use one up to 10 MB.'))); return; }
    if (!PROOF_TYPES.includes(file.type)) { formError.replaceChildren(alertBox(t('Please use a JPG, PNG, WEBP or PDF file.'))); return; }
    submit.disabled = true;
    submit.textContent = t('Sending…');
    try {
      if (!proofId) {
        const created = await post(`/public/pay/${encodeURIComponent(token)}/proofs`, {
          amount: v.amount, method: v.method, reference_number: v.reference_number, payer_name: v.payer_name,
        });
        proofId = created.proof_id;
        // The details are saved now; only the screenshot can change from here.
        form.querySelectorAll('[name]').forEach((el) => { el.disabled = true; });
      }
      progress.textContent = t('Uploading the screenshot…');
      await api('POST', `/public/pay/${encodeURIComponent(token)}/proofs/${encodeURIComponent(proofId)}/image`, undefined,
        { rawBody: file, headers: { 'Content-Type': file.type } });
      onSent();
    } catch (err) {
      const msg = err instanceof ApiError ? tServer(err.message) : (err.message || t('Something went wrong. Please try again.'));
      formError.replaceChildren(alertBox(err.offline ? t("You're offline. Please try again when you're connected.") : msg));
      if (err.fields) showErrors(form, tFields(err.fields));
      progress.textContent = '';
      submit.disabled = false;
      submit.textContent = t('Send proof');
    }
  });
  return form;
}
