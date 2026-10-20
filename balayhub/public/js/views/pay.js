// Guest's "pay your balance" page, opened from the private link the host sends.
// Shows the itemised bill, the online payment button and, when the host allows it,
// the manual payment details with a form to send a proof of payment.

import { get, post, api, ApiError, newIdempotencyKey } from '../api.js';
import { h, brand, toast, field, readForm, showErrors, clearErrors, parseAmount } from '../ui.js';
import { t, tServer, guestLang, tFields, initGuestLang, langToggle, keepFormValues, restoreFormValues, fmtDateL as fmtDate, extendTranslations } from '../i18n.js';

// Money owed is always shown with centavos (₱600.00), like the emails and receipts.
const peso = (v) => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// The amount box starts at what is still owed: a whole amount has no centavos (17600), a fraction keeps two (17600.50).
// Rounding to centavos first drops float residue left by subtracting proofs from the balance.
export const prefillAmount = (v) => { const n = Math.round(Number(v) * 100) / 100; return Number.isInteger(n) ? String(n) : n.toFixed(2); };

const METHOD_TEXT = { gcash: 'GCash', maya: 'Maya', bank_transfer: 'Bank transfer', other: 'Other', cash: 'Cash', card: 'Card', channel_payout: 'Booking platform', check: 'Check' };
const PROOF_METHODS = [['gcash', 'GCash'], ['maya', 'Maya'], ['bank_transfer', 'Bank transfer'], ['other', 'Other']];
const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_PROOF_BYTES = 10 * 1024 * 1024;

extendTranslations({
  'Too many attempts': 'Napakaraming subok',
  'Something went wrong': 'May nagkaproblema',
  'Already on your bill': 'Nasa bill mo na',
  '{n} already on your bill': '{n} na ang nasa bill mo',
  'Upload a JPG, PNG, WEBP or PDF file up to 10 MB.': 'Mag-upload ng JPG, PNG, WEBP o PDF na file na hanggang 10 MB.',
  'Accommodation (1 night)': 'Tuluyan (1 gabi)',
  'Accommodation ({n} nights)': 'Tuluyan ({n} na gabi)',
  'Cleaning fee': 'Bayad sa paglilinis',
  'Other fees': 'Iba pang bayarin',
  'There are already 5 payment proofs waiting for the host to check. Please wait for the host to review them before you send another.':
    'May 5 nang patunay ng bayad na naghihintay pang i-check ng host. Maghintay muna na ma-review nila ang mga ito bago magpadala ulit.',
  'Payment received': 'Bayad na natanggap',
  'Balance due': 'Babayaran pa',
  'Adjustments': 'Mga adjustment',
  'Refunded to you, added back to the balance': 'Ibinalik sa iyo, idinagdag ulit sa babayaran',
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
  'Sent {amount} by {method} on {date}.': 'Naipadala ang {amount} sa pamamagitan ng {method} noong {date}.',
  'Waiting for the host to check it.': 'Naghihintay na i-check ng host.',
  'Sent, but there is no screenshot yet.': 'Naipadala na, pero wala pang screenshot.',
  'Proofs waiting for the host': 'Mga patunay na naghihintay sa host',
  'Add the screenshot': 'Idagdag ang screenshot',
  'Take it back': 'Bawiin ito',
  'Taking back…': 'Binabawi…',
  'Could not take it back. Please try again.': 'Hindi nabawi. Pakisubukan ulit.',
  'Your proofs already cover what you owe. The host will check them soon.': 'Sapat na ang mga patunay mo para sa utang mo. I-check na ito ng host maya-maya.',
  "You already sent proofs for {sent} that the host hasn't checked yet, so you can send up to {left} more.": 'Nakapadala ka na ng patunay na {sent} na hindi pa na-check ng host, kaya hanggang {left} pa lang ang puwede mong ipadala.',
  'Choose a screenshot or receipt.': 'Pumili ng screenshot o resibo.',
  'Choose a different file and send again.': 'Pumili ng ibang file at ipadala ulit.',
  'Uploading the screenshot…': 'Ina-upload ang screenshot…',
  'Thank you! Your proof was sent.': 'Salamat! Naipadala na ang patunay.',
  '{host} will check the payment and confirm it. You will get an email when it is confirmed.': 'Titingnan ni {host} ang bayad at kukumpirmahin ito. Makakatanggap ka ng email kapag kumpirmado na.',
  'Other': 'Iba pa',
  'Add to your stay': 'Idagdag sa stay mo',
  'Pick extras before you arrive. They are added to your bill.': 'Pumili ng dagdag bago ka dumating. Idadagdag ito sa bill mo.',
  'Quantity for {name}': 'Dami para sa {name}',
  'Select': 'Piliin',
  'Select {name}': 'Piliin ang {name}',
  'Add selected to my bill': 'Idagdag ang napili sa bill ko',
  'Adding…': 'Idinadagdag…',
  'Choose at least one extra.': 'Pumili ng kahit isang dagdag.',
  'Added to your bill.': 'Naidagdag na sa bill mo.',
  'per stay': 'bawat stay',
  'per night': 'bawat gabi',
  'per guest': 'bawat bisita',
  'per guest per night': 'bawat bisita bawat gabi',
});

// The heading follows the cause: only a 404 is a bad link.
const failTitle = (err) => (err.status === 404 ? t('Link not found') : err.status === 429 ? t('Too many attempts') : t('Something went wrong'));

const PRICING_TEXT = { per_stay: 'per stay', per_night: 'per night', per_guest: 'per guest', per_guest_night: 'per guest per night' };

// `snap` comes from a language switch (keepFormValues): what the guest typed or ticked goes back after the redraw.
export async function payBalanceView(el, { params, query }, snap) {
  initGuestLang();
  const token = params.token;
  const page = (...children) => h('div', { class: 'gc' },
    h('header', { class: 'gc__top gc__top--lang' }, brand(null), langToggle(() => payBalanceView(el, { params, query: {} }, keepFormValues(el)))),
    h('main', { class: 'gc__main', id: 'main' }, children),
    h('p', { class: 'gc__foot muted small' }, t('Payments are processed securely by PayMongo. '), h('a', { href: '#/privacy' }, t('Privacy notice'))));
  let d;
  try { d = await get(`/public/pay/${encodeURIComponent(token)}`); } catch (err) {
    el.replaceChildren(page(h('div', { class: 'card' }, h('h1', null, failTitle(err)), h('p', { class: 'muted' }, tServer(err.message)))));
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
  const payError = h('div');
  const btn = h('button', { class: 'btn btn--primary btn--block', type: 'button' }, t('Pay {amount} now', { amount: peso(d.balance) }));
  btn.addEventListener('click', async () => {
    payError.replaceChildren();
    btn.disabled = true;
    btn.textContent = t('Opening secure payment…');
    try {
      const r = await post(`/public/pay/${encodeURIComponent(token)}/checkout`);
      location.href = r.checkout_url;
    } catch (err) {
      payError.replaceChildren(h('div', { class: 'alert alert--error', role: 'alert' }, tServer(err.message)));
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
          : d.accepting ? [payError, btn, h('p', { class: 'muted small' }, t('GCash, Maya, cards and GrabPay. You get an email receipt.'))]
            : d.manual_payments?.accepting ? null
              : h('div', { class: 'alert alert--info' }, t('Online payment is not available for this booking. Please contact your host.'))),
    !d.cancelled && addonsCard(token, () => payBalanceView(el, { params, query: {} }), snap),
    !d.cancelled && d.manual_payments?.accepting && manualCard(d, token, () => payBalanceView(el, { params, query: {} }))));
  restoreFormValues(el, snap);
}

// Pre-arrival extras the host offers (airport pickup, early check-in…). Hidden when there are none or the
// server says it is too late; choosing some adds charges to the bill, then the page reloads with the new balance.
function addonsCard(token, reload, snap) {
  const card = h('div', { class: 'card', hidden: true });
  get(`/public/pay/${encodeURIComponent(token)}/addons`).then((r) => {
    const list = r?.addons || [];
    if (!list.length) return;
    const qty = {};
    const err = h('div', { role: 'alert' });
    const rows = list.map((a) => {
      const name = (guestLang() === 'tl' && a.name_tl) || a.name;
      // `left` is what the stay can still add (the limit counts per stay); older servers don't send it.
      const left = a.left == null ? null : Math.max(0, Number(a.left) || 0);
      const max = left == null ? Math.max(1, Number(a.max_quantity) || 1) : left;
      const input = h('input', { class: 'input', type: 'number', min: 0, max, value: 0, inputmode: 'numeric', id: `addon-${a.addon_id}`, name: `addon-qty-${a.addon_id}`, 'aria-label': t('Quantity for {name}', { name }) });
      // The box shows the number that will be bought: an entry over the maximum or below zero is clamped and written back.
      input.addEventListener('input', () => {
        const n = Math.max(0, Math.min(max, Math.floor(Number(input.value) || 0)));
        qty[a.addon_id] = n;
        if (input.value !== '' && Number(input.value) !== n) input.value = String(n);
      });
      return h('div', { class: 'gp-addon' },
        h('div', null, h('strong', null, name), a.description && h('div', { class: 'muted small' }, a.description),
          left > 0 && Number(a.bought) > 0 && h('div', { class: 'muted small' }, t('{n} already on your bill', { n: Number(a.bought) }))),
        h('div', { class: 'gp-addon__price' }, `${peso(a.price)} `, h('span', { class: 'muted small' }, t(PRICING_TEXT[a.pricing] || ''))),
        left === 0 ? h('div', { class: 'gp-addon__qty muted small' }, t('Already on your bill'))
          : max > 1 ? h('div', { class: 'gp-addon__qty' }, h('label', { for: input.id, class: 'small' }, t('Quantity for {name}', { name })), input)
          : h('label', { class: 'check gp-addon__qty' }, h('input', { type: 'checkbox', name: `addon-pick-${a.addon_id}`, 'aria-label': t('Select {name}', { name }), oninput: (e) => { qty[a.addon_id] = e.target.checked ? 1 : 0; } }), h('span', null, t('Select'))));
    });
    const btn = h('button', { class: 'btn btn--primary btn--block', type: 'button' }, t('Add selected to my bill'));
    btn.addEventListener('click', async () => {
      err.replaceChildren();
      const selections = Object.entries(qty).filter(([, q]) => q > 0).map(([addon_id, quantity]) => ({ addon_id, quantity }));
      if (!selections.length) { err.replaceChildren(h('div', { class: 'alert alert--error' }, t('Choose at least one extra.'))); return; }
      btn.disabled = true;
      btn.textContent = t('Adding…');
      try {
        await post(`/public/pay/${encodeURIComponent(token)}/addons`, { selections }, { idempotencyKey: newIdempotencyKey() });
        toast(t('Added to your bill.'));
        reload();
      } catch (e) {
        err.replaceChildren(h('div', { class: 'alert alert--error' }, e.offline ? t("You're offline. Please try again when you're connected.") : tServer(e.message)));
        btn.disabled = false;
        btn.textContent = t('Add selected to my bill');
      }
    });
    card.replaceChildren(h('h2', null, t('Add to your stay')), h('p', { class: 'muted small' }, t('Pick extras before you arrive. They are added to your bill.')), h('div', { class: 'stack' }, h('div', { class: 'gp-addons' }, rows), err, btn)); // .stack puts the same gap above the button as between rows
    card.hidden = false;
    restoreFormValues(card, snap); // the extras load after the page, so their choices go back here
  }).catch(() => {}); // not offered, or too late: simply don't show the card
  return card;
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
    b.charges.map((c) => {
      const name = (guestLang() === 'tl' && c.name_tl) || c.description;
      return line(c.quantity > 1 ? `${name} (${c.quantity} × ${peso(c.unit_price)})` : name, peso(c.amount));
    }),
    line(t('Total'), h('strong', null, peso(b.total))),
    b.payments.map((p) => line(`${t('Payment received')} · ${fmtDate(p.payment_date)} · ${METHOD_TEXT[p.payment_method] || p.payment_method}`, `−${peso(p.amount)}`)),
    (b.refunds || []).map((r) => line(`${t('Refunded to you, added back to the balance')} · ${fmtDate(r.refund_date)}`, `+${peso(r.amount)}`)),
    Number(b.adjustments) > 0 && line(t('Adjustments'), `−${peso(b.adjustments)}`),
    // A cancelled booking owes nothing (APP-FLOW 6.4), so there is no balance line.
    !d.cancelled && line(t('Balance due'), h('strong', null, peso(d.balance))));
}

// Pay by GCash, Maya or bank transfer: the host's payment details, then a form to send the proof.
function manualCard(d, token, reload) {
  const card = h('div', { class: 'card' });
  // What the guest can still send: the balance less the proofs the host hasn't checked yet.
  const pendingTotal = Number(d.manual_payments.pending_total) || 0;
  const left = Math.max(0, Number(d.balance) - pendingTotal);
  const sent = () => card.replaceChildren(h('div', { class: 'gc__done' },
    h('div', { class: 'gc__tick', 'aria-hidden': 'true' }, '✓'),
    h('h2', null, t('Thank you! Your proof was sent.')),
    h('p', { class: 'muted' }, t('{host} will check the payment and confirm it. You will get an email when it is confirmed.', { host: d.host }))));
  card.replaceChildren(
    h('h2', null, t('Pay by GCash, Maya or bank transfer')),
    h('div', { class: 'gc__instructions', style: { whiteSpace: 'pre-line' } }, d.manual_payments.instructions || ''),
    h('p', { class: 'muted small' }, t('Pay the amount, then send the proof below. {host} checks each payment and confirms it.', { host: d.host })),
    pendingList(d.manual_payments.pending || [], token, reload),
    left > 0 ? proofForm(d, token, sent, left, pendingTotal)
      : h('div', { class: 'alert alert--info' }, t('Your proofs already cover what you owe. The host will check them soon.')));
  return card;
}

// The proofs already sent and not yet checked, so a reload doesn't make them vanish (#6). One with no
// screenshot yet can get it now, or be taken back (the same DELETE the form uses).
function pendingList(list, token, reload) {
  if (!list.length) return null;
  const base = (id) => `/public/pay/${encodeURIComponent(token)}/proofs/${encodeURIComponent(id)}`;
  return h('div', { class: 'gc__pending' },
    h('h3', null, t('Proofs waiting for the host')),
    list.map((p) => {
      const msg = h('div', { role: 'alert' });
      const row = h('div', { class: 'alert alert--info' },
        h('p', null, t('Sent {amount} by {method} on {date}.', { amount: peso(p.amount), method: METHOD_TEXT[p.method] || p.method, date: fmtDate(p.sent_at) }), ' ',
          p.has_file ? t('Waiting for the host to check it.') : t('Sent, but there is no screenshot yet.')), msg);
      if (!p.has_file) {
        const file = h('input', { type: 'file', accept: PROOF_TYPES.join(','), class: 'input', 'aria-label': t('Screenshot or receipt') });
        const add = h('button', { class: 'btn btn--primary', type: 'button' }, t('Add the screenshot'));
        const back = h('button', { class: 'btn', type: 'button' }, t('Take it back'));
        add.addEventListener('click', async () => {
          const f = file.files[0];
          msg.replaceChildren();
          if (!f) { msg.replaceChildren(h('div', { class: 'alert alert--error' }, t('Choose a screenshot or receipt.'))); return; }
          if (!f.size) { msg.replaceChildren(h('div', { class: 'alert alert--error' }, t('This file is empty. Choose the file again.'))); return; } // D-111
          if (f.size > MAX_PROOF_BYTES || !PROOF_TYPES.includes(f.type)) { msg.replaceChildren(h('div', { class: 'alert alert--error' }, t('Upload a JPG, PNG, WEBP or PDF file up to 10 MB.'))); return; }
          add.disabled = true; back.disabled = true;
          add.textContent = t('Uploading the screenshot…');
          try {
            await api('POST', `${base(p.proof_id)}/image`, undefined, { rawBody: f, headers: { 'Content-Type': f.type } });
            reload();
          } catch (err) {
            msg.replaceChildren(h('div', { class: 'alert alert--error' }, err.offline ? t("You're offline. Please try again when you're connected.") : tServer(err.message)));
            add.disabled = false; back.disabled = false;
            add.textContent = t('Add the screenshot');
          }
        });
        back.addEventListener('click', async () => {
          add.disabled = true; back.disabled = true;
          back.textContent = t('Taking back…');
          try {
            await api('DELETE', base(p.proof_id));
            reload();
          } catch (err) {
            msg.replaceChildren(h('div', { class: 'alert alert--error' }, err.offline ? t("You're offline. Please try again when you're connected.") : tServer(err.message) || t('Could not take it back. Please try again.')));
            add.disabled = false; back.disabled = false;
            back.textContent = t('Take it back');
          }
        });
        row.append(h('div', { class: 'field' }, file), h('div', { class: 'btn-row' }, add, back));
      }
      return row;
    }));
}

// The proof form: amount, method, reference, payer name and a screenshot. It goes in two steps,
// the details first and then the screenshot. If the screenshot is refused, the saved proof is taken
// back so the guest can correct the details and send again. If it can't be taken back, trying again
// only re-sends the screenshot, so the payment is never recorded twice.
function proofForm(d, token, onSent, left, pendingTotal) {
  let proofId = null;
  const form = h('form', { class: 'form', novalidate: true });
  const formError = h('div', { class: 'form-error' });
  const progress = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const photo = h('input', { type: 'file', id: 'proof-file', accept: PROOF_TYPES.join(','), class: 'input' });
  const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, t('Send proof'));
  const alertBox = (msg) => h('div', { class: 'alert alert--error', role: 'alert' }, msg);
  // The server only lets a pending proof with no file go. If that fails too, the details stay locked.
  const withdraw = async () => {
    try {
      await api('DELETE', `/public/pay/${encodeURIComponent(token)}/proofs/${encodeURIComponent(proofId)}`);
    } catch {
      return false;
    }
    proofId = null;
    form.querySelectorAll('[name]').forEach((el) => { el.disabled = false; });
    photo.value = '';
    return true;
  };
  form.append(
    formError,
    field({ name: 'amount', label: t('Amount paid'), type: 'money', required: true, value: prefillAmount(left) }),
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
    const amount = parseAmount(v.amount);
    const problems = {};
    if (!(amount > 0)) problems.amount = t('Enter the amount you paid.');
    else if (amount > Number(d.balance)) problems.amount = t('This is more than the balance of {amount}.', { amount: peso(d.balance) });
    else if (amount > left + 0.001) problems.amount = t("You already sent proofs for {sent} that the host hasn't checked yet, so you can send up to {left} more.", { sent: peso(pendingTotal), left: peso(left) });
    if (Object.keys(problems).length) { showErrors(form, problems); return; }
    if (!file) { formError.replaceChildren(alertBox(t('Choose a screenshot or receipt.'))); return; }
    if (!file.size) { formError.replaceChildren(alertBox(t('This file is empty. Choose the file again.'))); return; } // D-111
    if (file.size > MAX_PROOF_BYTES) { formError.replaceChildren(alertBox(t('Upload a JPG, PNG, WEBP or PDF file up to 10 MB.'))); return; }
    if (!PROOF_TYPES.includes(file.type)) { formError.replaceChildren(alertBox(t('Upload a JPG, PNG, WEBP or PDF file up to 10 MB.'))); return; }
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
      // Only a failed screenshot comes after a saved proof, so only then is there one to take back.
      const taken = proofId && await withdraw();
      formError.replaceChildren(alertBox(err.offline ? t("You're offline. Please try again when you're connected.")
        : taken ? `${msg} ${t('Choose a different file and send again.')}` : msg));
      if (err.fields) showErrors(form, tFields(err.fields));
      progress.textContent = '';
      submit.disabled = false;
      submit.textContent = t('Send proof');
    }
  });
  return form;
}
