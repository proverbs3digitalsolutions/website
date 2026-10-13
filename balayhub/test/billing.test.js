'use strict';

process.env.PAYMONGO_SECRET_KEY = 'sk_test_fake';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_fake';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const billing = require('../src/lib/billing');

// Fake PayMongo: remembers created checkouts; tests flip them to paid.
const realFetch = globalThis.fetch;
const sessions = new Map();
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.paymongo.com/')) return realFetch(url, opts);
  calls.push({ url: u, method: opts.method, auth: opts.headers?.Authorization, body: opts.body && JSON.parse(opts.body) });
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (opts.method === 'POST' && u.endsWith('/checkout_sessions')) {
    const a = JSON.parse(opts.body).data.attributes;
    const id = `cs_${crypto.randomBytes(6).toString('hex')}`;
    sessions.set(id, { id, attributes: { ...a, checkout_url: `https://checkout.paymongo.com/${id}`, status: 'active', payments: [] } });
    return json({ data: sessions.get(id) });
  }
  const m = /checkout_sessions\/(cs_\w+)$/.exec(u);
  if (m && sessions.has(m[1])) return json({ data: sessions.get(m[1]) });
  return json({ errors: [{ detail: 'not found' }] }, 404);
};
const pay = (id, amountCentavos) => {
  const s = sessions.get(id);
  s.attributes.payments = [{ id: 'pay_1', attributes: { status: 'paid', amount: amountCentavos, source: { type: 'gcash' } } }];
  s.attributes.payment_method_used = 'gcash';
};

let srv; let owner;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Paying Stays');
});
test.after(async () => { globalThis.fetch = realFetch; await srv.close(); });

const checkoutIdOf = async (billingId) => (await sql('SELECT checkout_id FROM billing_payments WHERE billing_id = $1', [billingId]))[0].checkout_id;

test('owner starts a PayMongo checkout with the right amount', async () => {
  const opts = (await owner.get('/api/billing')).data;
  assert.equal(opts.online, true);
  const growth = opts.options.find((o) => o.key === 'growth');
  assert.deepEqual(growth.prices.map((p) => p.amount), [999, 2997, 9990]);
  const r = await owner.post('/api/billing/checkout', { plan: 'growth', months: '3' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.checkout_url, /^https:\/\/checkout\.paymongo\.com\//);
  const call = calls.at(-1);
  assert.equal(call.auth, `Basic ${Buffer.from('sk_test_fake:').toString('base64')}`);
  const a = call.body.data.attributes;
  assert.equal(a.line_items[0].amount, 299700);
  assert.equal(a.line_items[0].currency, 'PHP');
  assert.deepEqual(a.payment_method_types, ['gcash', 'paymaya', 'card', 'grab_pay']);
  assert.equal(a.reference_number, r.data.billing_id);
  assert.match(a.success_url, /#\/settings\?billing=/);
  assert.equal((await owner.post('/api/billing/checkout', { plan: 'comped', months: '1' })).status, 400);
  assert.equal((await owner.post('/api/billing/checkout', { plan: 'pro', months: '2' })).status, 400);
});

test('payment is applied only after PayMongo confirms it, once', async () => {
  const r = await owner.post('/api/billing/checkout', { plan: 'pro', months: '1' });
  const id = r.data.billing_id;
  assert.equal((await owner.post(`/api/billing/${id}/refresh`)).data.status, 'pending');
  pay(await checkoutIdOf(id), 179900);
  assert.equal((await owner.post(`/api/billing/${id}/refresh`)).data.status, 'paid');
  const me = (await owner.get('/api/auth/me')).data.user;
  assert.equal(me.plan.plan, 'pro');
  const row = (await sql('SELECT * FROM billing_payments WHERE billing_id = $1', [id]))[0];
  assert.equal(row.status, 'paid');
  assert.equal(row.payment_method, 'gcash');
  assert.equal(me.plan.paid_until, row.period_end.toISOString ? row.period_end.toISOString().slice(0, 10) : String(row.period_end).slice(0, 10));
  // Paying again early adds on to the end of the current period.
  const r2 = await owner.post('/api/billing/checkout', { plan: 'pro', months: '1' });
  pay(await checkoutIdOf(r2.data.billing_id), 179900);
  await owner.post(`/api/billing/${r2.data.billing_id}/refresh`);
  const rows = await sql(`SELECT period_start::text, period_end::text FROM billing_payments WHERE status = 'paid' ORDER BY paid_at`);
  const next = new Date(`${rows[0].period_end}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  assert.equal(rows[1].period_start, next.toISOString().slice(0, 10));
  assert.equal(await billing.markPaid(id), false, 'never applied twice');
});

test('wrong amount is not accepted', async () => {
  const r = await owner.post('/api/billing/checkout', { plan: 'growth', months: '1' });
  pay(await checkoutIdOf(r.data.billing_id), 100);
  assert.equal((await owner.post(`/api/billing/${r.data.billing_id}/refresh`)).data.status, 'pending');
});

test('webhook: bad signature rejected; valid one triggers a confirmed check', async () => {
  const c = await ownerAccount(srv.base, 'hook@example.com', 'Hook Stays');
  await sql(`UPDATE organizations SET trial_ends_at = now() - interval '1 day' WHERE name = 'Hook Stays'`);
  // An ended trial can still pay.
  const r = await c.post('/api/billing/checkout', { plan: 'starter', months: '1' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cs = await checkoutIdOf(r.data.billing_id);
  const body = JSON.stringify({ data: { attributes: { type: 'checkout_session.payment.paid', livemode: false, data: { id: cs, attributes: { reference_number: r.data.billing_id } } } } });
  const send = (sig) => realFetch(`${srv.base}/api/public/paymongo/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Paymongo-Signature': sig }, body });
  assert.equal((await send('t=1,te=deadbeef,li=')).status, 401);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsk_fake').update(`${t}.${body}`).digest('hex');
  // Valid signature but PayMongo says not paid yet: nothing happens.
  assert.equal((await send(`t=${t},te=${sig},li=`)).status, 200);
  assert.equal((await sql('SELECT status FROM billing_payments WHERE billing_id = $1', [r.data.billing_id]))[0].status, 'pending');
  pay(cs, 49900);
  assert.equal((await send(`t=${t},te=${sig},li=`)).status, 200);
  assert.equal((await sql('SELECT status FROM billing_payments WHERE billing_id = $1', [r.data.billing_id]))[0].status, 'paid');
  const me = (await c.get('/api/auth/me')).data.user;
  assert.equal(me.plan.plan, 'starter');
  assert.equal(me.plan.read_only, false, 'paying lifts the read-only lock');
});

test('reconcile catches payments without a webhook; staff/others cannot touch billing', async () => {
  const r = await owner.post('/api/billing/checkout', { plan: 'starter', months: '12' });
  pay(await checkoutIdOf(r.data.billing_id), 499000);
  assert.ok(await billing.reconcile() >= 1);
  assert.equal((await sql('SELECT status FROM billing_payments WHERE billing_id = $1', [r.data.billing_id]))[0].status, 'paid');
  const other = await ownerAccount(srv.base, 'other@example.com', 'Other');
  assert.equal((await other.post(`/api/billing/${r.data.billing_id}/refresh`)).status, 404);
  const demo = client(srv.base);
  await demo.post('/api/auth/demo');
  assert.equal((await demo.post('/api/billing/checkout', { plan: 'pro', months: '1' })).status, 403);
});
