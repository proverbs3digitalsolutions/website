'use strict';

// Minimal PayMongo API client usable with any secret key (BalayHub's own for
// plans, or a host's for their guests' direct bookings).

const config = require('../config');

const API = 'https://api.paymongo.com/v1';
const serviceError = (msg) => Object.assign(new Error(msg), { status: 502 });

// `soft`: a 4xx other than 401 (declined card and the like) comes back as { _failed, errors } instead of throwing.
async function request(secretKey, method, path, body, soft = false) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    console.error(`[paymongo] ${method} ${path} unreachable: ${err.message}`);
    throw serviceError("Couldn't reach the payment service. Please try again in a moment.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (soft && res.status >= 400 && res.status < 500 && res.status !== 401) return { _failed: true, errors: data?.errors || [] };
    const detail = data?.errors?.[0]?.detail || `HTTP ${res.status}`;
    console.error(`[paymongo] ${method} ${path} failed: ${detail}`);
    const err = serviceError(res.status === 401 ? 'The PayMongo key was rejected. Check it in Settings.' : 'The payment service could not start the checkout. Please try again in a moment.');
    err.unauthorized = res.status === 401;
    err.httpStatus = res.status;
    throw err;
  }
  return data;
}

// Read a checkout session: paid?, the amount actually paid (centavos), method, expired?
async function checkoutStatus(secretKey, checkoutId) {
  const data = await request(secretKey, 'GET', `/checkout_sessions/${encodeURIComponent(checkoutId)}`);
  const a = data?.data?.attributes || {};
  const paidPayments = (a.payments || []).filter((p) => p?.attributes?.status === 'paid');
  const paid = paidPayments.length > 0 || a.payment_intent?.attributes?.status === 'succeeded';
  const paidAmount = paidPayments.reduce((s, p) => s + Number(p.attributes.amount || 0), 0);
  const listed = (a.line_items || []).reduce((s, li) => s + Number(li.amount || 0) * Number(li.quantity || 1), 0);
  return {
    paid,
    amount: paidAmount || listed,
    paidAmount,
    listed,
    method: a.payment_method_used || paidPayments[0]?.attributes?.source?.type || null,
    expired: a.status === 'expired',
  };
}

// Ask PayMongo whether a secret key works: 'ok' | 'rejected' (401) | 'unreachable' (anything else).
// Never logs the key.
async function checkKey(secretKey) {
  if (config.paymongoKeyCheck === 'off') return 'unreachable';
  try {
    const res = await fetch(`${API}/payments?limit=1`, {
      headers: { Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return 'ok';
    return res.status === 401 ? 'rejected' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

const q = (id) => encodeURIComponent(id);

// What the rest of the app needs from a Payment Intent (amounts in centavos). A soft failure reads as awaiting_payment_method.
function intentView(data) {
  if (data?._failed) {
    const e = data.errors[0] || {};
    return { id: null, status: 'awaiting_payment_method', amountC: 0, metadata: {}, redirectUrl: null, errorCode: e.code || 'failed', errorDetail: e.detail || null, paymentMethodId: null, brand: null, last4: null, failed: true };
  }
  const d = data?.data || {};
  const a = d.attributes || {};
  const src = a.payments?.[0]?.attributes?.source || {};
  return {
    id: d.id,
    status: a.status,
    amountC: Number(a.amount),
    metadata: a.metadata || {},
    redirectUrl: a.next_action?.redirect?.url || null,
    errorCode: a.last_payment_error?.code || null,
    errorDetail: a.last_payment_error?.detail || null,
    paymentMethodId: typeof a.payment_method === 'string' ? a.payment_method : a.payment_method?.id || null,
    brand: src.brand || null,
    last4: src.last4 || null,
  };
}

async function createCustomer(secretKey, { firstName, lastName, email, phone }) {
  const data = await request(secretKey, 'POST', '/customers', {
    data: { attributes: { first_name: firstName, last_name: lastName, email, ...(phone ? { phone } : {}), default_device: 'email' } },
  });
  if (!data?.data?.id) throw serviceError('The payment service returned an unexpected response.');
  return data.data.id;
}

// Card-only Payment Intent. With customerId the card used is saved to that PayMongo customer.
async function createPaymentIntent(secretKey, { amountC, description, metadata, customerId }) {
  const data = await request(secretKey, 'POST', '/payment_intents', {
    data: {
      attributes: {
        amount: amountC,
        currency: 'PHP',
        payment_method_allowed: ['card'],
        payment_method_options: { card: { request_three_d_secure: 'any' } },
        description,
        statement_descriptor: 'BALAYHUB',
        metadata,
        ...(customerId ? { setup_future_usage: { session_type: 'on_session', customer_id: customerId } } : {}),
      },
    },
  });
  const v = intentView(data);
  if (!v.id) throw serviceError('The payment service returned an unexpected response.');
  return v;
}

// A declined card (4xx) does not throw: the view says awaiting_payment_method with the error.
async function attachPaymentIntent(secretKey, piId, { paymentMethodId, returnUrl }) {
  const data = await request(secretKey, 'POST', `/payment_intents/${q(piId)}/attach`,
    { data: { attributes: { payment_method: paymentMethodId, return_url: returnUrl } } }, true);
  return intentView(data);
}

async function getPaymentIntent(secretKey, piId) {
  return intentView(await request(secretKey, 'GET', `/payment_intents/${q(piId)}`));
}

async function listCustomerPaymentMethods(secretKey, customerId) {
  const data = await request(secretKey, 'GET', `/customers/${q(customerId)}/payment_methods`);
  return (data?.data || []).map((m) => ({
    id: m.id, type: m.attributes?.type, last4: m.attributes?.details?.last4 || null,
    brand: m.attributes?.details?.brand || null, created_at: m.attributes?.created_at || 0,
  }));
}

// R5: the detach endpoint is unconfirmed, so any error just means "forget it locally".
async function detachPaymentMethod(secretKey, customerId, pmId) {
  try {
    await request(secretKey, 'DELETE', `/customers/${q(customerId)}/payment_methods/${q(pmId)}`);
    return true;
  } catch {
    return false;
  }
}

// Best effort: removes the customer record (name, email, phone) at PayMongo.
async function deleteCustomer(secretKey, customerId) {
  try {
    await request(secretKey, 'DELETE', `/customers/${q(customerId)}`);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  request, checkoutStatus, checkKey, intentView,
  createCustomer, createPaymentIntent, attachPaymentIntent, getPaymentIntent, listCustomerPaymentMethods, detachPaymentMethod, deleteCustomer,
};
