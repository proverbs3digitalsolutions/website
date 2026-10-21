// The owner's "Have a coupon code?" box on Plan & billing (contract: docs/contracts/platform-coupons.md, section 2).
// It is built once and updated in place, so focus never leaves the code box after an error or an Apply.

import { post } from '../api.js';
import { h } from '../ui.js';

// Money owed, charged, paid, totalled or saved always shows two decimals (D-86).
export function money(v) {
  return `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
// Advertised prices and "₱100 off" describe an offer, not a charge: whole pesos stay short.
export const plain = (v) => {
  const n = Number(v || 0);
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: Math.round(n * 100) % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
};

// "50% off your first 3 months", "₱100 off every month", "Free for your first month".
export function couponText(c) {
  const what = c.kind === 'percent' ? `${c.percent_off}% off` : c.kind === 'fixed' ? `${plain(c.amount_off)} off` : 'Free';
  const span = c.duration === 'forever' ? 'every month'
    : c.duration === 'once' || Number(c.duration_months) === 1 ? 'your first month' : `your first ${c.duration_months} months`;
  return `${what}${c.kind === 'free' && c.duration !== 'forever' ? ' for' : ''} ${span}`;
}

export function couponBox({ current, getSelection, onQuote, initialCode }) {
  const live = current && (current.status === 'active' || current.status === 'pending');
  const usedUp = current && current.status === 'used_up'; // no code needed to ask what a full-price payment looks like
  let code = '';
  // The last code the server refused (upper-cased): a plan or months change does not send it again, because each send counts as a failed try.
  // COUPON_PLAN depends on the plan only, so a months change still skips it; COUPON_AHEAD depends on the selection, so it is never remembered.
  let refused = null;
  let seq = 0; // only the newest answer counts, so a quick change never shows a stale total

  const msg = h('div', { class: 'error', role: 'alert', id: 'coupon-code-err' });
  const ok = h('div', { class: 'alert alert--ok', hidden: true });
  const okText = h('span');
  const remove = h('button', { class: 'link-btn', type: 'button', onclick: () => {
    seq += 1; code = ''; input.value = ''; setMsg(''); ok.hidden = true; onQuote(null); input.focus();
  } }, 'Remove');
  ok.append(okText, ' ', remove);
  // The refusal is tied to the code box so a screen reader hears it with the field.
  const setMsg = (text) => {
    msg.textContent = text;
    if (text) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', 'coupon-code-err'); }
    else { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
  };

  const refresh = async (asked = false) => {
    const my = ++seq;
    if (!live && !asked) { code = input.value.trim(); if (!code) refused = null; } // the field is the truth: emptied means no code
    if (!asked && code && refused && code.toUpperCase() === refused.code && (!refused.plan || refused.plan === getSelection().plan)) { code = ''; return; } // each re-send would count as another failed try; a refused code is never sent with a payment (D-116)
    if (!live && !code && !usedUp) { setMsg(''); ok.hidden = true; onQuote(null); return; }
    const sel = getSelection();
    let q;
    try {
      q = await post('/billing/coupon/preview', { ...(code ? { code } : {}), plan: sel.plan, months: String(sel.months) });
    } catch (err) {
      if (my !== seq) return;
      refused = err.code === 'COUPON_AHEAD' ? null : { code: code.toUpperCase(), plan: err.code === 'COUPON_PLAN' ? sel.plan : null };
      ok.hidden = true; setMsg(err.message); onQuote(null);
      return;
    }
    if (my !== seq) return;
    setMsg(''); refused = null;
    if (!live) {
      ok.hidden = !q.coupon;
      if (q.coupon) {
        // A free coupon that still needs a card says what the card is charged.
        // q.message (the picker line) can already say it: then it is said once.
        const cardNote = q.card_only && q.min_charge_applied && q.coupon.kind === 'free' && !(q.message && q.message.includes('once by card')) ? ` You pay ${money(q.amount)} once by card.` : '';
        // The line under the plan picker (q.message) already says the discount for a one-month or ongoing coupon: say it once.
        const offer = couponText(q.coupon);
        okText.textContent = `${q.coupon.code} applied${q.message && q.message.includes(offer) ? '.' : `: ${offer}.`}${cardNote}`;
      }
    }
    onQuote(q);
  };
  const apply = () => {
    code = input.value.trim();
    if (!code) { setMsg('Enter your coupon code.'); input.focus(); return; } // the message is about the box, so focus goes there
    refresh(true);
  };

  const input = h('input', { class: 'input', type: 'text', name: 'coupon_code', autocomplete: 'off', autocapitalize: 'characters', maxlength: 32, 'aria-label': 'Coupon code',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } } });
  const form = h('div', null,
    h('div', { class: 'coupon-row' }, input, h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: apply }, 'Apply')),
    h('div', { class: 'field' }, msg), ok);

  let box;
  if (live) {
    const offer = couponText(current);
    // "every month" already says it all; otherwise count the months left.
    const left = offer.includes('every month') || current.months_left == null ? ''
      : ` ${current.months_left} month${current.months_left === 1 ? '' : 's'} left.`;
    box = h('div', null, h('div', { class: 'alert alert--ok' }, `Coupon ${current.code}: ${offer}.${left}`),
      h('div', { class: 'field' }, msg));
  } else {
    box = h('details', { class: 'form-section' }, h('summary', null, 'Have a coupon code?'),
      current && current.status === 'used_up' && h('p', { class: 'muted small' }, `Your coupon ${current.code} is used up.`),
      form);
  }
  // A code the person typed survives a redraw of the page (D-106): the new box starts with it, open.
  if (!live && typeof initialCode === 'string' && initialCode) { input.value = initialCode; code = initialCode; box.open = true; }
  box.refresh = refresh;
  box.getCode = () => code;
  // A refusal at pay time (the code was switched off, used up, or is not for this plan) drops the discount on screen too:
  // no "applied" line, the list price, and the next press pays without the code. Apply still asks again on purpose (D-116).
  box.showError = (text) => {
    if (box.tagName === 'DETAILS') box.open = true;
    if (!live) { if (code) refused = { code: code.toUpperCase(), plan: null }; code = ''; seq += 1; ok.hidden = true; onQuote(null); }
    setMsg(text);
  };
  return box;
}
