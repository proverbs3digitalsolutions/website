// Onboarding checklist and guest check-in form. Needs a running, seeded server (SMTP_URL=test://) and Playwright.
// Run: BASE_URL=http://localhost:3000 node test/e2e-checkin-browser.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const path = require('path');
const fs = require('fs');
const SHOTS = (process.env.SHOTS_DIR || require('os').tmpdir()) + '/';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  let failed = 0;
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/40[0-9]/.test(m.text())) errors.push(`console: ${m.text()}`); });
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failed += 1; console.log('FAIL', name, e.message.split('\n')[0]); await page.screenshot({ path: SHOTS + 'fail-' + name.replace(/\W+/g, '_') + '.png' }); } };
  let link;
  await step('new owner sees the get-started checklist', async () => {
    const email = `new${Date.now()}@example.com`;
    await page.goto(BASE + '/#/signup');
    await page.locator('[name=full_name]').fill('New Host');
    await page.locator('[name=email]').fill(email);
    await page.locator('[name=password]').fill('long-password-1');
    await page.locator('[name=confirm_password]').fill('long-password-1');
    await page.locator('[name=accept_privacy]').check();
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForTimeout(800);
    // Mark the email verified directly (the test server doesn't send real email).
    const { pool } = require('../src/db');
    await pool.query('UPDATE users SET email_verified_at = now() WHERE email = $1', [email]);
    await pool.end();
    await page.goto(BASE + '/#/setup');
    await page.locator('[name=name]').fill('New Host Stays');
    await page.locator('form button[type=submit]').click();
    await page.getByRole('heading', { name: 'Add listing' }).waitFor(); // first-run opens "Add listing"
    await page.goto(BASE + '/#/home');
    await page.getByRole('heading', { name: 'Get started with BalayHub' }).waitFor();
    await page.screenshot({ path: SHOTS + 'o-checklist.png', fullPage: true });
  });
  await step('host copies the check-in link from a reservation', async () => {
    await page.goto(BASE + '/#/login');
    if (await page.locator('[name=email]').isVisible().catch(() => false)) {
      await page.locator('[name=email]').fill('stays@balayhub.test');
      await page.locator('[name=password]').fill('demo-password-1');
      await page.getByRole('button', { name: 'Log In' }).click();
    } else {
      await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'BalayHub' } }));
      await page.goto(BASE + '/#/login');
      await page.locator('[name=email]').fill('stays@balayhub.test');
      await page.locator('[name=password]').fill('demo-password-1');
      await page.getByRole('button', { name: 'Log In' }).click();
    }
    await page.getByRole('heading', { name: /Welcome back/ }).waitFor();
    await page.goto(BASE + '/#/reservations?view=upcoming');
    await page.locator('.row-link').nth(2).click();
    await page.getByRole('heading', { name: 'Guest check-in form' }).waitFor();
    link = await page.evaluate(async () => {
      const id = location.hash.split('/')[2];
      const r = await fetch(`/api/reservations/${id}/checkin`).then((x) => x.json());
      return r.link;
    });
    if (!link.includes('/#/checkin/')) throw new Error('bad link');
  });
  await step('guest fills in the form on a phone', async () => {
    const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
    m.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    m.setDefaultTimeout(8000);
    await m.goto(BASE + '/#/checkin/' + link.split('/checkin/')[1]);
    await m.getByRole('heading', { name: /register before you arrive|Guest registration/ }).waitFor();
    await m.locator('[name=lead_name]').fill('Juan Dela Cruz');
    await m.locator('[name=phone]').fill('0917 222 3333');
    const guests = m.locator('.gc__guest input');
    if (await guests.count() === 0) await m.getByRole('button', { name: '+ Add guest' }).click();
    await m.locator('.gc__guest input').first().fill('Maria Dela Cruz');
    await m.locator('[name=arrival_time]').fill('15:00');
    await m.locator('[name=vehicle_plate]').fill('nbc 1234');
    const png = path.join(require('os').tmpdir(), 'id-test.png');
    fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex'));
    await m.locator('input[type=file]').setInputFiles(png);
    await m.screenshot({ path: SHOTS + 'g-form.png', fullPage: true });
    await m.locator('[name=consent]').check();
    await m.getByRole('button', { name: /Submit registration|Save changes/ }).click();
    await m.getByRole('heading', { name: /registered/ }).waitFor();
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await m.screenshot({ path: SHOTS + 'g-done.png' });
    await m.close();
    if (overflow) throw new Error('horizontal overflow');
  });
  await step('host sees the submitted registration', async () => {
    await page.reload();
    await page.getByText('Juan Dela Cruz').first().waitFor();
    await page.getByText('NBC 1234').waitFor();
    await page.locator('.gc__ids img').first().waitFor();
    await page.screenshot({ path: SHOTS + 'g-host.png', fullPage: true });
  });
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console errors');
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})();
