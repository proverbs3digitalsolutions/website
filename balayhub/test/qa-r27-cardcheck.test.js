'use strict';

// QA round 27 CARDCHECK (card.json #1, CRD-1): when PayMongo cannot be reached while an earlier card check is still open,
// the workspace gets the one outage sentence (D-107 CARD-3, D-109), the same one the Confirm your card page and the billing
// routes use. Status 503 and code PAYMENT_PROVIDER_UNAVAILABLE do not change. Server test: its own database.

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* database.');

process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, sql } = require('./helpers');
const { install } = require('./fakes/paymongo');
const cardcheck = require('../src/lib/cardcheck');

const OUTAGE = "We couldn't reach the payment service. Nothing was charged. Please try again in a moment.";
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

let srv; let fake; let n = 0;
test.before(async () => { fake = install({ realFetch: globalThis.fetch }); srv = await startServer(); });
test.after(async () => { fake.uninstall(); await srv.close(); });

async function gated() {
  n += 1;
  const [o] = await sql(`INSERT INTO organizations (name, plan, card_check) VALUES ($1, 'trial', 'required') RETURNING organization_id`, [`CardCheck27 ${n}`]);
  const [u] = await sql(
    `INSERT INTO users (full_name, email, password_hash, organization_id, role, email_verified_at)
     VALUES ('Maria Santos', $1, 'x', $2, 'owner', now()) RETURNING *`, [`cc27-${n}@example.com`, o.organization_id]);
  return u;
}
const intents = () => fake.calls.filter((c) => c.method === 'POST' && c.path === '/payment_intents').length;
const piOf = async (id) => (await sql('SELECT payment_intent_id FROM billing_payments WHERE billing_id = $1', [id]))[0].payment_intent_id;
const statusOf = async (id) => (await sql('SELECT status FROM billing_payments WHERE billing_id = $1', [id]))[0].status;

// Lets the first Payment Intent read through and turns every later one into a network error (PayMongo unreachable).
function failLaterIntentReads() {
  const real = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = (url, opts = {}) => {
    if (/\/payment_intents\/pi_/.test(String(url)) && (opts.method ?? 'GET') === 'GET') {
      reads += 1;
      if (reads > 1) return Promise.reject(new TypeError('fetch failed'));
    }
    return real(url, opts);
  };
  return () => { globalThis.fetch = real; };
}

test('cardcheck.js uses the one outage sentence on both 503 throws and no other', () => {
  const src = read('src/lib/cardcheck.js');
  assert.equal(src.includes('check your earlier payment'), false);
  const throws = src.split('\n').filter((line) => line.includes('new HttpError(503'));
  assert.equal(throws.length, 2);
  for (const line of throws) {
    assert.ok(line.includes(`"${OUTAGE}"`), line);
    assert.ok(line.includes("code: 'PAYMENT_PROVIDER_UNAVAILABLE'"), line);
  }
});

test('the Confirm your card page shows the same outage sentence', () => {
  assert.ok(read('public/js/views/cardcheck.js').includes(`"${OUTAGE}"`));
});

test('PayMongo unreachable while re-reading an open earlier check: 503 with the outage sentence, nothing new', async () => {
  const u = await gated();
  const { billing_id } = await cardcheck.start(u, { renewalPlan: 'growth' });
  const before = intents();
  fake.failNext(/^\/payment_intents\/pi_/, 0);
  await assert.rejects(cardcheck.start(u, { renewalPlan: 'growth' }),
    (e) => e.status === 503 && e.extra.code === 'PAYMENT_PROVIDER_UNAVAILABLE' && e.message === OUTAGE);
  assert.equal(intents(), before);
  assert.equal(await statusOf(billing_id), 'pending');
});

// The first read says the earlier intent was declined; the second read, made under the row lock, fails. That is the
// second 503 throw in cardcheck.js (start(), the declined-intent branch).
test('PayMongo unreachable while re-checking a declined earlier intent: 503 with the outage sentence, nothing new', async () => {
  const u = await gated();
  const { billing_id } = await cardcheck.start(u, { renewalPlan: 'growth' });
  fake.markIntent(await piOf(billing_id), 'failed');
  const before = intents();
  const restore = failLaterIntentReads();
  try {
    await assert.rejects(cardcheck.start(u, { renewalPlan: 'growth' }),
      (e) => e.status === 503 && e.extra.code === 'PAYMENT_PROVIDER_UNAVAILABLE' && e.message === OUTAGE);
  } finally { restore(); }
  assert.equal(intents(), before);
  assert.equal(await statusOf(billing_id), 'pending');
});
