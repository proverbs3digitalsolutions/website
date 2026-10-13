// Browser end-to-end journey (needs a running server seeded with `npm run seed`, and Playwright).
// Run: BASE_URL=http://localhost:3000 node test/e2e-browser.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SHOTS = (process.env.SHOTS_DIR || require('os').tmpdir()) + '/';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]); await page.screenshot({ path: SHOTS + 'fail-' + name.replace(/\W+/g, '_') + '.png' }); } };

  const email = `e2e${Date.now()}@example.com`;
  await step('welcome', async () => { await page.goto(BASE); await page.getByRole('link', { name: 'Get Started' }).waitFor(); await page.screenshot({ path: SHOTS + '01-welcome.png', fullPage: true }); });
  await step('signup', async () => {
    await page.getByRole('link', { name: 'Get Started' }).click();
    await page.locator('[name=full_name]').fill('Rosa Dizon');
    await page.locator('[name=email]').fill(email);
    await page.locator('[name=password]').fill('password-123');
    await page.locator('[name=confirm_password]').fill('password-123');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByText('Please read and accept').waitFor();
    await page.locator('input[name=accept_privacy]').check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('heading', { name: 'Check your email' }).waitFor();
    await page.screenshot({ path: SHOTS + '02-verify-pending.png' });
  });
  await step('verify + workspace', async () => {
    await page.getByRole('link', { name: 'Verify my email' }).click();
    await page.locator('[name=name]').fill('Dizon Rentals');
    await page.locator('[name=business_type]').selectOption('long_term');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await page.getByRole('heading', { name: 'Add property' }).waitFor();
  });
  await step('add property + unit', async () => {
    const d = page.locator('dialog');
    await d.locator('[name=property_name]').fill('Acacia Residences');
    await d.locator('[name=property_type]').selectOption('apartment');
    await d.locator('[name=address]').fill('1 Acacia St');
    await d.locator('[name=city]').fill('Dasmariñas');
    await d.locator('[name=province]').fill('Cavite');
    await page.screenshot({ path: SHOTS + '03-add-property.png' });
    await d.getByRole('button', { name: 'Save property' }).click();
    await page.getByRole('heading', { name: /Add unit to/ }).waitFor();
    const u = page.locator('dialog');
    await u.locator('[name=unit_name]').fill('1A');
    await u.locator('[name=unit_type]').selectOption('studio');
    await u.locator('[name=monthly_rent]').fill('7,500');
    await u.getByRole('button', { name: 'Save unit' }).click();
    await page.getByText('Unit 1A').waitFor();
    await page.screenshot({ path: SHOTS + '04-property-detail.png', fullPage: true });
  });
  await step('dashboard empty tenants', async () => {
    await page.goto(BASE + '/#/dashboard');
    await page.getByText('No tenants yet').waitFor();
  });
  await step('add tenant + assign', async () => {
    await page.goto(BASE + '/#/tenants');
    await page.getByText('No tenants yet').waitFor();
    await page.getByRole('button', { name: 'Add tenant' }).first().click();
    const d = page.locator('dialog');
    await d.locator('[name=full_name]').fill('Pedro Penduko');
    await d.locator('[name=phone]').fill('0917 000 1111');
    await d.getByRole('button', { name: 'Save tenant' }).click();
    await page.getByRole('heading', { name: /Assign Pedro Penduko/ }).waitFor();
    const a = page.locator('dialog');
    await a.locator('[name=start_date]').fill(new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10));
    await a.locator('[name=due_day]').fill('5');
    await a.getByRole('button', { name: 'Save lease' }).click();
    await page.getByText('Monthly rent charges').waitFor();
    await page.screenshot({ path: SHOTS + '05-tenant.png', fullPage: true });
  });
  await step('record partial payment (double click)', async () => {
    await page.getByRole('button', { name: 'Record payment' }).first().click();
    const d = page.locator('dialog');
    await d.locator('[name=amount_paid]').fill('-5');
    await d.getByRole('button', { name: 'Save payment' }).click();
    await d.getByText('cannot be negative').waitFor();
    await d.locator('[name=amount_paid]').fill('5000');
    await d.getByRole('button', { name: 'Save payment' }).dblclick();
    await page.getByText(/Payment saved/).waitFor();
    await page.waitForTimeout(500);
  });
  await step('dashboard numbers', async () => {
    await page.goto(BASE + '/#/dashboard');
    await page.locator('.stats').waitFor();
    const txt = await page.locator('.stats').innerText();
    if (!txt.includes('₱5,000.00')) throw new Error('collected missing: ' + txt);
    if (!/OUTSTANDING\s*₱(10,000|17,500)\.00/i.test(txt)) throw new Error('outstanding should be monthly charges minus 5,000: ' + txt);
    await page.screenshot({ path: SHOTS + '06-dashboard-new.png', fullPage: true });
  });
  await step('logout', async () => {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
  });
  await step('wrong password', async () => {
    await page.locator('[name=email]').fill('demo@balayhub.test');
    await page.locator('[name=password]').fill('wrong-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByText('Incorrect email or password').waitFor();
  });
  await step('demo login', async () => {
    await page.locator('[name=password]').fill('demo-password-1');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
    await page.screenshot({ path: SHOTS + '07-dashboard-mobile.png', fullPage: true });
  });
  for (const [name, hash, heading] of [['properties', '/properties', 'Properties'], ['tenants', '/tenants', 'Tenants & Leases'], ['rent', '/rent', 'Rent & Expenses'], ['payments', '/rent?tab=payments', 'Rent & Expenses'], ['expenses', '/rent?tab=expenses', 'Rent & Expenses'], ['reports', '/reports?from=2026-01-01&to=2026-12-31', 'Reports'], ['maintenance', '/maintenance', 'Maintenance'], ['settings', '/settings', 'Settings']]) {
    await step(`screen ${name}`, async () => {
      await page.goto(BASE + '/#' + hash);
      await page.getByRole('heading', { name: heading, exact: true }).waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: SHOTS + `m-${name}.png`, fullPage: true });
    });
  }
  await step('search no results', async () => {
    await page.goto(BASE + '/#/tenants');
    await page.getByRole('searchbox').fill('zzzz');
    await page.getByText('No results found').waitFor();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await page.getByText('Juan Dela Cruz').waitFor();
  });
  await step('detail pages', async () => {
    await page.getByText('Juan Dela Cruz').click();
    await page.getByRole('heading', { name: 'Payment history' }).waitFor();
    await page.locator('a[href^="#/payments/"]').first().click();
    await page.getByRole('heading', { name: 'Payment details' }).waitFor();
    await page.goto(BASE + '/#/maintenance');
    await page.getByText('Leaking kitchen faucet').click();
    await page.getByRole('heading', { name: 'Costs' }).waitFor();
    await page.screenshot({ path: SHOTS + 'm-maintenance-detail.png', fullPage: true });
  });
  await step('offline save keeps input', async () => {
    await page.goto(BASE + '/#/maintenance');
    await page.getByRole('button', { name: 'New request' }).click();
    const d = page.locator('dialog');
    await d.locator('[name=title]').fill('');
    await d.getByRole('button', { name: 'Save request' }).click();
    await d.getByText('Issue is required.').waitFor();
    await d.locator('[name=property_id]').selectOption({ index: 1 });
    await d.locator('[name=title]').fill('Broken window');
    await ctx.setOffline(true);
    await d.getByRole('button', { name: 'Save request' }).click();
    await d.getByText("Couldn't reach BalayHub").waitFor();
    if (await d.locator('[name=title]').inputValue() !== 'Broken window') throw new Error('input lost');
    await page.locator('#offline-banner').waitFor({ state: 'visible' });
    await page.screenshot({ path: SHOTS + 'm-offline.png' });
    await ctx.setOffline(false);
    await d.getByRole('button', { name: 'Save request' }).click();
    await page.getByRole('heading', { name: 'Broken window' }).waitFor();
  });
  await step('session expiry keeps draft', async () => {
    await page.goto(BASE + '/#/rent');
    await page.getByRole('button', { name: 'Add expense' }).click();
    const d = page.locator('dialog');
    await d.locator('[name=property_id]').selectOption({ index: 1 });
    await d.locator('[name=description]').fill('Draft survives');
    await ctx.clearCookies();
    await d.locator('[name=amount]').fill('100');
    await d.locator('[name=category]').selectOption('supplies');
    await d.getByRole('button', { name: 'Save expense' }).click();
    await page.getByText('Your session expired').first().waitFor();
    await page.locator('[name=email]').fill('demo@balayhub.test');
    await page.locator('[name=password]').fill('demo-password-1');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('heading', { name: 'Rent & Expenses' }).waitFor();
    await page.getByRole('button', { name: 'Add expense' }).click();
    const v = await page.locator('dialog').locator('[name=description]').inputValue();
    if (v !== 'Draft survives') throw new Error('draft not restored: ' + v);
    await page.keyboard.press('Escape');
  });

  // Desktop screenshots
  const dpage = await ctx.newPage();
  dpage.setDefaultTimeout(8000);
  await dpage.setViewportSize({ width: 1366, height: 900 });
  dpage.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  for (const [name, hash] of [['dashboard', '/dashboard'], ['rent', '/rent'], ['reports', '/reports'], ['tenant', '/tenants'], ['settings', '/settings']]) {
    await step(`desktop ${name}`, async () => {
      await dpage.goto(BASE + '/#' + hash);
      await dpage.locator('main h1').waitFor();
      await dpage.waitForTimeout(400);
      await dpage.screenshot({ path: SHOTS + `d-${name}.png`, fullPage: true });
    });
  }
  // horizontal overflow check on mobile
  for (const hash of ['/dashboard', '/properties', '/tenants', '/rent', '/reports', '/maintenance', '/settings']) {
    await page.goto(BASE + '/#' + hash); await page.locator('main h1').waitFor(); await page.waitForTimeout(300);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    if (w > 392) errors.push(`overflow ${hash}: ${w}px`);
  }
  console.log('\nERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
