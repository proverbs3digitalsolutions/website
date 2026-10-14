// Short-term (stays) browser journey. Needs a running server seeded with `npm run seed` and Playwright.
// Run: BASE_URL=http://localhost:3000 node test/e2e-stays-browser.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SHOTS = (process.env.SHOTS_DIR || require('os').tmpdir()) + '/';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OFF = 400 + (Math.floor(Date.now() / 60000) % 5000) * 4; // unique future dates per run
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/401|400|409/.test(m.text())) errors.push(`console: ${m.text()}`); });
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]); await page.screenshot({ path: SHOTS + 'fail-' + name.replace(/\W+/g, '_') + '.png' }); } };

  await step('login stays demo', async () => {
    await page.goto(BASE + '/#/login');
    await page.locator('[name=email]').fill('stays@balayhub.test');
    await page.locator('[name=password]').fill('demo-password-1');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('heading', { name: /Welcome back, Bea/ }).waitFor();
    await page.getByRole('heading', { name: 'Trends overview' }).waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: SHOTS + 'd-home.png', fullPage: true });
  });
  await step('calendar', async () => {
    await page.goto(BASE + '/#/calendar');
    await page.locator('.cal-bar').first().waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: SHOTS + 'd-calendar.png' });
  });
  await step('calendar: set price & block', async () => {
    const cell = page.locator('.cal-row').nth(1).locator('.cal-cell').nth(12);
    await cell.click();
    await page.getByRole('button', { name: /Set nightly price/ }).click();
    await page.locator('dialog [name=price]').fill('3999');
    await page.getByRole('button', { name: 'Save price' }).click();
    await page.getByText('Price saved.').waitFor();
    await page.locator('.cal-cell.has-override').first().waitFor();
  });
  await step('new reservation from calendar w/ quote', async () => {
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'New reservation' }).first().click();
    await page.locator('dialog [name=unit_id]').waitFor();
    const d = page.locator('dialog');
    await d.locator('[name=unit_id]').selectOption({ index: 5 });
    const ci = new Date(Date.now() + (8 + 24 * OFF) * 3600e3).toISOString().slice(0, 10);
    const co = new Date(Date.now() + (8 + 24 * (OFF + 3)) * 3600e3).toISOString().slice(0, 10);
    await d.locator('[name=check_in]').fill(ci);
    await d.locator('[name=check_in]').dispatchEvent('change');
    await d.locator('[name=check_out]').fill(co);
    await d.locator('[name=check_out]').dispatchEvent('change');
    await d.getByText(/3 nights/).waitFor();
    await d.locator('[name=guest_name]').fill('Juan Bautista');
    await d.locator('[name=guest_phone]').fill('0918 222 3333');
    await page.screenshot({ path: SHOTS + 'd-new-res.png' });
    await d.getByRole('button', { name: 'Save reservation' }).click();
    await page.getByText(/Reservation BH-.* saved/).waitFor();
    await page.goto(BASE + '/#/reservations?view=all&q=Juan%20Bautista');
    await page.locator('tr.row-link').first().click();
    await page.getByRole('heading', { name: /Juan Bautista/ }).waitFor();
    await page.screenshot({ path: SHOTS + 'd-res-detail.png', fullPage: true });
  });
  await step('record payment', async () => {
    await page.getByRole('button', { name: 'Record payment' }).click();
    await page.locator('dialog [name=amount]').fill('1000');
    await page.getByRole('button', { name: 'Save payment' }).click();
    await page.getByText('Payment saved.').waitFor();
  });
  await step('overlap error', async () => {
    await page.goto(BASE + '/#/reservations?view=upcoming');
    await page.getByRole('heading', { name: 'Reservations' }).waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: SHOTS + 'd-reservations.png' });
  });
  await step('listings + channels modal', async () => {
    await page.goto(BASE + '/#/listings');
    await page.getByRole('heading', { name: 'Listings' }).waitFor();
    await page.screenshot({ path: SHOTS + 'd-listings.png', fullPage: true });
    await page.getByRole('button', { name: 'Channels' }).first().click();
    await page.getByText('Give your BalayHub calendar').waitFor();
    await page.screenshot({ path: SHOTS + 'd-channels.png' });
    await page.keyboard.press('Escape');
  });
  await step('guests', async () => {
    await page.goto(BASE + '/#/guests');
    await page.getByRole('heading', { name: 'Guests' }).waitFor();
  });
  await step('expenses page short-term', async () => {
    await page.goto(BASE + '/#/rent?tab=expenses');
    await page.getByRole('heading', { name: 'Expenses', exact: true }).waitFor();
  });
  // mobile
  const m = await ctx.newPage();
  m.setDefaultTimeout(8000);
  m.on('pageerror', (e) => errors.push(`pageerror(m): ${e.message}`));
  await m.setViewportSize({ width: 390, height: 844 });
  for (const [name, hash, heading] of [['home', '/home', /Welcome back/], ['calendar', '/calendar', 'Calendar'], ['reservations', '/reservations', 'Reservations'], ['listings', '/listings', 'Listings']]) {
    await step(`mobile ${name}`, async () => {
      await m.goto(BASE + '/#' + hash);
      await m.getByRole('heading', { name: heading }).first().waitFor();
      await m.waitForTimeout(600);
      await m.screenshot({ path: SHOTS + `m-${name}.png`, fullPage: name !== 'calendar' });
      const w = await m.evaluate(() => document.documentElement.scrollWidth);
      if (w > 392) errors.push(`overflow ${hash}: ${w}`);
    });
  }
  console.log('\nERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
