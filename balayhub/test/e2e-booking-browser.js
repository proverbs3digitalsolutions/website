// Direct booking: host setup (PayMongo key, listing on page, photos) and the guest booking page.
// Needs a running, seeded server and Playwright. In a sandbox without internet, the final
// "Continue to payment" step shows a friendly "couldn't reach the payment service" message.
// Run: BASE_URL=http://localhost:3000 node test/e2e-booking-browser.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const path = require('path');
const SHOTS = (process.env.SHOTS_DIR || require('os').tmpdir()) + '/';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  let failed = 0;
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failed += 1; console.log('FAIL', name, e.message.split('\n')[0]); await page.screenshot({ path: SHOTS + 'fail-' + name.replace(/\W+/g, '_') + '.png' }); } };
  let link;
  await step('host connects PayMongo and turns on the page', async () => {
    await page.goto(BASE + '/#/login');
    await page.locator('[name=email]').fill('stays@balayhub.test');
    await page.locator('[name=password]').fill('demo-password-1');
    await page.getByRole('button', { name: 'Log In' }).click();
    await page.getByRole('heading', { name: /Welcome back/ }).waitFor();
    await page.goto(BASE + '/#/settings');
    await page.getByRole('heading', { name: 'Direct booking page' }).waitFor();
    const card = page.locator('.card').filter({ hasText: 'Direct booking page' });
    if (await card.getByRole('button', { name: 'Connect PayMongo' }).isVisible().catch(() => false)) {
      await card.getByRole('button', { name: 'Connect PayMongo' }).click();
      await page.locator('dialog [name=paymongo_secret_key]').fill('sk_test_hostKEY1234567890');
      await page.locator('dialog').getByRole('button', { name: 'Save key' }).click();
      await page.getByText('PayMongo connected.').waitFor();
    }
    await card.getByRole('button', { name: /Turn on|Turn off/ }).waitFor();
    if (await card.getByRole('button', { name: 'Turn on' }).isVisible().catch(() => false)) {
      await card.getByRole('button', { name: 'Turn on' }).click();
      await page.getByText('Your booking page is live!').waitFor();
      await card.getByRole('button', { name: 'Turn off' }).waitFor();
    }
    link = await card.locator('dd a').first().getAttribute('href');
    if (!link.startsWith('#/book/')) throw new Error('no link');
  });
  await step('listing on the page with a photo', async () => {
    await page.goto(BASE + '/#/listings');
    await page.getByRole('button', { name: 'Edit' }).first().click();
    const d = page.locator('dialog');
    await d.locator('[name=bookable_online]').check();
    await d.locator('[name=description]').fill('Bright studio with a city view, fast Wi-Fi and pool access.');
    await d.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Listing updated.').waitFor();
    await page.getByRole('button', { name: 'Photos' }).first().click();
    const png = path.join(require('os').tmpdir(), 'room.png');
    fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex'));
    await page.locator('dialog input[type=file]').setInputFiles(png);
    await page.locator('dialog').getByRole('button', { name: 'Upload' }).click();
    await page.locator('dialog .ph-item').first().waitFor();
    await page.locator('dialog .modal__close').click();
  });
  await step('guest picks dates and sees the price and deposit', async () => {
    await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'BalayHub' } }));
    await page.goto(BASE + '/' + link);
    await page.locator('.bk-card').first().waitFor();
    await page.screenshot({ path: SHOTS + 'b-host.png', fullPage: true });
    await page.locator('.bk-card').first().click();
    await page.locator('.bk-cal__day:not(:disabled)').first().waitFor();
    // Pick the first free run of 2 nights.
    await page.getByRole('button', { name: 'Later ›' }).click();
    const free = page.locator('.bk-cal__month').first().locator('.bk-cal__day:not(:disabled):not(.is-taken)');
    const n = await free.count();
    let picked = false;
    for (let i = 0; i < n - 2 && !picked; i += 1) {
      await free.nth(i).click();
      await free.nth(i + 2).click().catch(() => {});
      picked = await page.locator('.bk-summary dt').filter({ hasText: /nights/ }).first().waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
    }
    if (!picked) throw new Error('could not pick dates');
    await page.getByText('50% deposit').first().waitFor();
    await page.locator('[name=name]').fill('Juan Dela Cruz');
    await page.locator('[name=email]').fill('juan@example.com');
    await page.locator('[name=phone]').fill('09171234567');
    await page.locator('[name=consent]').check();
    await page.screenshot({ path: SHOTS + 'b-listing.png', fullPage: true });
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    // No internet here: expect the friendly payment-service message (or a redirect if online).
    await page.getByText(/payment service|PayMongo key/).first().waitFor();
  });
  await step('mobile booking page fits the screen', async () => {
    const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await m.goto(BASE + '/' + link);
    await m.locator('.bk-card').first().click();
    await m.locator('.bk-cal__day').first().waitFor();
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await m.screenshot({ path: SHOTS + 'b-mobile.png', fullPage: true });
    await m.close();
    if (overflow) throw new Error('horizontal overflow');
  });
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console errors');
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})();
