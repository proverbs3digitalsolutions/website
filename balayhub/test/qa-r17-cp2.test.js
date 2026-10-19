'use strict';

// QA round 17, lane CP2: a code over 32 characters says so (#28), and a live forever coupon's offer sentence is not
// repeated in the preview message (the live box on Plan & billing already shows it).
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_08 node --test --test-concurrency=1 test/qa-r17-cp2.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const c = require('../src/lib/coupons');
const config = require('../src/config');
const { pool } = require('../src/db');
const { migrate } = require('../scripts/migrate');

const sql = (text, params) => pool.query(text, params).then((r) => r.rows);
let savedMethods;

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
  savedMethods = config.paymongoMethods;
  config.paymongoMethods = ['gcash', 'paymaya', 'card', 'grab_pay'];
});
after(async () => { config.paymongoMethods = savedMethods; await pool.end(); });

const makeOrg = async () => (await sql("INSERT INTO organizations (name, plan) VALUES ('CP2 Workspace', 'growth') RETURNING organization_id, plan, is_demo"))[0];

test('a code over 32 characters says the length limit; a bad character keeps the letters sentence', async () => {
  const org = await makeOrg();
  const long = await c.resolve(pool, { org, code: 'A'.repeat(33), plan: 'growth', months: '1' }).catch((e) => e);
  assert.equal(long.extra.fields.code, 'Codes are up to 32 characters.');
  const bad = await c.resolve(pool, { org, code: 'AB#CD', plan: 'growth', months: '1' }).catch((e) => e);
  assert.equal(bad.extra.fields.code, 'Enter the code using letters, numbers and dashes.');
});

test('a live forever coupon previews with no repeated offer sentence', async () => {
  const org = await makeOrg();
  const [k] = await sql(`INSERT INTO platform_coupons (name, code, kind, amount_off, duration, starts_at, require_card)
    VALUES ('CP2', 'CP2FOREVER', 'fixed', 100, 'forever', now() - interval '1 day', false) RETURNING *`);
  await sql(`INSERT INTO platform_coupon_redemptions (coupon_id, organization_id, months_total, status) VALUES ($1, $2, NULL, 'active')`, [k.coupon_id, org.organization_id]);
  const r = await c.resolve(pool, { org, plan: 'growth', months: '1' });
  assert.equal(r.source, 'redeemed');
  assert.equal(r.message, null);
});

test('the owner coupon box stops at 32 characters', () => {
  const src = fs.readFileSync(__dirname + '/../public/js/views/billingcoupon.js', 'utf8');
  assert.match(src, /maxlength: 32,/);
});
