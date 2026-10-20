// Confirm your payment card (D-98): the owner pays ₱20 by card before the 14-day trial starts.
// The card fields post straight from this page to PayMongo with the public key. BalayHub's own server only ever
// receives the PayMongo payment method id (POST /billing/card-check/:id/attach), never a card number, expiry or CVC.

import { get, post } from '../api.js';
import { h, fmtDate } from '../ui.js';
import { state, navigate, refreshUser, logout, homeRoute } from '../app.js';

export const poll = { ms: 3000, max: 60000, attachMs: 50, attachMax: 10000 }; // refresh every 3 s for up to 60 s after the bank page (a test may shorten these)

const MSG = {
  name: 'Enter the name on the card.',
  number: 'Enter the card number.',
  numberBad: "This card number isn't valid. Check it and try again.",
  exp: 'Enter the expiry as MM/YY.',
  expired: 'This card has expired.',
  cvc: 'Enter the 3 or 4 digit code on the back of the card.',
  consent: 'Tick the box to agree to automatic payment.',
  declined: 'Your card was declined. Try another card, or ask your bank.',
  bank: "Your bank's check wasn't finished, so nothing was charged. Try again.",
  network: "We couldn't reach the payment service. Nothing was charged. Please try again in a moment.",
  rate: 'Too many tries. Please wait a few minutes and try again.',
};

// The server's own wait (retry_after seconds on a 429), so the page never promises a few minutes when the limit lasts an hour or a day (D-111).
export function rateText(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return MSG.rate;
  const m = Math.ceil(s / 60);
  if (m < 60) return `Too many tries. Please try again in ${m} minute${m === 1 ? '' : 's'}.`;
  const hrs = Math.round(m / 60);
  return `Too many tries. Please try again in about ${hrs === 1 ? 'an hour' : `${hrs} hours`}.`;
}

export function luhnOk(digits) {
  const s = String(digits);
  if (!/^\d{12,19}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    let d = Number(s[s.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

// '12/30', '12/2030' or '1230' -> { month: 12, year: 2030 }; anything else is null.
export function parseExpiry(text) {
  const m = /^\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})\s*$/.exec(String(text)) || /^\s*(\d{2})(\d{2})\s*$/.exec(String(text));
  if (!m) return null;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return null;
  return { month, year: m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]) };
}

// { field: message } for every bad field; {} when the card looks fine. A card works through the end of its expiry month.
export function cardProblems({ name, number, exp, cvc }, today = new Date()) {
  const out = {};
  if (!String(name || '').trim()) out.name = MSG.name;
  const digits = String(number || '').replace(/[\s-]/g, '');
  if (!digits) out.number = MSG.number;
  else if (!luhnOk(digits)) out.number = MSG.numberBad;
  const e = parseExpiry(exp);
  if (!e) out.exp = MSG.exp;
  else if (e.year < today.getFullYear() || (e.year === today.getFullYear() && e.month < today.getMonth() + 1)) out.exp = MSG.expired;
  if (!/^\d{3,4}$/.test(String(cvc || '').trim())) out.cvc = MSG.cvc;
  return out;
}

// The router attaches the page after the view returns, so focus() on a detached node does nothing: focus once it is attached (not awaited by the caller).
async function focusWhenAttached(el, node) {
  node.focus();
  for (const t = Date.now(); el.isConnected === false && Date.now() - t < poll.attachMax;) await new Promise((ok) => setTimeout(ok, poll.attachMs));
  if (el.isConnected !== false) node.focus();
}

const peso = (n) => `₱${Number(n).toLocaleString('en-PH')}`;
let seq = 0;

function footer() {
  return h('p', { class: 'cc-footer' },
    h('a', { href: '#/help', class: 'link-tap' }, 'Help'),
    h('a', { href: '#/account', class: 'link-tap' }, 'Account'),
    h('button', { type: 'button', class: 'link-btn', onclick: logout }, 'Log out'));
}

function waitingForOwner() {
  const who = state.user?.owner_name || 'Your workspace owner';
  return h('div', { class: 'card cc-card' },
    h('h1', null, 'Waiting for your workspace owner'),
    h('p', null, `${who} needs to confirm a payment card before your team can use BalayHub. Ask them to log in and finish setup.`),
    footer());
}

export async function cardCheckView(el, { query = {} } = {}) {
  if (state.user?.role !== 'owner') { el.append(waitingForOwner()); return; }
  const info = await get('/billing/card-check');
  if (info.status !== 'required') {
    // The card is already confirmed. Refresh the user BEFORE leaving: with a stale card_check_due the route rule sends
    // the owner straight back here and the two pages ping-pong. Never navigate while the user still looks card-due.
    let fresh = true;
    try { await refreshUser(); } catch { fresh = false; }
    const stale = !fresh || state.user?.plan?.card_check_due;
    if ((info.status === 'passed' && query.check) || stale) {
      if (query.check) history.replaceState(history.state, '', '#/confirm-card');
      const done = h('h2', { tabindex: '-1' }, 'Your card is confirmed');
      const next = state.user?.business_type === 'long_term' ? '#/properties?new=1' : '#/launchpad';
      el.append(h('div', { class: 'card cc-card' }, h('h1', null, 'Confirm your payment card'),
        h('div', { class: 'cc-success', role: 'status' }, done,
          h('p', null, `Your free trial has started. It ends on ${fmtDate(info.trial_would_end)}.`),
          h('a', { class: 'btn btn--primary', href: query.check ? next : '#/' }, query.check ? 'Set up my workspace' : 'Continue')),
        footer()));
      focusWhenAttached(el, done);
      return;
    }
    if (!stale) navigate(homeRoute(), { replace: true });
    return;
  }

  const stage2 = Boolean(info.subscriptions);
  const plans = info.plans || [];
  let plan = plans.some((p) => p.key === info.renewal_plan) ? info.renewal_plan : (plans.find((p) => p.key === 'growth') || plans[0] || {}).key;
  const ends = fmtDate(info.trial_would_end);
  let stopped = false;
  // The router draws a view into a detached page and attaches it afterwards, so "not attached yet" is not "left the page":
  // only a page that was attached and then removed (or never attached within attachMax) stops the polling.
  const connected = () => el.isConnected !== false;
  const born = Date.now();
  let attached = connected();
  const alive = () => {
    if (stopped) return false;
    if (connected()) { attached = true; return true; }
    return !attached && Date.now() - born < poll.attachMax;
  };
  const planOf = () => plans.find((p) => p.key === plan) || {};

  // ---- what happens (the plan line follows the pick, updated in place)
  const lastLine = h('li');
  const drawLast = () => {
    const p = planOf();
    const label = `${p.name} (${peso(p.price)} a month)`;
    lastLine.textContent = stage2
      ? `Your trial ends on ${ends}. Then we charge ${label} to this card every month until you cancel. You can cancel anytime in Settings, Plan & billing, and you won't be charged again after you cancel.`
      : `Your trial ends on ${ends}. Then pay for ${label} with this card in one tap. We'll email you 3 days and 1 day before. Nothing is charged automatically. If you don't pay, your workspace becomes view-only, and nothing is deleted.`;
  };

  // ---- plan buttons (never replaced while pressed: only their attributes change)
  const pickers = plans.map((p) => {
    const text = `${p.name} · ${peso(p.price)}/mo${p.listings ? ` · Up to ${p.listings} listings` : ''}`;
    const b = h('button', { type: 'button', class: 'plan-mini__item plan-mini__pick', 'aria-pressed': 'false', 'aria-label': text,
      onclick: () => { plan = p.key; markPlans(); drawLast(); } },
    h('strong', null, p.name), h('span', null, `${peso(p.price)}/mo`), p.listings ? h('span', { class: 'muted small' }, `Up to ${p.listings} listings`) : null);
    return [p.key, b];
  });
  const markPlans = () => pickers.forEach(([k, b]) => { b.setAttribute('aria-pressed', String(k === plan)); b.className = `plan-mini__item plan-mini__pick${k === plan ? ' is-current' : ''}`; });

  // ---- card fields
  const fields = {};
  const mk = (key, labelText, props) => {
    const id = `cc-${key}-${++seq}`;
    const input = h('input', { id, class: 'input', type: 'text', 'aria-describedby': `${id}-err`, ...props });
    const err = h('div', { class: 'error', id: `${id}-err` });
    const wrap = h('div', { class: 'field' }, h('label', { for: id }, labelText, h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')), input, err);
    fields[key] = { input, err, wrap };
    return wrap;
  };
  const nameF = mk('name', 'Name on card', { autocomplete: 'cc-name', maxlength: 120 });
  const numF = mk('number', 'Card number', { autocomplete: 'cc-number', inputmode: 'numeric', maxlength: 23 });
  const expF = mk('exp', 'Expiry (MM/YY)', { autocomplete: 'cc-exp', inputmode: 'numeric', maxlength: 7, placeholder: 'MM/YY' });
  const cvcF = mk('cvc', 'CVC', { autocomplete: 'cc-csc', inputmode: 'numeric', maxlength: 4 });
  // 123 becomes 12/3 so a numeric phone keypad needs no slash key
  fields.exp.input.addEventListener('input', () => {
    const v = fields.exp.input.value;
    if (/^\d{3,}$/.test(v)) fields.exp.input.value = `${v.slice(0, 2)}/${v.slice(2)}`;
    clearOne(fields.exp);
  });

  const consentBox = stage2 && h('input', { type: 'checkbox', id: 'cc-consent', 'aria-describedby': 'cc-consent-err' });
  const consentErr = h('div', { class: 'error', id: 'cc-consent-err' });
  fields.consent = { input: consentBox, err: consentErr };

  const summary = h('div', { class: 'alert alert--error', role: 'alert', tabindex: '-1', hidden: true });
  const btn = h('button', { type: 'button', class: 'btn btn--primary btn--block', onclick: () => submit() }, 'Pay ₱20 and start my trial');
  let busy = false;
  const setBusy = (on) => {
    busy = on;
    btn.setAttribute('aria-disabled', String(on)); // aria-disabled, not disabled, so a focused button keeps focus
    btn.textContent = on ? 'Checking your card…' : 'Pay ₱20 and start my trial';
  };
  const showSummary = (text) => { summary.textContent = text; summary.hidden = false; summary.focus(); };
  const clearErrors = () => {
    summary.hidden = true; summary.textContent = '';
    for (const f of Object.values(fields)) {
      if (!f.input) continue;
      f.err.textContent = ''; f.input.removeAttribute('aria-invalid');
      f.wrap?.classList.remove('field--invalid');
    }
  };

  // Typing in a field (or ticking the box) clears that field's own message and mark; the summary goes with the last one. Focus never moves.
  const clearOne = (f) => {
    f.err.textContent = ''; f.input.removeAttribute('aria-invalid');
    f.wrap?.classList.remove('field--invalid');
    if (!Object.values(fields).some((x) => x.input && x.input.getAttribute('aria-invalid'))) { summary.hidden = true; summary.textContent = ''; }
  };
  for (const k of ['name', 'number', 'cvc']) fields[k].input.addEventListener('input', () => clearOne(fields[k]));
  if (consentBox) consentBox.addEventListener('change', () => clearOne(fields.consent));

  const panel = h('div');
  const heading = (text) => { const e = h('h2', { tabindex: '-1' }, text); return e; };

  function showSuccess(trialEnd) {
    stopped = true;
    const done = heading('Your card is confirmed');
    const next = state.user?.business_type === 'long_term' ? '#/properties?new=1' : '#/launchpad';
    panel.replaceChildren(h('div', { class: 'cc-success', role: 'status' }, done,
      h('p', null, `Your free trial has started. It ends on ${fmtDate(trialEnd || info.trial_would_end)}.`),
      h('a', { class: 'btn btn--primary', href: next }, 'Set up my workspace')));
    done.focus();
  }

  function showForm(problem) {
    panel.replaceChildren(formEl);
    if (problem) showSummary(problem);
  }

  // Checks the bank-side result every 3 s for up to a minute, then leaves a Check again button.
  async function waitForBank(id) {
    const wait = heading('Checking with your bank…');
    panel.replaceChildren(h('div', { class: 'cc-wait', 'aria-live': 'polite' }, wait, h('p', null, 'This usually takes a few seconds.')));
    wait.focus();
    while (alive() && !connected()) await new Promise((ok) => setTimeout(ok, poll.attachMs));
    if (!alive()) return;
    wait.focus(); // the first focus() hit a detached page
    const start = Date.now();
    while (alive()) {
      let r = { status: 'pending' };
      try { r = await post(`/billing/card-check/${encodeURIComponent(id)}/refresh`); } catch { /* keep waiting */ }
      if (!alive()) return;
      if (r.status === 'passed') { await refreshUser(); showSuccess(r.trial_ends_at); return; }
      if (r.status === 'failed' || r.status === 'expired') { showForm(r.message || MSG.bank); return; }
      if (Date.now() - start >= poll.max) break;
      await new Promise((ok) => setTimeout(ok, poll.ms));
    }
    if (!alive()) return;
    const again = h('button', { type: 'button', class: 'btn btn--secondary', onclick: () => waitForBank(id) }, 'Check again');
    panel.replaceChildren(h('div', { class: 'cc-wait', 'aria-live': 'polite' }, heading('Checking with your bank…'),
      h('p', null, 'Still waiting for your bank. You can leave this page. Your trial starts as soon as the payment comes through.'), again));
    again.focus();
  }

  async function submit() {
    if (busy) return;
    clearErrors();
    const vals = { name: fields.name.input.value, number: fields.number.input.value, exp: fields.exp.input.value, cvc: fields.cvc.input.value };
    const bad = cardProblems(vals);
    if (stage2 && !consentBox.checked) bad.consent = MSG.consent;
    const first = ['name', 'number', 'exp', 'cvc', 'consent'].find((k) => bad[k]);
    if (first) {
      for (const [k, msg] of Object.entries(bad)) {
        const f = fields[k];
        f.err.textContent = msg; f.input.setAttribute('aria-invalid', 'true'); f.wrap?.classList.add('field--invalid');
      }
      fields[first].input.focus();
      return;
    }
    setBusy(true);
    let id = null;
    try {
      const started = await post('/billing/card-check/start', stage2 ? { renewal_plan: plan, consent: true } : { renewal_plan: plan });
      id = started.billing_id;
      if (started.status === 'passed') { // an earlier try already went through: no card goes to PayMongo
        fields.number.input.value = ''; fields.cvc.input.value = '';
        await refreshUser(); showSuccess(started.trial_ends_at); return;
      }
      let res;
      try {
        res = await fetch(`${info.paymongo_api}/payment_methods`, {
          method: 'POST',
          headers: { Authorization: `Basic ${btoa(`${info.public_key}:`)}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { attributes: { type: 'card',
            details: { card_number: vals.number.replace(/[\s-]/g, ''), exp_month: parseExpiry(vals.exp).month, exp_year: parseExpiry(vals.exp).year, cvc: vals.cvc.trim() },
            billing: { name: vals.name.trim(), email: state.user.email } } } }),
        });
      } catch { throw Object.assign(new Error(MSG.network), { shown: true }); } finally {
        fields.number.input.value = ''; fields.cvc.input.value = ''; // the card number and CVC never stay on the page
        vals.number = ''; vals.cvc = '';
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.data?.id) {
        const detail = body?.errors?.[0]?.detail;
        throw Object.assign(new Error(res.status >= 500 || !detail ? MSG.network : `PayMongo says: ${detail}`), { shown: true });
      }
      const out = await post(`/billing/card-check/${encodeURIComponent(id)}/attach`, { payment_method_id: body.data.id });
      if (out.status === 'passed') { await refreshUser(); showSuccess(out.trial_ends_at); return; }
      if (out.status === 'action_required') { location.assign(out.redirect_url); return; }
      if (out.status === 'pending') { setBusy(false); await waitForBank(id); return; }
      setBusy(false);
      showSummary(out.message || MSG.declined);
    } catch (err) {
      fields.number.input.value = ''; fields.cvc.input.value = ''; // also when start itself failed, so nothing typed stays on the page
      setBusy(false);
      if (err.code === 'CARD_CHECK_NOT_REQUIRED') { // another tab already passed: go home with no message (APP-FLOW 5.10)
        stopped = true;
        try { await refreshUser(); } catch { /* the route rule re-checks */ }
        navigate(homeRoute(), { replace: true });
        return;
      }
      showSummary(err.shown || err.code === 'PAYMENT_PROVIDER_UNAVAILABLE' ? err.message : err.status === 429 || err.code === 'RATE_LIMITED' ? rateText(err.data?.retry_after)
        : err.status >= 500 || err.offline || !err.message ? MSG.network : err.data?.message || (err.status === 402 ? MSG.declined : err.message));
    }
  }

  const formEl = h('div', { class: 'cc-form' },
    summary,
    h('section', { 'aria-labelledby': 'cc-plan-h' },
      h('h2', { id: 'cc-plan-h' }, 'Plan after your trial'),
      h('div', { class: 'plan-mini' }, pickers.map(([, b]) => b)),
      h('p', { class: 'muted small' }, 'You can change this anytime before your trial ends.')),
    h('section', { 'aria-labelledby': 'cc-what-h' },
      h('h2', { id: 'cc-what-h' }, 'What happens'),
      h('ol', { class: 'cc-what' },
        h('li', null, 'We charge ₱20 to your card once, to confirm it\'s yours. The ₱20 is not refunded and is not part of a plan payment.'),
        h('li', null, 'PayMongo keeps your card details. BalayHub never sees or stores your card number.'),
        lastLine)),
    stage2 && h('div', { class: 'field cc-consent' },
      h('label', { class: 'check', for: 'cc-consent' }, consentBox,
        h('span', null, 'I agree that BalayHub may charge my card for the plan above every month after my trial, until I cancel.')),
      consentErr),
    nameF, numF, h('div', { class: 'cc-row' }, expF, cvcF),
    btn,
    h('p', { class: 'muted small' }, 'Card payments are handled by PayMongo. Your bank may ask you to confirm with a code.'));

  markPlans(); drawLast();
  el.append(h('div', { class: 'card cc-card' },
    h('h1', null, 'Confirm your payment card'),
    h('p', { class: 'lead' }, 'One last step before your 14-day free trial starts.'),
    panel, footer()));
  panel.replaceChildren(formEl);

  if (query.check) {
    history.replaceState(history.state, '', '#/confirm-card');
    waitForBank(query.check);
  }
}
