'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql } = require('./helpers');
const account = require('../src/lib/account');
const { createStaysWorkspace } = require('../src/lib/demo');

let srv; let orgA; let orgB; let coupon;
const bad = (q, p) => assert.rejects(sql(q, p), /check|violates|unique|duplicate|foreign/i);
const ins = (cols, vals, p = []) => sql(`INSERT INTO platform_coupons (${cols}) VALUES (${vals}) RETURNING *`, p);
test.before(async () => {
  srv = await startServer();
  orgA = await createStaysWorkspace({ email: 'm035a@example.com', passwordHash: 'x' });
  orgB = await createStaysWorkspace({ email: 'm035b@example.com', passwordHash: 'x' });
  [coupon] = await ins("code, name, kind, percent_off, duration, duration_months, starts_at", "'ALPHA50','Alpha','percent',50,'months',3,now()");
});
test.after(async () => { await srv.close(); });

test('035: coupon rules', async () => {
  await bad("INSERT INTO platform_coupons (code,name,kind,percent_off,duration,starts_at) VALUES ('alpha','x','percent',10,'once',now())");      // lower case
  await bad("INSERT INTO platform_coupons (code,name,kind,percent_off,duration,starts_at) VALUES ('ALPHA50','x','percent',10,'once',now())");    // duplicate
  await bad("INSERT INTO platform_coupons (code,name,kind,percent_off,duration,starts_at) VALUES ('P100','x','percent',100,'once',now())");      // use free
  await bad("INSERT INTO platform_coupons (code,name,kind,amount_off,percent_off,duration,starts_at) VALUES ('F1','x','fixed',100,10,'once',now())");
  await bad("INSERT INTO platform_coupons (code,name,kind,duration,starts_at) VALUES ('FREE1','x','free','months',now())");                         // months needs N
  await bad("INSERT INTO platform_coupons (code,name,kind,duration,plans,starts_at) VALUES ('FREE2','x','free','once','{comped}',now())");
  await bad("INSERT INTO platform_coupons (code,name,kind,duration,starts_at,ends_at) VALUES ('FREE3','x','free','once',now(),now() - interval '1 day')");
  const [f] = await ins("code,name,kind,duration,plans,starts_at,require_card", "'FREE4','Free','free','forever','{growth,pro}',now(),true");
  assert.equal(f.once_per_workspace, true);
  assert.equal(f.active, true);
});

test('035: one live redemption per workspace per coupon; billing rows may be free only through a coupon', async () => {
  await sql("INSERT INTO platform_coupon_redemptions (coupon_id, organization_id, months_total) VALUES ($1,$2,3)", [coupon.coupon_id, orgA]);
  await bad("INSERT INTO platform_coupon_redemptions (coupon_id, organization_id, months_total) VALUES ($1,$2,3)", [coupon.coupon_id, orgA]);
  await sql("UPDATE platform_coupon_redemptions SET status = 'released' WHERE organization_id = $1", [orgA]);
  await sql("INSERT INTO platform_coupon_redemptions (coupon_id, organization_id, months_total) VALUES ($1,$2,3)", [coupon.coupon_id, orgA]);
  await bad("INSERT INTO billing_payments (organization_id, plan, months, amount) VALUES ($1,'growth',1,0)", [orgA]);
  await sql("INSERT INTO billing_payments (organization_id, plan, months, amount, provider, status) VALUES ($1,'growth',1,0,'coupon','pending')", [orgA]);
  await bad("INSERT INTO billing_payments (organization_id, plan, months, amount, provider) VALUES ($1,'growth',1,10,'stripe')", [orgA]);
  await bad("INSERT INTO billing_payments (organization_id, plan, months, amount, discount_amount) VALUES ($1,'growth',1,10,-1)", [orgA]);
});

test('035: purge removes the workspace redemptions and keeps the coupon', async () => {
  assert.ok(account.PURGED_TABLES.includes('platform_coupon_redemptions'));
  await sql("INSERT INTO platform_coupon_redemptions (coupon_id, organization_id, months_total) VALUES ($1,$2,3)", [coupon.coupon_id, orgB]);
  const [r] = await sql("SELECT redemption_id FROM platform_coupon_redemptions WHERE organization_id = $1 AND status = 'pending'", [orgA]);
  await sql("INSERT INTO billing_payments (organization_id, plan, months, amount, coupon_redemption_id, coupon_months) VALUES ($1,'growth',1,499.50,$2,1)", [orgA, r.redemption_id]);
  await account.purgeOrganization(orgA);
  assert.equal((await sql('SELECT 1 FROM platform_coupon_redemptions WHERE organization_id = $1', [orgA])).length, 0);
  assert.equal((await sql('SELECT 1 FROM platform_coupon_redemptions WHERE organization_id = $1', [orgB])).length, 1);
  assert.equal((await sql('SELECT 1 FROM platform_coupons WHERE coupon_id = $1', [coupon.coupon_id])).length, 1);
});
