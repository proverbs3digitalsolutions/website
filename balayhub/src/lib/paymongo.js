'use strict';

// Minimal PayMongo API client usable with any secret key (BalayHub's own for
// plans, or a host's for their guests' direct bookings).

const config = require('../config');

const API = 'https://api.paymongo.com/v1';
const serviceError = (msg) => Object.assign(new Error(msg), { status: 502 });

async function request(secretKey, method, path, body) {
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
    const detail = data?.errors?.[0]?.detail || `HTTP ${res.status}`;
    console.error(`[paymongo] ${method} ${path} failed: ${detail}`);
    const err = serviceError(res.status === 401 ? 'The PayMongo key was rejected. Check it in Settings.' : 'The payment service could not start the checkout. Please try again in a moment.');
    err.unauthorized = res.status === 401;
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

module.exports = { request, checkoutStatus, checkKey };
