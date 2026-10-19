'use strict';

// In-memory fake of the PayMongo API (https://api.paymongo.com/v1) for tests and for the
// browser re-verify harness. install() replaces globalThis.fetch for PayMongo URLs only;
// everything else goes to the real fetch. Never stores a card number: only last4, brand
// and how the card behaves (ok / threeDS / declined).
//
//   const fake = require('./fakes/paymongo').install();   // ... fake.uninstall();
//   fake.state    { customers, intents, methods, sessions, plans, subscriptions, invoices, calls }  (Maps / array)
//   fake.calls    [{ method, path, auth, body }]  path has no /v1 and no query; auth 'secret' | 'public' | 'none'
//   fake.markIntent(piId, 'succeeded' | 'failed' | 'processing')
//   fake.markCheckout(csId, 'paid' | 'expired', amountC?)
//   fake.failNext(pathRegex, status)   next matching call answers `status` (0 = network error)
//   fake.createPaymentMethod(card)     what the browser does with the public key -> 'pm_...'
//   fake.payInvoice(subId, { failed }) -> { invoiceId, event }
//   fake.paymentEvent(piId, type)      -> webhook body for payment.paid / payment.failed
//   fake.signedHeader(rawBody, secret) -> Paymongo-Signature header value
//   fake.handle(method, path, body, auth, search) -> { status, body }   (used by the harness)

const crypto = require('crypto');

const TEST_CARDS = { ok: '4343434343434345', threeDS: '4120000000000007', declined: '5234000000000106' };
const rid = (p) => `${p}_${crypto.randomBytes(8).toString('hex')}`;
const nowSec = () => Math.floor(Date.now() / 1000);
const MAP_KEYS = ['customers', 'intents', 'methods', 'sessions', 'plans', 'subscriptions', 'invoices'];

function cardKind(number) {
  if (number === TEST_CARDS.threeDS) return 'threeDS';
  if (number === TEST_CARDS.declined) return 'declined';
  return 'ok';
}
const brandOf = (number) => (number[0] === '4' ? 'visa' : number[0] === '5' ? 'mastercard' : 'unknown');

function install({ realFetch, threeDsBase = 'https://secure-authentication.paymongo.com', persistFile } = {}) {
  const real = realFetch || globalThis.fetch;
  const prior = globalThis.fetch;
  const state = { calls: [] };
  for (const k of MAP_KEYS) state[k] = new Map();
  const queue = []; // failNext entries
  const flags = { rejectKey: false };

  if (persistFile) {
    try {
      const saved = JSON.parse(require('fs').readFileSync(persistFile, 'utf8'));
      for (const k of MAP_KEYS) state[k] = new Map(saved[k] || []);
    } catch { /* first run */ }
  }
  const save = () => {
    if (!persistFile) return;
    const out = {};
    for (const k of MAP_KEYS) out[k] = [...state[k]];
    require('fs').writeFileSync(persistFile, JSON.stringify(out));
  };

  const errBody = (code, detail, attribute) => ({ errors: [{ code, detail, ...(attribute ? { source: { attribute } } : {}) }] });
  const bad = (detail, attribute) => ({ status: 400, body: errBody('parameter_invalid', detail, attribute) });
  const notFound = (what) => ({ status: 404, body: errBody('resource_not_found', `${what} not found`) });
  const ok = (data) => ({ status: 200, body: { data } });
  const attrsOf = (body) => (body && body.data && body.data.attributes) || {};

  // ---- views --------------------------------------------------------------------------
  const methodView = (m) => ({ id: m.id, type: 'payment_method', attributes: { type: 'card', details: { last4: m.last4, exp_month: m.exp_month, exp_year: m.exp_year, brand: m.brand }, billing: m.billing, created_at: m.created_at } });
  const intentView = (pi) => ({ id: pi.id, type: 'payment_intent', attributes: { amount: pi.amount, currency: pi.currency, description: pi.description, status: pi.status, metadata: pi.metadata, client_key: pi.client_key, payment_method_allowed: pi.payment_method_allowed, payment_method_options: pi.payment_method_options, setup_future_usage: pi.setup_future_usage, payment_method: pi.payment_method, payments: pi.payments, next_action: pi.next_action, last_payment_error: pi.last_payment_error, created_at: pi.created_at } });
  const sessionView = (s) => ({ id: s.id, type: 'checkout_session', attributes: s.attributes });

  function succeed(pi) {
    const m = state.methods.get(pi.payment_method);
    pi.status = 'succeeded';
    pi.next_action = null;
    pi.last_payment_error = null;
    pi.payments = [{ id: rid('pay'), type: 'payment', attributes: { status: 'paid', amount: pi.amount, source: { type: 'card', brand: m ? m.brand : 'visa', last4: m ? m.last4 : '4242' } } }];
    const cus = pi.setup_future_usage && state.customers.get(pi.setup_future_usage.customer_id);
    if (cus && m && !cus.methods.includes(m.id)) cus.methods.push(m.id);
  }

  // ---- routes -------------------------------------------------------------------------
  function handle(method, path, body, auth, search = '') {
    let m;
    const a = attrsOf(body);
    if (method === 'GET' && path === '/payments') return flags.rejectKey ? { status: 401, body: errBody('unauthorized', 'Invalid key') } : { status: 200, body: { data: [] } };
    // Only the public key may be used by a browser: it can create a payment method and attach, nothing else.
    if (auth === 'none') return { status: 401, body: errBody('unauthorized', 'Invalid key') };
    if (auth === 'public' && !(method === 'POST' && (path === '/payment_methods' || /^\/payment_intents\/pi_\w+\/attach$/.test(path)))) {
      return { status: 401, body: errBody('unauthorized', 'This key cannot be used here') };
    }

    if (method === 'POST' && path === '/customers') {
      const c = { id: rid('cus'), first_name: a.first_name, last_name: a.last_name, email: a.email, phone: a.phone, methods: [] };
      state.customers.set(c.id, c);
      return ok({ id: c.id, type: 'customer', attributes: { first_name: c.first_name, last_name: c.last_name, email: c.email, phone: c.phone } });
    }
    if ((m = /^\/customers\/(cus_\w+)$/.exec(path)) && method === 'DELETE') {
      if (!state.customers.delete(m[1])) return notFound('customer');
      return ok({ id: m[1], type: 'customer', deleted: true });
    }
    if ((m = /^\/customers\/(cus_\w+)\/payment_methods$/.exec(path)) && method === 'GET') {
      const c = state.customers.get(m[1]);
      if (!c) return notFound('customer');
      return { status: 200, body: { data: c.methods.map((id) => methodView(state.methods.get(id))) } };
    }
    if ((m = /^\/customers\/(cus_\w+)\/payment_methods\/(pm_\w+)$/.exec(path)) && method === 'DELETE') {
      const c = state.customers.get(m[1]);
      if (!c || !c.methods.includes(m[2])) return notFound('payment method');
      c.methods = c.methods.filter((id) => id !== m[2]);
      return ok({ id: m[2], type: 'payment_method', deleted: true });
    }

    if (method === 'POST' && path === '/payment_methods') {
      const d = a.details || {};
      const number = String(d.card_number || '');
      if (a.type !== 'card') return bad('type must be card', 'type');
      if (!/^\d{13,19}$/.test(number)) return bad('card_number is invalid', 'details.card_number');
      const mo = Number(d.exp_month); const yr = Number(d.exp_year);
      if (!(mo >= 1 && mo <= 12) || !Number.isInteger(yr)) return bad('exp_month or exp_year is invalid', 'details.exp_month');
      const d0 = new Date();
      if (yr < d0.getFullYear() || (yr === d0.getFullYear() && mo < d0.getMonth() + 1)) return bad('The card has expired', 'details.exp_year');
      if (!/^\d{3,4}$/.test(String(d.cvc || ''))) return bad('cvc is invalid', 'details.cvc');
      const pm = { id: rid('pm'), last4: number.slice(-4), brand: brandOf(number), kind: cardKind(number), exp_month: mo, exp_year: yr, billing: a.billing || null, created_at: nowSec() };
      state.methods.set(pm.id, pm);
      return ok(methodView(pm));
    }

    if (method === 'POST' && path === '/payment_intents') {
      if (!Number.isInteger(a.amount) || a.amount < 2000) return bad('amount must be an integer of at least 2000', 'amount');
      const sfu = a.setup_future_usage || null;
      if (sfu && !state.customers.has(sfu.customer_id)) return bad('setup_future_usage.customer_id is unknown', 'setup_future_usage.customer_id');
      const pi = { id: rid('pi'), amount: a.amount, currency: a.currency || 'PHP', description: a.description || null, status: 'awaiting_payment_method', metadata: a.metadata || {}, client_key: rid('ck'), payment_method_allowed: a.payment_method_allowed || [], payment_method_options: a.payment_method_options || null, setup_future_usage: sfu, payment_method: null, payments: [], next_action: null, last_payment_error: null, created_at: nowSec() };
      state.intents.set(pi.id, pi);
      return ok(intentView(pi));
    }
    if ((m = /^\/payment_intents\/(pi_\w+)$/.exec(path)) && method === 'GET') {
      const pi = state.intents.get(m[1]);
      return pi ? ok(intentView(pi)) : notFound('payment intent');
    }
    if ((m = /^\/payment_intents\/(pi_\w+)\/attach$/.exec(path)) && method === 'POST') {
      const pi = state.intents.get(m[1]);
      if (!pi) return notFound('payment intent');
      if (pi.status === 'succeeded' || pi.status === 'processing') return bad(`The payment intent is ${pi.status} and cannot be attached to`, 'payment_method');
      const pm = state.methods.get(a.payment_method);
      if (!pm) return bad('payment_method is unknown', 'payment_method');
      pi.payment_method = pm.id;
      if (pm.kind === 'declined') {
        pi.status = 'awaiting_payment_method';
        pi.payment_method = null;
        pi.last_payment_error = { code: 'card_declined', detail: 'The card was declined.' };
      } else if (pm.kind === 'threeDS') {
        pi.status = 'awaiting_next_action';
        pi.last_payment_error = null;
        const back = a.return_url || '';
        pi.next_action = { type: 'redirect', redirect: { url: `${threeDsBase}/3ds/${pi.id}?return=${encodeURIComponent(back)}`, return_url: back } };
      } else {
        succeed(pi);
      }
      return ok(intentView(pi));
    }

    if (method === 'POST' && path === '/checkout_sessions') {
      const id = rid('cs');
      const s = { id, attributes: { ...a, checkout_url: `https://checkout.paymongo.com/${id}`, status: 'active', payments: [], payment_intent: null } };
      state.sessions.set(id, s);
      return ok(sessionView(s));
    }
    if ((m = /^\/checkout_sessions\/(cs_\w+)$/.exec(path)) && method === 'GET') {
      const s = state.sessions.get(m[1]);
      return s ? ok(sessionView(s)) : notFound('checkout session');
    }

    // Stage 2 (shapes unconfirmed, research R4). Specific paths before /subscriptions/:id.
    if (method === 'POST' && path === '/subscriptions/plans') {
      if (!Number.isInteger(a.amount) || a.amount < 100) return bad('amount is invalid', 'amount');
      const p = { id: rid('plan'), ...a };
      state.plans.set(p.id, p);
      return ok({ id: p.id, type: 'plan', attributes: a });
    }
    if ((m = /^\/subscriptions\/invoices\/(\w+)$/.exec(path)) && method === 'GET') {
      const inv = state.invoices.get(m[1]);
      return inv ? ok({ id: inv.id, type: 'subscription_invoice', attributes: inv.attributes }) : notFound('invoice');
    }
    if (method === 'POST' && path === '/subscriptions') {
      const plan = state.plans.get(a.plan_id);
      const cus = state.customers.get(a.customer_id);
      if (!plan) return bad('plan_id is unknown', 'plan_id');
      if (!cus) return bad('customer_id is unknown', 'customer_id');
      if (!cus.methods.length) return bad('The customer has no saved payment method', 'customer_id');
      const sub = { id: rid('sub'), attributes: { plan_id: plan.id, customer_id: cus.id, status: 'active', amount: plan.amount, latest_invoice: null, created_at: nowSec() } };
      state.subscriptions.set(sub.id, sub);
      return ok({ id: sub.id, type: 'subscription', attributes: sub.attributes });
    }
    if ((m = /^\/subscriptions\/(sub_\w+)$/.exec(path)) && method === 'GET') {
      const sub = state.subscriptions.get(m[1]);
      return sub ? ok({ id: sub.id, type: 'subscription', attributes: sub.attributes }) : notFound('subscription');
    }
    if ((m = /^\/subscriptions\/(sub_\w+)\/cancel$/.exec(path)) && method === 'POST') {
      const sub = state.subscriptions.get(m[1]);
      if (!sub) return notFound('subscription');
      sub.attributes.status = 'cancelled';
      return ok({ id: sub.id, type: 'subscription', attributes: sub.attributes });
    }
    return { status: 404, body: errBody('not_found', `fake paymongo: unhandled ${method} ${path}`) };
  }

  // ---- fetch hook ---------------------------------------------------------------------
  function authKind(headers) {
    const h = headers && (typeof headers.get === 'function' ? headers.get('authorization') : headers.Authorization || headers.authorization);
    if (!h) return 'none';
    const key = Buffer.from(String(h).replace(/^Basic\s+/i, ''), 'base64').toString('utf8');
    return key.startsWith('pk_') ? 'public' : key.startsWith('sk_') ? 'secret' : 'none';
  }
  const json = (status, o) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

  async function fakeFetch(input, opts = {}) {
    const url = String(typeof input === 'object' && input && input.url ? input.url : input);
    if (!url.startsWith('https://api.paymongo.com/')) return real(input, opts);
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    try { body = opts.body ? JSON.parse(opts.body) : null; } catch { body = String(opts.body); }
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v1/, '');
    const auth = authKind(opts.headers);
    state.calls.push({ method, path, auth, body });
    const i = queue.findIndex((q) => q.re.test(path));
    if (i >= 0) {
      const [q] = queue.splice(i, 1);
      if (q.status === 0) throw new TypeError('fetch failed');
      return json(q.status, errBody('fake', 'Fake PayMongo failure'));
    }
    const out = handle(method, path, body, auth, u.search);
    save();
    return json(out.status, out.body);
  }
  globalThis.fetch = fakeFetch;

  // ---- test controls ------------------------------------------------------------------
  const fake = {
    state,
    calls: state.calls,
    handle,
    flags,
    save,
    markIntent(piId, to) {
      const pi = state.intents.get(piId);
      if (!pi) throw new Error(`unknown payment intent ${piId}`);
      if (to === 'succeeded') succeed(pi);
      else if (to === 'processing') { pi.status = 'processing'; pi.next_action = null; }
      else if (to === 'failed') { pi.status = 'awaiting_payment_method'; pi.next_action = null; pi.payment_method = null; pi.last_payment_error = { code: 'card_declined', detail: 'The card was declined.' }; }
      else throw new Error(`bad intent status ${to}`);
      save();
    },
    markCheckout(csId, to, amountC) {
      const s = state.sessions.get(csId);
      if (!s) throw new Error(`unknown checkout ${csId}`);
      if (to === 'expired') s.attributes.status = 'expired';
      else {
        const listed = (s.attributes.line_items || []).reduce((t, li) => t + Number(li.amount || 0) * Number(li.quantity || 1), 0);
        s.attributes.payments = [{ id: rid('pay'), attributes: { status: 'paid', amount: amountC || listed, source: { type: 'gcash' } } }];
        s.attributes.payment_method_used = 'gcash';
      }
      save();
    },
    failNext(re, status) { queue.push({ re, status }); },
    createPaymentMethod(card) {
      const out = handle('POST', '/payment_methods', { data: { attributes: { type: 'card', details: card } } }, 'public');
      state.calls.push({ method: 'POST', path: '/payment_methods', auth: 'public', body: { data: { attributes: { type: 'card', details: { ...card, card_number: undefined, cvc: undefined } } } } });
      if (out.status !== 200) throw Object.assign(new Error(out.body.errors[0].detail), { status: out.status, body: out.body });
      save();
      return out.body.data.id;
    },
    payInvoice(subId, { failed = false } = {}) {
      const sub = state.subscriptions.get(subId);
      if (!sub) throw new Error(`unknown subscription ${subId}`);
      const invoiceId = rid('inv');
      const attributes = { subscription_id: subId, status: failed ? 'failed' : 'paid', amount: sub.attributes.amount, paid_at: failed ? null : nowSec() };
      state.invoices.set(invoiceId, { id: invoiceId, attributes });
      sub.attributes.latest_invoice = invoiceId;
      if (failed) sub.attributes.status = 'past_due';
      save();
      const event = { data: { id: rid('evt'), type: 'event', attributes: { type: failed ? 'subscription.invoice.payment_failed' : 'subscription.invoice.paid', livemode: false, data: { id: invoiceId, type: 'subscription_invoice', attributes }, created_at: nowSec(), updated_at: nowSec() } } };
      return { invoiceId, event };
    },
    paymentEvent(piId, type = 'payment.paid') {
      const pi = state.intents.get(piId);
      if (!pi) throw new Error(`unknown payment intent ${piId}`);
      return { data: { id: rid('evt'), type: 'event', attributes: { type, livemode: false, data: { id: rid('pay'), type: 'payment', attributes: { payment_intent_id: piId, amount: pi.amount, status: type === 'payment.paid' ? 'paid' : 'failed' } }, created_at: nowSec(), updated_at: nowSec() } } };
    },
    signedHeader(rawBody, secret) {
      const t = nowSec();
      const sig = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
      return `t=${t},te=${sig},li=${sig}`;
    },
    uninstall() { if (globalThis.fetch === fakeFetch) globalThis.fetch = prior; },
  };
  return fake;
}

module.exports = { install, TEST_CARDS };
