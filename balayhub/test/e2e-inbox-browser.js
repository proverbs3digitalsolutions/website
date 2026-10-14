// Inbox browser journey. Needs a running server (SMTP_URL=test://, not production) seeded with `npm run seed`, and Playwright.
// Run: BASE_URL=http://localhost:3000 node test/e2e-inbox-browser.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SHOTS = (process.env.SHOTS_DIR || require('os').tmpdir()) + '/';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  let failed = 0;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/401|400|409/.test(m.text())) errors.push(`console: ${m.text()}`); });
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failed += 1; console.log('FAIL', name, e.message.split('\n')[0]); await page.screenshot({ path: SHOTS + 'fail-' + name.replace(/\W+/g, '_') + '.png' }); } };

  await step('login', async () => {
    await page.goto(BASE + '/#/login');
    await page.locator('[name=email]').fill('stays@balayhub.test');
    await page.locator('[name=password]').fill('demo-password-1');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('heading', { name: /Welcome back/ }).waitFor();
  });
  await step('inbox nav + empty state', async () => {
    await page.locator('.sidebar').getByRole('link', { name: /Inbox/ }).click();
    await page.getByRole('heading', { name: 'Inbox', exact: true }).waitFor();
  });
  await step('listing guest info fields', async () => {
    await page.goto(BASE + '/#/listings');
    await page.getByRole('button', { name: 'Edit' }).first().click();
    const d = page.locator('dialog');
    await d.locator('[name=wifi_name]').fill('Condo-WiFi');
    await d.locator('[name=wifi_password]').fill('salamat123');
    await d.locator('[name=checkin_instructions]').fill('Present your ID at the lobby guard.');
    await d.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText('Listing updated.').waitFor();
  });
  let resUrl;
  await step('message guest from reservation', async () => {
    await page.goto(BASE + '/#/reservations?view=upcoming');
    await page.locator('.row-link, a.row').first().click();
    await page.getByRole('button', { name: 'Message guest' }).waitFor();
    resUrl = page.url();
    await page.getByRole('button', { name: 'Message guest' }).click();
    await page.locator('.composer').waitFor();
  });
  await step('insert template, send', async () => {
    await page.locator('select[aria-label="Insert template"]').selectOption({ label: 'Check-in instructions' });
    await page.waitForFunction(() => document.querySelector('.composer textarea').value.includes('Wi-Fi'));
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText('Sent.', { exact: true }).waitFor();
    await page.locator('.msg--out').first().waitFor();
  });
  await step('internal note', async () => {
    await page.getByRole('button', { name: 'Internal note' }).click();
    await page.locator('.composer textarea').fill('Guest asked about parking — check with admin.');
    await page.getByRole('button', { name: 'Save note' }).click();
    await page.getByText('Note saved.').waitFor();
    await page.locator('.msg--note').first().waitFor();
  });
  await step('schedule and cancel', async () => {
    await page.locator('.composer textarea').fill('See you tomorrow!');
    const t = new Date(Date.now() + 2 * 86400000);
    const local = new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await page.locator('input[type=datetime-local]').fill(local);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText(/Scheduled for/).first().waitFor();
    await page.screenshot({ path: SHOTS + 'i-thread.png' });
    await page.locator('.msg').filter({ hasText: 'See you tomorrow!' }).getByRole('button', { name: 'Cancel' }).click();
    await page.locator('dialog').getByRole('button', { name: 'Cancel message' }).click();
    await page.getByText('Scheduled message cancelled.').waitFor();
  });
  await step('archive + filters', async () => {
    await page.getByRole('button', { name: 'Archive' }).click();
    await page.getByText('Archived.').waitFor();
    await page.locator('select[aria-label="Show"]').selectOption('archived');
    await page.locator('.inbox__item').first().click();
    await page.getByRole('button', { name: 'Unarchive' }).click();
    await page.getByText('Moved to open.').waitFor();
  });
  await step('templates & automations page', async () => {
    await page.goto(BASE + '/#/inbox-settings');
    await page.getByRole('heading', { name: 'Automatic messages', exact: true }).waitFor();
    await page.getByRole('button', { name: 'New template' }).click();
    const d = page.locator('dialog');
    await d.locator('[name=name]').fill('Parking info');
    await d.locator('[name=subject]').fill('Parking at {{property_name}}');
    await d.locator('[name=body]').fill('Hi {{guest_first_name}}, parking is ₱300/night at the basement.');
    await d.getByRole('button', { name: 'Save template' }).click();
    await page.getByText('Template saved.').waitFor();
    await page.getByRole('button', { name: 'Turn on' }).first().click();
    await page.getByText('Turned on.').waitFor();
    await page.getByRole('button', { name: 'Turn off' }).first().click();
    await page.getByText('Turned off.').waitFor();
    await page.screenshot({ path: SHOTS + 'i-settings.png', fullPage: true });
  });
  await step('payment with emailed receipt, printable receipt', async () => {
    await page.goto(resUrl);
    await page.getByRole('button', { name: 'Record payment' }).click();
    const d = page.locator('dialog');
    await d.locator('[name=amount]').fill('100');
    await d.locator('[name=send_receipt]').check();
    await d.getByRole('button', { name: 'Save payment' }).click();
    await page.getByText('Payment saved and receipt emailed.').waitFor();
    await page.getByRole('link', { name: 'Receipt' }).first().click();
    await page.getByRole('heading', { name: /^Receipt AR-/ }).waitFor();
    await page.screenshot({ path: SHOTS + 'r-receipt.png' });
    await page.goto(resUrl);
    await page.getByRole('button', { name: 'Email booking confirmation' }).click();
    await page.getByText(/Confirmation emailed to/).waitFor();
  });
  await step('housekeeping: add task, tick, finish', async () => {
    await page.goto(BASE + '/#/housekeeping');
    await page.getByRole('heading', { name: 'Housekeeping', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Add task' }).click();
    const d = page.locator('dialog');
    await d.locator('[name=unit_id]').selectOption({ index: 1 });
    await d.locator('[name=assignee_name]').fill('Aling Rosa');
    await d.locator('[name=notes]').fill('Deep clean before the weekend');
    await d.getByRole('button', { name: 'Add task' }).click();
    await page.getByText('Cleaning task added.').waitFor();
    await page.locator('.hk-card').filter({ hasText: 'Aling Rosa' }).first().click();
    await page.getByRole('heading', { name: /^Clean / }).waitFor();
    await page.locator('.hk-checklist input').first().check();
    await page.getByText(/^1 of \d+ done$/).waitFor();
    await page.screenshot({ path: SHOTS + 'h-detail.png', fullPage: true });
    await page.getByRole('button', { name: 'Mark done' }).click();
    await page.locator('dialog').getByRole('button', { name: 'Mark done anyway' }).click();
    await page.getByText('Cleaning done. Listing marked clean.').waitFor();
    await page.goto(BASE + '/#/housekeeping?view=done');
    await page.locator('.hk-card').first().waitFor();
    await page.goto(BASE + '/#/housekeeping');
    await page.waitForTimeout(300);
    await page.screenshot({ path: SHOTS + 'h-list.png', fullPage: true });
  });
  await step('mobile inbox', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/#/inbox');
    await page.locator('.inbox__item').first().click();
    await page.locator('.composer').waitFor();
    await page.getByRole('link', { name: '‹ Inbox' }).waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) throw new Error('horizontal overflow on mobile');
    await page.screenshot({ path: SHOTS + 'i-mobile.png', fullPage: true });
  });
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console errors');
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})();
